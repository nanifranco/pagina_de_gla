// Port of juleskuehn/typewriter-art to browser TypeScript
// Key features: 2 overlapping layers (offset by half cell), multiplicative ink
// compositing, asymmetric MSE (prefer over-inking), alternating layer optimization.

interface TypewriterOptions {
  cols?: number;
  contrast?: number;
  brightness?: number;
  charSet?: number;
  invert?: number;
  passes?: number;
}

const CHAR_SETS: string[][] = [
  // Typewriter Classic — the full set a real typewriter would have
  ['@','W','M','#','$','B','&','Q','0','8','%','G','D','O','A','H','N','m','w','X',
   'b','d','g','h','k','q','p','n','u','K','E','U','R','S','Z','e','o','a','c','x',
   'y','f','t','s','r','z','v','1','i','l','j','!',';',':',',','.','\'','-',' '],
  // Dense
  ['@','#','W','M','$','B','&','0','8','*','o','=','+','-',':','.',' '],
  // Minimal
  ['@','#','O','o','=','-',':','.',' '],
  // Numbers
  ['8','0','6','9','3','5','2','4','7','1','.',' '],
];

export const CHAR_SET_NAMES = ['Typewriter', 'Dense', 'Minimal', 'Numbers'];

const ASYMMETRY = 0.1; // from original — prefer overestimation of darkness

// Render each character into cellW×cellH pixels and capture ink density (0=paper, 1=ink)
function buildSignatures(chars: string[], cellW: number, cellH: number): Float32Array[] {
  const canvas = new OffscreenCanvas(cellW, cellH);
  const ctx = canvas.getContext('2d')!;
  const sigs: Float32Array[] = [];
  for (const ch of chars) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cellW, cellH);
    ctx.fillStyle = '#000';
    ctx.font = `${cellH}px "Courier New", monospace`;
    ctx.textBaseline = 'top';
    ctx.fillText(ch, 0, 0);
    const raw = ctx.getImageData(0, 0, cellW, cellH).data;
    const pix = new Float32Array(cellW * cellH);
    for (let i = 0; i < pix.length; i++) pix[i] = 1 - raw[i * 4] / 255;
    sigs.push(pix);
  }
  return sigs;
}

