import { toGrayscale } from './imageUtils';

interface TypewriterOptions {
  cols?: number;
  contrast?: number;
  brightness?: number;
  charSet?: number; // 0=typewriter 1=dense 2=minimal 3=symbolic 4=numbers
  invert?: number;  // 0=normal 1=inverted
}

const CHAR_SETS: string[][] = [
  // 0 — Typewriter Classic (dark → light)
  ['@','W','M','#','$','B','&','%','m','w','X','H','A','D','K','Q','0','O','N','8',
   'G','U','E','b','d','h','k','q','p','n','u','x','y','o','e','a','f','t','s','r',
   '1','v','i','l','c','j','!',';',':',',','.','\'','-',' '],
  // 1 — Dense / Detailed
  ['@','#','W','M','$','B','&','%','*','o','=','+','-',':','.',' '],
  // 2 — Minimal / Clean
  ['@','#','O','o','=','-',':','.',' '],
  // 3 — Symbolic / Glyphs
  ['♠','♣','♦','♥','★','●','■','▲','◆','○','□','△','◇','·',' '],
  // 4 — Numbers Only
  ['8','9','6','0','3','5','2','4','7','1','.',' '],
];

export const CHAR_SET_NAMES = ['Typewriter', 'Dense', 'Minimal', 'Symbolic', 'Numbers'];

function applyContrastBrightness(lum: number, contrast: number, brightness: number): number {
  let v = lum + brightness;
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  v = factor * (v - 128) + 128;
  return Math.max(0, Math.min(255, v));
}

export function processTypewriter(imageData: ImageData, options: TypewriterOptions = {}): string {
  const {
    cols      = 120,
    contrast  = 20,
    brightness = 0,
    charSet   = 0,
    invert    = 0,
  } = options;

  const { width, height } = imageData;
  const charAspect = 0.5;
  const rows = Math.round((height / width) * cols * charAspect);

  const gray = toGrayscale(imageData);
  void gray; // luminance computed from raw RGBA below for accuracy
  const chars = CHAR_SETS[Math.min(Math.round(charSet), CHAR_SETS.length - 1)];

  const svgFontSize = 10;
  const svgCharW = svgFontSize * 0.55;
  const svgCharH = svgFontSize;
  const svgWidth  = Math.round(cols * svgCharW);
  const svgHeight = Math.round(rows * svgCharH);

  const lines: string[] = [];

  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < cols; col++) {
      const imgX = Math.min(Math.floor((col / cols) * width),  width  - 1);
      const imgY = Math.min(Math.floor((row / rows) * height), height - 1);
      const base = (imgY * width + imgX) * 4;
      const r = imageData.data[base];
      const g = imageData.data[base + 1];
      const b = imageData.data[base + 2];

      // Perceptual luminance
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      let adjusted = applyContrastBrightness(lum, contrast, brightness);
      let norm = adjusted / 255;
      if (invert) norm = 1 - norm;

      const idx = Math.min(chars.length - 1, Math.floor(norm * chars.length));
      line += chars[idx];
    }

    const y = ((row + 1) * svgCharH).toFixed(1);
    const escaped = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    lines.push(`<text x="0" y="${y}">${escaped}</text>`);
  }

  const bg   = invert ? 'black' : 'white';
  const fill = invert ? 'white' : 'black';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}">
  <rect width="${svgWidth}" height="${svgHeight}" fill="${bg}"/>
  <g font-family="Courier New, Courier, monospace" font-size="${svgFontSize}" fill="${fill}" xml:space="preserve">
    ${lines.join('\n    ')}
  </g>
</svg>`;
}
