import { toGrayscale, gaussianBlur, sobelEdges } from './imageUtils';

interface LineArtOptions { threshold?: number; blur?: number; }

export function processLineArt(imageData: ImageData, options: LineArtOptions = {}): string {
  const { threshold = 40, blur = 1.5 } = options;
  const { width, height } = imageData;
  const gray = toGrayscale(imageData);
  const blurred = gaussianBlur(gray, width, height, blur);
  const edges = sobelEdges(blurred, width, height);

  // Collect edge pixels as short strokes grouped into paths
  const pathParts: string[] = [];
  for (let y = 0; y < height; y++) {
    let inRun = false;
    let runStart = 0;
    for (let x = 0; x < width; x++) {
      const isEdge = edges[y * width + x] > threshold;
      if (isEdge && !inRun) { inRun = true; runStart = x; }
      else if (!isEdge && inRun) {
        inRun = false;
        if (x - runStart >= 1) {
          pathParts.push(`M${runStart},${y} H${x}`);
        }
      }
    }
    if (inRun && width - runStart >= 1) {
      pathParts.push(`M${runStart},${y} H${width}`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <path d="${pathParts.join(' ')}" fill="none" stroke="black" stroke-width="1" stroke-linecap="round"/>
</svg>`;
}
