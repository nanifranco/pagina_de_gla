import { toGrayscale } from './imageUtils';

interface CrosshatchOptions { lineSpacing?: number; }

export function processCrosshatch(imageData: ImageData, options: CrosshatchOptions = {}): string {
  const { lineSpacing = 8 } = options;
  const { width, height } = imageData;
  const gray = toGrayscale(imageData);

  function hatch(angleRad: number, threshold: number): string[] {
    const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
    const diag = Math.sqrt(width * width + height * height);
    const parts: string[] = [];
    for (let d = -diag; d < diag; d += lineSpacing) {
      const cx = width / 2 + d * cos, cy = height / 2 + d * sin;
      let inSeg = false, segPts: string[] = [];
      for (let t = -diag; t <= diag; t += 1.5) {
        const x = cx - sin * t, y = cy + cos * t;
        if (x < 0 || x >= width || y < 0 || y >= height) {
          if (inSeg && segPts.length > 1) parts.push(`M${segPts[0]} L${segPts.slice(1).join(' L')}`);
          inSeg = false; segPts = []; continue;
        }
        const brightness = gray[Math.floor(y) * width + Math.floor(x)] / 255;
        if (brightness < threshold) {
          inSeg = true; segPts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        } else {
          if (inSeg && segPts.length > 1) parts.push(`M${segPts[0]} L${segPts.slice(1).join(' L')}`);
          inSeg = false; segPts = [];
        }
      }
      if (inSeg && segPts.length > 1) parts.push(`M${segPts[0]} L${segPts.slice(1).join(' L')}`);
    }
    return parts;
  }

  const all = [
    ...hatch(Math.PI / 4, 0.7),
    ...hatch((3 * Math.PI) / 4, 0.7),
    ...hatch(Math.PI / 2, 0.35),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <path d="${all.join(' ')}" fill="none" stroke="black" stroke-width="0.8" stroke-linecap="round"/>
</svg>`;
}
