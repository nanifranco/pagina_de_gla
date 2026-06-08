interface TypewriterOptions {
  cols?: number;
  contrast?: number;
  brightness?: number;
  charSet?: number;
  invert?: number;
}

// Character sets — ordered roughly dark→light but matching is done by pixel MSE, not brightness rank
const CHAR_SETS: string[][] = [
  // 0 — Typewriter Classic: letters/punct a real typewriter would have
  ['@','W','M','#','$','B','&','Q','0','8','%','G','D','O','A','H','N','m','w','X',
   'b','d','g','h','k','q','p','n','u','K','E','U','R','S','Z','e','o','a','c','x',
   'y','f','t','s','r','z','v','1','i','l','j','!',';',':',',','.','\'','-',' '],
  // 1 — Dense: max tonal range in few chars
  ['@','#','W','M','$','B','&','0','8','*','o','=','+','-',':','.',' '],
  // 2 — Minimal / Clean
  ['@','#','O','o','=','-',':','.',' '],
  // 3 — Numbers only
  ['8','0','6','9','3','5','2','4','7','1','.',' '],
];

export const CHAR_SET_NAMES = ['Typewriter', 'Dense', 'Minimal', 'Numbers'];

// Pre-render each character into a small OffscreenCanvas and capture ink density
// Returns Float32Array[cellW * cellH] per character, 0=paper 1=ink
function buildSignatures(
  chars: string[],
  cellW: number,
  cellH: number,
): { char: string; pixels: Float32Array }[] {
  const canvas = new OffscreenCanvas(cellW, cellH);
  const ctx = canvas.getContext('2d')!;
  const sigs = [];

  for (const ch of chars) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cellW, cellH);
    ctx.fillStyle = '#000';
    ctx.font = `${cellH}px "Courier New", monospace`;
    ctx.textBaseline = 'top';
    ctx.fillText(ch, 0, 0);

    const raw = ctx.getImageData(0, 0, cellW, cellH).data;
    const pixels = new Float32Array(cellW * cellH);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = 1 - raw[i * 4] / 255; // ink density: 1=black, 0=white
    }
    sigs.push({ char: ch, pixels });
  }
  return sigs;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function adjustPixel(lum: number, contrast: number, brightness: number): number {
  let v = lum + brightness;
  const f = (259 * (contrast + 255)) / (255 * (259 - contrast));
  return clamp(f * (v - 128) + 128);
}

export function processTypewriter(imageData: ImageData, options: TypewriterOptions = {}): string {
  const {
    cols      = 100,
    contrast  = 20,
    brightness = 0,
    charSet   = 0,
    invert    = 0,
  } = options;

  const { width, height } = imageData;
  const chars = CHAR_SETS[Math.min(Math.round(charSet), CHAR_SETS.length - 1)];

  // Cell dimensions for signature rendering.
  // Courier New at 12px: characters are ~7px wide × 12px tall
  const cellH = 12;
  const cellW = 7;

  // Number of rows that preserves the image's aspect ratio in the SVG output
  // SVG renders chars at 10px tall × 5.5px wide (0.55 aspect)
  const svgAspect = 5.5 / 10; // charW / charH in SVG
  const rows = Math.round((height / width) * cols * svgAspect);

  // Pre-compute character pixel signatures
  const sigs = buildSignatures(chars, cellW, cellH);

  // Scale the input image to exactly cols×cellW by rows×cellH so each pixel
  // block maps directly to one character cell — no per-cell canvas ops needed
  const gridW = cols * cellW;
  const gridH = rows * cellH;

  const srcCanvas = new OffscreenCanvas(width, height);
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.putImageData(imageData, 0, 0);

  const gridCanvas = new OffscreenCanvas(gridW, gridH);
  const gridCtx = gridCanvas.getContext('2d')!;
  gridCtx.drawImage(srcCanvas, 0, 0, gridW, gridH);
  const gridData = gridCtx.getImageData(0, 0, gridW, gridH).data;

  // For each cell: extract target ink density, find best matching character (min MSE)
  const lines: string[] = [];
  const target = new Float32Array(cellW * cellH);

  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < cols; col++) {

      // Build target ink-density array for this cell
      for (let cy = 0; cy < cellH; cy++) {
        for (let cx = 0; cx < cellW; cx++) {
          const px = col * cellW + cx;
          const py = row * cellH + cy;
          const base = (py * gridW + px) * 4;
          const r = gridData[base], g = gridData[base + 1], b = gridData[base + 2];
          const lum = adjustPixel(0.299 * r + 0.587 * g + 0.114 * b, contrast, brightness);
          // Ink density: dark image region = needs a lot of ink = high value
          let ink = 1 - lum / 255;
          if (invert) ink = 1 - ink;
          target[cy * cellW + cx] = ink;
        }
      }

      // Find character whose pixel signature minimises MSE against target
      let bestChar = ' ';
      let bestMSE = Infinity;
      for (const sig of sigs) {
        let mse = 0;
        for (let i = 0; i < target.length; i++) {
          const d = target[i] - sig.pixels[i];
          mse += d * d;
        }
        if (mse < bestMSE) { bestMSE = mse; bestChar = sig.char; }
      }
      line += bestChar;
    }

    const svgY = ((row + 1) * 10).toFixed(1);
    const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    lines.push(`<text x="0" y="${svgY}">${escaped}</text>`);
  }

  const svgW = Math.round(cols * 5.5);
  const svgH = rows * 10;
  const bg   = invert ? '#000' : '#fff';
  const fill = invert ? '#fff' : '#000';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" style="max-width:100%;height:auto;display:block;">
  <rect width="${svgW}" height="${svgH}" fill="${bg}"/>
  <g font-family="Courier New, Courier, monospace" font-size="10" fill="${fill}" xml:space="preserve">
    ${lines.join('\n    ')}
  </g>
</svg>`;
}