export function processTypewriter(imageData: ImageData, options: TypewriterOptions = {}): string {
  const {
    cols    = 100,
    contrast  = 20,
    brightness = 0,
    charSet = 0,
    invert  = 0,
    passes  = 2,
  } = options;

  const { width, height } = imageData;
  const chars = CHAR_SETS[Math.min(Math.round(charSet), CHAR_SETS.length - 1)];

  const cellH = 12;
  const cellW = 7;
  const HALF  = cellH >> 1; // 6 — vertical offset for layer B

  // Preserve image aspect ratio for the output grid
  const rows  = Math.round((height / width) * cols * (cellW / cellH));
  const gridW = cols * cellW;
  const gridH = rows * cellH;

  const sigs = buildSignatures(chars, cellW, cellH);
  const nChars = sigs.length;
  const nPix   = cellW * cellH;
  const spaceIdx = Math.max(0, chars.lastIndexOf(' '));

  // --- Scale input image to grid resolution and build target ink map ---
  const srcC = new OffscreenCanvas(width, height);
  srcC.getContext('2d')!.putImageData(imageData, 0, 0);
  const gC = new OffscreenCanvas(gridW, gridH);
  gC.getContext('2d')!.drawImage(srcC, 0, 0, gridW, gridH);
  const raw = gC.getContext('2d')!.getImageData(0, 0, gridW, gridH).data;

  const target = new Float32Array(gridW * gridH);
  for (let i = 0; i < target.length; i++) {
    const b = i * 4;
    let lum = 0.299 * raw[b] + 0.587 * raw[b + 1] + 0.114 * raw[b + 2];
    // Contrast/brightness (same formula as reference HTML)
    lum += brightness;
    const f = (259 * (contrast + 255)) / (255 * (259 - contrast));
    lum = Math.max(0, Math.min(255, f * (lum - 128) + 128));
    let ink = 1 - lum / 255;
    if (invert) ink = 1 - ink;
    target[i] = ink;
  }

  // --- Precompute target slices for each cell in each layer ---
  // Layer A covers rows [r*cellH .. (r+1)*cellH - 1]
  // Layer B covers rows [r*cellH+HALF .. (r+1)*cellH+HALF - 1]
  const tA = new Float32Array(rows * cols * nPix);
  const tB = new Float32Array(rows * cols * nPix);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const base = (r * cols + c) * nPix;
      for (let cy = 0; cy < cellH; cy++) {
        for (let cx = 0; cx < cellW; cx++) {
          const px = c * cellW + cx;
          const pyA = r * cellH + cy;
          const pyB = r * cellH + HALF + cy;
          tA[base + cy * cellW + cx] = pyA < gridH ? target[pyA * gridW + px] : 0;
          tB[base + cy * cellW + cx] = pyB < gridH ? target[pyB * gridW + px] : 0;
        }
      }
    }
  }

  // Layer choices: which character index is at each (row, col)
  const choicesA = new Int32Array(rows * cols).fill(spaceIdx);
  const choicesB = new Int32Array(rows * cols).fill(spaceIdx);

  // --- Precompute cross-layer fixed contributions ---
  // For a Layer A cell (r,c), the Layer B fixed ink at local pixel (cy,cx):
  //   cy < HALF  → from Layer B row r-1, local y = cy + HALF
  //   cy >= HALF → from Layer B row r,   local y = cy - HALF
  // For a Layer B cell (r,c), the Layer A fixed ink at local pixel (cy,cx):
  //   cy < HALF  → from Layer A row r,   local y = cy + HALF
  //   cy >= HALF → from Layer A row r+1, local y = cy - HALF

  // Compute the fixed contribution array for Layer A optimization
  // (i.e., what Layer B contributes to each Layer A cell's pixels)
  function buildFixedForA(cB: Int32Array): Float32Array {
    const fix = new Float32Array(rows * cols * nPix);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const base = (r * cols + c) * nPix;
        const sigBprev = r > 0   ? sigs[cB[(r - 1) * cols + c]] : null;
        const sigBcurr = sigs[cB[r * cols + c]];
        for (let cy = 0; cy < cellH; cy++) {
          const bLocalY = cy < HALF ? (cy + HALF) : (cy - HALF);
          const sig = cy < HALF ? sigBprev : sigBcurr;
          for (let cx = 0; cx < cellW; cx++) {
            fix[base + cy * cellW + cx] = sig ? sig[bLocalY * cellW + cx] : 0;
          }
        }
      }
    }
    return fix;
  }

  // Compute the fixed contribution array for Layer B optimization
  function buildFixedForB(cA: Int32Array): Float32Array {
    const fix = new Float32Array(rows * cols * nPix);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const base = (r * cols + c) * nPix;
        const sigAcurr = sigs[cA[r * cols + c]];
        const sigAnext = r < rows - 1 ? sigs[cA[(r + 1) * cols + c]] : null;
        for (let cy = 0; cy < cellH; cy++) {
          const aLocalY = cy < HALF ? (cy + HALF) : (cy - HALF);
          const sig = cy < HALF ? sigAcurr : sigAnext;
          for (let cx = 0; cx < cellW; cx++) {
            fix[base + cy * cellW + cx] = sig ? sig[aLocalY * cellW + cx] : 0;
          }
        }
      }
    }
    return fix;
  }

  // One greedy optimization sweep over all cells in a layer
  function optimizeLayer(
    choices: Int32Array,
    tgt: Float32Array,    // precomputed target slices for this layer
    fixed: Float32Array,  // fixed contribution from the OTHER layer
  ) {
    for (let cell = 0; cell < rows * cols; cell++) {
      const base = cell * nPix;
      let bestIdx = choices[cell];
      let bestErr = Infinity;
      for (let si = 0; si < nChars; si++) {
        const sig = sigs[si];
        let err = 0;
        for (let i = 0; i < nPix; i++) {
          // Multiplicative ink compositing: composite = 1 - (1-inkA)*(1-inkB)
          const comp = 1 - (1 - sig[i]) * (1 - fixed[base + i]);
          const e = tgt[base + i] - comp;
          // Asymmetric MSE: penalise under-inking more than over-inking
          const ae = e > 0 ? e * (1 + ASYMMETRY) : e;
          err += ae * ae;
        }
        if (err < bestErr) { bestErr = err; bestIdx = si; }
      }
      choices[cell] = bestIdx;
    }
  }

  // --- Initial pass: optimize Layer A with no Layer B contribution ---
  {
    const fix = new Float32Array(rows * cols * nPix); // all zeros
    optimizeLayer(choicesA, tA, fix);
  }

  // --- Alternating optimisation passes ---
  for (let p = 0; p < Math.max(1, Math.round(passes)); p++) {
    optimizeLayer(choicesB, tB, buildFixedForB(choicesA));
    optimizeLayer(choicesA, tA, buildFixedForA(choicesB));
  }

  // --- Build SVG output ---
  // Layer A at y = charH, 2*charH, ...
  // Layer B at y = charH + charH/2, 2*charH + charH/2, ...  (half-cell below A)
  const svgCharH = 10;
  const svgCharW = svgCharH * 0.55;
  const svgHalfH = svgCharH / 2;
  const svgW = Math.round(cols * svgCharW);
  const svgH = rows * svgCharH + svgHalfH;

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const linesA: string[] = [];
  const linesB: string[] = [];
  for (let r = 0; r < rows; r++) {
    let la = '', lb = '';
    for (let c = 0; c < cols; c++) {
      la += chars[choicesA[r * cols + c]];
      lb += chars[choicesB[r * cols + c]];
    }
    linesA.push(`<text x="0" y="${((r + 1) * svgCharH).toFixed(1)}">${escape(la)}</text>`);
    linesB.push(`<text x="0" y="${((r + 1) * svgCharH + svgHalfH).toFixed(1)}">${escape(lb)}</text>`);
  }

  const bg   = invert ? '#000' : '#fff';
  const fill = invert ? '#fff' : '#000';
  const font = `font-family="Courier New, Courier, monospace" font-size="${svgCharH}" fill="${fill}" xml:space="preserve"`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" style="max-width:100%;height:auto;display:block;">
  <rect width="${svgW}" height="${svgH}" fill="${bg}"/>
  <g ${font}>
    ${linesA.join('\n    ')}
  </g>
  <g ${font}>
    ${linesB.join('\n    ')}
  </g>
</svg>`;
}
