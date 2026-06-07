import { toGrayscale, gaussianBlur } from './imageUtils';

interface LineArtOptions {
  numStrokes?: number;
  strokeLength?: number;
  noiseInfluence?: number;
}

function computeGradient(
  data: Uint8Array,
  width: number,
  height: number
): { gx: Float32Array; gy: Float32Array } {
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

// Smooth angle noise table — interpolated as unit vectors to avoid wrap artifacts
function buildNoiseTable(size: number, seed: number): Float32Array {
  const t = new Float32Array(size * size);
  let s = seed;
  const rng = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
  for (let i = 0; i < t.length; i++) t[i] = rng() * Math.PI * 2;
  return t;
}

function sampleNoise(x: number, y: number, table: Float32Array, size: number): number {
  const xi = Math.floor(x) & (size - 1);
  const yi = Math.floor(y) & (size - 1);
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const xi1 = (xi + 1) & (size - 1);
  const yi1 = (yi + 1) & (size - 1);
  const a00 = table[yi  * size + xi ],  a10 = table[yi  * size + xi1];
  const a01 = table[yi1 * size + xi ],  a11 = table[yi1 * size + xi1];
  const cx = Math.cos(a00)*(1-u)*(1-v) + Math.cos(a10)*u*(1-v) + Math.cos(a01)*(1-u)*v + Math.cos(a11)*u*v;
  const cy = Math.sin(a00)*(1-u)*(1-v) + Math.sin(a10)*u*(1-v) + Math.sin(a01)*(1-u)*v + Math.sin(a11)*u*v;
  return Math.atan2(cy, cx);
}

export function processLineArt(imageData: ImageData, options: LineArtOptions = {}): string {
  const { numStrokes = 10000, strokeLength = 14, noiseInfluence = 0.35 } = options;
  const { width, height } = imageData;

  const gray = toGrayscale(imageData);
  const smoothed = gaussianBlur(gray, width, height, 1.2);
  const { gx, gy } = computeGradient(smoothed, width, height);

  const NOISE_SIZE = 64;
  const noiseTable = buildNoiseTable(NOISE_SIZE, 7919);
  const noiseScale = 0.018;

  let seed = 48271;
  const rng = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

  const pathParts: string[] = [];
  let generated = 0;
  let attempts = 0;
  const maxAttempts = numStrokes * 20;

  while (generated < numStrokes && attempts < maxAttempts) {
    attempts++;

    const sx = rng() * width;
    const sy = rng() * height;
    const bx = Math.max(0, Math.min(width  - 1, Math.round(sx)));
    const by = Math.max(0, Math.min(height - 1, Math.round(sy)));
    const brightness = smoothed[by * width + bx] / 255;

    // Rejection sampling: dark zones have much higher acceptance
    if (rng() > Math.pow(1 - brightness, 1.6)) continue;

    // Adaptive length: longer in flat areas, shorter at sharp edges
    const gMag0 = Math.sqrt(gx[by * width + bx] ** 2 + gy[by * width + bx] ** 2);
    const steps = Math.round(strokeLength * (1 + 1 / (gMag0 / 8 + 1)));

    const xs: number[] = [sx];
    const ys: number[] = [sy];
    let x = sx, y = sy;

    for (let s = 0; s < steps; s++) {
      if (x < 1 || x >= width - 1 || y < 1 || y >= height - 1) break;
      const ix = Math.round(x), iy = Math.round(y);
      const idx = iy * width + ix;

      if (gray[idx] / 255 > 0.93) break;

      const dGx = gx[idx], dGy = gy[idx];
      const gradMag = Math.sqrt(dGx * dGx + dGy * dGy);

      // Perpendicular to gradient → strokes flow along iso-brightness contours
      const flowAngle = Math.atan2(dGx, -dGy);
      const noiseAngle = sampleNoise(x * noiseScale, y * noiseScale, noiseTable, NOISE_SIZE);

      const blendFactor = Math.min(gradMag / 25, 1);
      const noiseW = noiseInfluence * (1 - blendFactor);

      // Blend as unit vectors (no angle-wrap artifacts)
      const bvx = Math.cos(flowAngle) * (1 - noiseW) + Math.cos(noiseAngle) * noiseW;
      const bvy = Math.sin(flowAngle) * (1 - noiseW) + Math.sin(noiseAngle) * noiseW;
      const mag = Math.sqrt(bvx * bvx + bvy * bvy) + 1e-6;

      x += (bvx / mag) * 1.4;
      y += (bvy / mag) * 1.4;
      xs.push(x);
      ys.push(y);
    }

    if (xs.length < 3) continue;

    let d = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
    for (let i = 1; i < xs.length; i++) d += ` L${xs[i].toFixed(1)},${ys[i].toFixed(1)}`;
    pathParts.push(d);
    generated++;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="white"/>
  <path d="${pathParts.join(' ')}" fill="none" stroke="black" stroke-width="0.55" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}
