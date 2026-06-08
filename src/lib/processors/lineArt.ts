import { toGrayscale, gaussianBlur } from './imageUtils';

interface LineArtOptions {
  numStrokes?: number;
  strokeLength?: number;
  noiseInfluence?: number;
  subjectMask?: Uint8Array; // optional pre-computed mask from Claude Vision
}

// Separable 1D Gaussian — O(n·k) instead of O(n·k²) for large sigmas
function separableBlur(data: Uint8Array, width: number, height: number, sigma: number): Uint8Array {
  const k = Math.max(3, Math.ceil(sigma * 2.5) * 2 + 1);
  const half = Math.floor(k / 2);
  const kernel = new Float32Array(k);
  let kSum = 0;
  for (let i = 0; i < k; i++) {
    const v = Math.exp(-((i - half) ** 2) / (2 * sigma * sigma));
    kernel[i] = v; kSum += v;
  }
  for (let i = 0; i < k; i++) kernel[i] /= kSum;

  const tmp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0;
      for (let i = 0; i < k; i++) {
        val += data[y * width + Math.max(0, Math.min(width - 1, x + i - half))] * kernel[i];
      }
      tmp[y * width + x] = Math.round(val);
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0;
      for (let i = 0; i < k; i++) {
        val += tmp[Math.max(0, Math.min(height - 1, y + i - half)) * width + x] * kernel[i];
      }
      out[y * width + x] = Math.round(val);
    }
  }
  return out;
}

function computeGradient(data: Uint8Array, width: number, height: number) {
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = (dx: number, dy: number) => data[(y + dy) * width + (x + dx)];
      gx[y * width + x] = (-p(-1,-1) - 2*p(-1,0) - p(-1,1) + p(1,-1) + 2*p(1,0) + p(1,1)) / 8;
      gy[y * width + x] = (-p(-1,-1) - 2*p(0,-1) - p(1,-1) + p(-1,1) + 2*p(0,1) + p(1,1)) / 8;
    }
  }
  return { gx, gy };
}

function buildNoiseTable(size: number, seed: number): Float32Array {
  const t = new Float32Array(size * size);
  let s = seed;
  const rng = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  for (let i = 0; i < t.length; i++) t[i] = rng() * Math.PI * 2;
  return t;
}

function sampleNoise(x: number, y: number, table: Float32Array, size: number): number {
  const xi = Math.floor(x) & (size - 1), yi = Math.floor(y) & (size - 1);
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const xi1 = (xi + 1) & (size - 1), yi1 = (yi + 1) & (size - 1);
  const a00 = table[yi * size + xi], a10 = table[yi * size + xi1];
  const a01 = table[yi1 * size + xi], a11 = table[yi1 * size + xi1];
  const cx = Math.cos(a00)*(1-u)*(1-v) + Math.cos(a10)*u*(1-v) + Math.cos(a01)*(1-u)*v + Math.cos(a11)*u*v;
  const cy = Math.sin(a00)*(1-u)*(1-v) + Math.sin(a10)*u*(1-v) + Math.sin(a01)*(1-u)*v + Math.sin(a11)*u*v;
  return Math.atan2(cy, cx);
}

// Average brightness along the image border — used to estimate background color
function borderBrightness(gray: Uint8Array, width: number, height: number): number {
  const m = Math.max(3, Math.floor(Math.min(width, height) * 0.07));
  let sum = 0, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < m || x >= width - m || y < m || y >= height - m) {
        sum += gray[y * width + x]; count++;
      }
    }
  }
  return sum / count;
}

// Subject importance mask:
// high value = likely subject, low value = likely background
function buildSubjectMask(gray: Uint8Array, width: number, height: number): Uint8Array {
  const bgVal = borderBrightness(gray, width, height);
  const raw = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Purely color-difference based — no center bias that contaminates background areas
      raw[y * width + x] = Math.min(255, Math.abs(gray[y * width + x] - bgVal) * 5.0);
    }
  }

  // Tighter blur (sigma 4 instead of 7) to avoid spreading subject values into background
  return separableBlur(raw, width, height, 4);
}

