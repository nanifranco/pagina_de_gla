import { toGrayscale } from './imageUtils';

interface SpiralOptions { spacing?: number; maxDisplacement?: number; }

export function processSpiral(imageData: ImageData, options: SpiralOptions = {}): string {
  const { spacing = 7, maxDisplacement = 8 } = options;
  const { width, height } = imageData;
  const gray = toGrayscale(imageData);
  const cx = width / 2, cy = height / 2;
  const maxR = Math.min(width, height) / 2 - 2;
  const pts: string[] = [];

  for (let angle = 0; ; angle += 0.05) {
    const r = (angle * spacing) / (2 * Math.PI);
    if (r > maxR) break;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const brightness = gray[Math.floor(y) * width + Math.floor(x)] / 255;
      const disp = (1 - brightness) * maxDisplacement;
      const nx = x + disp * Math.cos(angle + Math.PI / 2);
      const ny = y + disp * Math.sin(angle + Math.PI / 2);
      pts.push(`${pts.length === 0 ? 'M' : 'L'}${nx.toFixed(2)},${ny.toFixed(2)}`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <path d="${pts.join(' ')}" fill="none" stroke="black" stroke-width="0.7"/>
</svg>`;
}
