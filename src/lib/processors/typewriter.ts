import { toGrayscale } from './imageUtils';

interface TypewriterOptions {
  cols?: number;
  contrast?: number;
}

// Character ramp: darkest (most ink) → lightest (least ink)
// These are the characters a real typewriter would produce, ordered by visual weight
const CHARS = ['M', 'B', 'F', 'O', 'A', 'I', '1', '0', ';', ':', '.', ',', ' '];

// Per-brightness-band, multiple character options to add organic variation
const CHAR_BANDS: string[][] = [
  ['M', 'M', 'B'],          // 0–7%   very dark
  ['B', 'M', 'B'],          // 8–15%
  ['F', 'B', 'F'],          // 16–23%
  ['O', 'F', 'O'],          // 24–31%
  ['A', 'O', 'A'],          // 32–39%
  ['F', 'A', 'I'],          // 40–47%
  ['I', 'A', 'I'],          // 48–55%
  ['1', 'I', '1'],          // 56–63%
  ['0', '1', '0'],          // 64–71%
  [';', '0', ':'],          // 72–79%
  [':', ';', '.'],          // 80–87%
  ['.', ',', '.'],          // 88–94%
  [' ', ' ', ' '],          // 95–100% very light
];

export function processTypewriter(imageData: ImageData, options: TypewriterOptions = {}): string {
  const { cols = 80, contrast = 1.2 } = options;

  const { width, height } = imageData;

  // Monospace character aspect ratio (width ÷ height) for Courier New ≈ 0.55
  const charAspect = 0.55;
  const rows = Math.round((height / width) * (cols / charAspect) * charAspect);

  const gray = toGrayscale(imageData);

  // Precompute a simple seeded pseudo-random for deterministic variation
  let seed = 31337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };

  // SVG character dimensions
  const svgFontSize = 10;
  const svgCharW = svgFontSize * charAspect;
  const svgCharH = svgFontSize;
  const svgWidth = Math.round(cols * svgCharW);
  const svgHeight = Math.round(rows * svgCharH);

  const lines: string[] = [];

  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < cols; col++) {
      const imgX = Math.min(Math.floor((col / cols) * width), width - 1);
      const imgY = Math.min(Math.floor((row / rows) * height), height - 1);

      // Apply contrast adjustment
      let brightness = gray[imgY * width + imgX] / 255;
      brightness = Math.min(1, Math.max(0, (brightness - 0.5) * contrast + 0.5));

      // Map brightness to a character band, then pick a variant for organic texture
      const bandIdx = Math.min(Math.floor(brightness * CHAR_BANDS.length), CHAR_BANDS.length - 1);
      const band = CHAR_BANDS[bandIdx];
      const char = band[Math.floor(rand() * band.length)];

      line += char;
    }

    const y = ((row + 1) * svgCharH).toFixed(1);
    const escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    lines.push(`<text x="0" y="${y}">${escaped}</text>`);
  }

  // Also export the character ramp used (useful for debugging)
  const charRef = CHARS.join('');
  void charRef;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">
  <rect width="${svgWidth}" height="${svgHeight}" fill="white"/>
  <g font-family="Courier New, Courier, monospace" font-size="${svgFontSize}" fill="black" xml:space="preserve">
    ${lines.join('\n    ')}
  </g>
</svg>`;
}
