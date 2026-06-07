import { toGrayscale } from './imageUtils';

interface WavesOptions { rowSpacing?: number; maxAmplitude?: number; }

export function processWaves(imageData: ImageData, options: WavesOptions = {}): string {
  const { rowSpacing = 10, maxAmplitude = 10 } = options;
  const { width, height } = imageData;
  const gray = toGrayscale(imageData);
  const paths: string[] = [];

  for (let baseY = rowSpacing; baseY < height; baseY += rowSpacing) {
    let d = '';
    for (let x = 0; x < width; x++) {
      const brightness = gray[Math.floor(baseY) * width + Math.min(x, width - 1)] / 255;
      const waveY = baseY + maxAmplitude * (1 - brightness) * Math.sin((2 * Math.PI * x) / 20);
      d += x === 0 ? `M${x},${waveY.toFixed(2)}` : ` L${x},${waveY.toFixed(2)}`;
    }
    paths.push(`<path d="${d}"/>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <g fill="none" stroke="black" stroke-width="0.8">
    ${paths.join('\n    ')}
  </g>
</svg>`;
}
