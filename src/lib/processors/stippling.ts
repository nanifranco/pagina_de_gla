import { toGrayscale } from './imageUtils';

interface StipplingOptions { numPoints?: number; maxRadius?: number; minRadius?: number; }

export function processStippling(imageData: ImageData, options: StipplingOptions = {}): string {
  const { numPoints = 15000, maxRadius = 3, minRadius = 0.3 } = options;
  const { width, height } = imageData;
  const gray = toGrayscale(imageData);
  const circles: string[] = [];

  let seed = 12345;
  const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

  let attempts = 0;
  while (circles.length < numPoints && attempts < numPoints * 30) {
    attempts++;
    const x = rand() * width;
    const y = rand() * height;
    const brightness = gray[Math.floor(y) * width + Math.floor(x)] / 255;
    if (rand() > brightness) {
      const r = minRadius + (1 - brightness) * (maxRadius - minRadius);
      circles.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}"/>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <g fill="black">${circles.join('')}</g>
</svg>`;
}