// Sobel applied to the mask → gives us the silhouette boundary
function maskEdges(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = (dx: number, dy: number) => mask[(y + dy) * width + (x + dx)];
      const gx = -p(-1,-1) - 2*p(-1,0) - p(-1,1) + p(1,-1) + 2*p(1,0) + p(1,1);
      const gy = -p(-1,-1) - 2*p(0,-1) - p(1,-1) + p(-1,1) + 2*p(0,1) + p(1,1);
      out[y * width + x] = Math.min(255, Math.sqrt(gx * gx + gy * gy) / 4);
    }
  }
  return out;
}

// Local texture intensity: std-deviation of 7×7 neighborhood
function localTexture(gray: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const r = 3, n = (r * 2 + 1) ** 2;
  for (let y = r; y < height - r; y++) {
    for (let x = r; x < width - r; x++) {
      let sum = 0, sumSq = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const v = gray[(y + dy) * width + (x + dx)];
          sum += v; sumSq += v * v;
        }
      }
      const mean = sum / n;
      out[y * width + x] = Math.min(255, Math.sqrt(Math.max(0, sumSq / n - mean * mean)) * 2);
    }
  }
  return out;
}

export function processLineArt(imageData: ImageData, options: LineArtOptions = {}): string {
  const { numStrokes = 10000, strokeLength = 14, noiseInfluence = 0.35, subjectMask } = options;
  const { width, height } = imageData;

  const gray      = toGrayscale(imageData);
  const smoothed  = gaussianBlur(gray, width, height, 1.2);
  const subject   = subjectMask ?? buildSubjectMask(gray, width, height);
  const boundary  = maskEdges(subject, width, height);
  const texture   = localTexture(gray, width, height);
  const { gx, gy } = computeGradient(smoothed, width, height);

  const NOISE_SIZE = 64;
  const noiseTable = buildNoiseTable(NOISE_SIZE, 7919);
  const noiseScale = 0.018;

  let seed = 48271;
  const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

  // Trace a single stroke from (sx, sy)
  function trace(sx: number, sy: number, steps: number, noiseW: number): string | null {
    const xs = [sx], ys = [sy];
    let x = sx, y = sy;
    for (let s = 0; s < steps; s++) {
      if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) break;
      const ix = Math.round(x), iy = Math.round(y);
      const idx = iy * width + ix;
      if (subject[idx] < 60) break; // stop when leaving subject zone

      const dGx = gx[idx], dGy = gy[idx];
      const gradMag = Math.sqrt(dGx * dGx + dGy * dGy);
      const flowAngle = Math.atan2(dGx, -dGy);
      const noiseAngle = sampleNoise(x * noiseScale, y * noiseScale, noiseTable, NOISE_SIZE);
      const blend = Math.min(gradMag / 25, 1);
      const nw = noiseW * (1 - blend);

      const bvx = Math.cos(flowAngle) * (1 - nw) + Math.cos(noiseAngle) * nw;
      const bvy = Math.sin(flowAngle) * (1 - nw) + Math.sin(noiseAngle) * nw;
      const mag = Math.sqrt(bvx * bvx + bvy * bvy) + 1e-6;
      x += (bvx / mag) * 1.4;
      y += (bvy / mag) * 1.4;
      xs.push(x); ys.push(y);
    }
    if (xs.length < 3) return null;
    let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
    for (let i = 1; i < xs.length; i++) d += ` L${xs[i].toFixed(1)},${ys[i].toFixed(1)}`;
    return d;
  }

  const silPaths: string[] = [];
  const strPaths: string[] = [];
  // 4 stroke-weight buckets for scribbles: dark→thick, light→thin
  const scr0: string[] = []; // brightness <0.30  → width 0.90
  const scr1: string[] = []; // brightness <0.50  → width 0.65
  const scr2: string[] = []; // brightness <0.70  → width 0.42
  const scr3: string[] = []; // brightness ≥0.70  → width 0.24

  // ── LAYER 1: SILHOUETTE ─────────────────────────────────────────────────
  const silBudget = Math.max(400, Math.floor(numStrokes * 0.06));
  let silGen = 0, silTry = 0;
  while (silGen < silBudget && silTry < silBudget * 25) {
    silTry++;
    const sx = rng() * width, sy = rng() * height;
    const bx = Math.max(0, Math.min(width - 1, Math.round(sx)));
    const by = Math.max(0, Math.min(height - 1, Math.round(sy)));
    if (rng() > (boundary[by * width + bx] / 255) * 2.5) continue;
    const s = trace(sx, sy, Math.round(strokeLength * 2.8), 0.04);
    if (s) { silPaths.push(s); silGen++; }
  }

  // ── LAYER 2: STRUCTURE ──────────────────────────────────────────────────
  const strBudget = Math.floor(numStrokes * 0.22);
  let strGen = 0, strTry = 0;
  while (strGen < strBudget && strTry < strBudget * 15) {
    strTry++;
    const sx = rng() * width, sy = rng() * height;
    const bx = Math.max(0, Math.min(width - 1, Math.round(sx)));
    const by = Math.max(0, Math.min(height - 1, Math.round(sy)));
    const mask = subject[by * width + bx] / 255;
    if (mask < 0.50) continue; // hard background gate
    const gMag = Math.sqrt(gx[by * width + bx] ** 2 + gy[by * width + bx] ** 2);
    const tex  = texture[by * width + bx] / 255;
    if (rng() > Math.min(1, (gMag / 18 + tex * 0.6) * mask)) continue;
    const s = trace(sx, sy, Math.round(strokeLength * 1.5), 0.1);
    if (s) { strPaths.push(s); strGen++; }
  }

  // ── LAYER 3: DENSITY SCRIBBLES (4 weight buckets) ───────────────────────
  const scrBudget = numStrokes - silGen - strGen;
  let scrGen = 0, scrTry = 0;
  while (scrGen < scrBudget && scrTry < scrBudget * 18) {
    scrTry++;
    const sx = rng() * width, sy = rng() * height;
    const bx = Math.max(0, Math.min(width - 1, Math.round(sx)));
    const by = Math.max(0, Math.min(height - 1, Math.round(sy)));
    const maskNorm = subject[by * width + bx] / 255;

    // Hard background gate — no strokes outside subject
    if (maskNorm < 0.50) continue;
    const maskFactor = Math.min(1, (maskNorm - 0.50) / 0.50);

    const bright = smoothed[by * width + bx] / 255;
    const tex    = texture[by * width + bx] / 255;
    // Density: dark zones get many strokes, bright zones get few (but never zero)
    const density = 0.12 + 0.88 * Math.pow(1 - bright, 0.6) + 0.28 * tex;
    const acc = Math.min(1, maskFactor * density);
    if (rng() > acc) continue;

    const s = trace(sx, sy, strokeLength, noiseInfluence);
    if (!s) continue;

    // Route to weight bucket based on local brightness
    if (bright < 0.30)      scr0.push(s);
    else if (bright < 0.50) scr1.push(s);
    else if (bright < 0.70) scr2.push(s);
    else                    scr3.push(s);
    scrGen++;
  }

  const w = width, h = height;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <rect width="${w}" height="${h}" fill="white"/>
  <path d="${scr3.join(' ')}" fill="none" stroke="black" stroke-width="0.24" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${scr2.join(' ')}" fill="none" stroke="black" stroke-width="0.42" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${scr1.join(' ')}" fill="none" stroke="black" stroke-width="0.65" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${scr0.join(' ')}" fill="none" stroke="black" stroke-width="0.90" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${strPaths.join(' ')}" fill="none" stroke="black" stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${silPaths.join(' ')}" fill="none" stroke="black" stroke-width="1.1"  stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}
