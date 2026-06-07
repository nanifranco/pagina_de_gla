interface ImageAnalysis {
  subjectBounds: { xMin: number; yMin: number; xMax: number; yMax: number };
  subjectType: 'portrait' | 'object' | 'landscape' | 'abstract';
  backgroundBrightness: number;
  darkRegions: Array<{ x: number; y: number; radius: number; weight: number }>;
  highDetailRegions: Array<{ x: number; y: number; radius: number; weight: number }>;
}

const ANALYSIS_PROMPT = `Analyze this image and return ONLY a JSON object (no markdown, no explanation) with this exact structure:
{
  "subjectBounds": { "xMin": 0.0, "yMin": 0.0, "xMax": 1.0, "yMax": 1.0 },
  "subjectType": "portrait",
  "backgroundBrightness": 0.8,
  "darkRegions": [{ "x": 0.5, "y": 0.5, "radius": 0.2, "weight": 1.0 }],
  "highDetailRegions": [{ "x": 0.5, "y": 0.5, "radius": 0.2, "weight": 1.0 }]
}

Rules:
- All coordinates normalized 0.0–1.0 (0,0 = top-left, 1,1 = bottom-right)
- subjectBounds: tight bounding box around the main subject
- subjectType: "portrait" for faces/people, "object" for products/items, "landscape" for scenes, "abstract" otherwise
- backgroundBrightness: estimated average brightness of background (0=black, 1=white)
- darkRegions: up to 6 shadow/dark areas that should have dense strokes
- highDetailRegions: up to 6 high-detail areas (faces, textures, sharp edges) needing fine strokes
- radius: approximate region radius as fraction of image size
- weight: importance 0.5–1.0
Return ONLY the JSON object.`;

export async function analyzeImageWithClaude(
  imageData: ImageData,
  apiKey: string
): Promise<ImageAnalysis | null> {
  // Downsample to max 512px for API efficiency
  const maxDim = 512;
  const scale = Math.min(1, maxDim / Math.max(imageData.width, imageData.height));
  const w = Math.round(imageData.width * scale);
  const h = Math.round(imageData.height * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(srcCanvas, 0, 0, w, h);

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const arrayBuffer = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: ANALYSIS_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const json = await response.json();
  const text: string = json.content?.[0]?.text ?? '';

  // Extract JSON — Claude sometimes wraps in ```json blocks despite instructions
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Claude response');

  return JSON.parse(jsonMatch[0]) as ImageAnalysis;
}

// Build an enhanced subject mask using Claude's analysis
// Returns a Uint8Array [0–255] the same size as the image
export function buildEnhancedSubjectMask(
  analysis: ImageAnalysis,
  width: number,
  height: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const { xMin, yMin, xMax, yMax } = analysis.subjectBounds;

  // Soft rectangular subject region
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  const rx = (xMax - xMin) / 2;
  const ry = (yMax - yMin) / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x / width - cx) / (rx + 0.05);
      const ny = (y / height - cy) / (ry + 0.05);
      // Smooth elliptical falloff
      const d2 = nx * nx + ny * ny;
      const v = Math.max(0, 1 - d2 * 0.85);
      mask[y * width + x] = Math.round(v * 220);
    }
  }

  // Boost high-detail regions
  for (const reg of analysis.highDetailRegions) {
    const px = reg.x * width;
    const py = reg.y * height;
    const rad = reg.radius * Math.min(width, height);
    const boost = reg.weight * 35;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - px, dy = y - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < rad * 2) {
          const f = Math.max(0, 1 - d / (rad * 2));
          mask[y * width + x] = Math.min(255, mask[y * width + x] + Math.round(f * boost));
        }
      }
    }
  }

  return mask;
}
