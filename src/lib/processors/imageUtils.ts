export function toGrayscale(imageData: ImageData): Uint8Array {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = Math.round(0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2]);
  }
  return gray;
}

export function gaussianBlur(data: Uint8Array, width: number, height: number, sigma: number): Uint8Array {
  const k = Math.max(3, Math.ceil(sigma * 3) * 2 + 1);
  const half = Math.floor(k / 2);
  const kernel = new Float32Array(k * k);
  let sum = 0;
  for (let ky = 0; ky < k; ky++) {
    for (let kx = 0; kx < k; kx++) {
      const dx = kx - half, dy = ky - half;
      const val = Math.exp(-(dx*dx + dy*dy) / (2 * sigma * sigma));
      kernel[ky * k + kx] = val;
      sum += val;
    }
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let val = 0;
      for (let ky = 0; ky < k; ky++) {
        for (let kx = 0; kx < k; kx++) {
          const sx = Math.min(Math.max(x + kx - half, 0), width - 1);
          const sy = Math.min(Math.max(y + ky - half, 0), height - 1);
          val += data[sy * width + sx] * kernel[ky * k + kx];
        }
      }
      result[y * width + x] = Math.round(val);
    }
  }
  return result;
}

export function sobelEdges(data: Uint8Array, width: number, height: number): Uint8Array {
  const result = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = (dx: number, dy: number) => data[(y + dy) * width + (x + dx)];
      const gx = -p(-1,-1) - 2*p(-1,0) - p(-1,1) + p(1,-1) + 2*p(1,0) + p(1,1);
      const gy = -p(-1,-1) - 2*p(0,-1) - p(1,-1) + p(-1,1) + 2*p(0,1) + p(1,1);
      result[y * width + x] = Math.min(255, Math.sqrt(gx*gx + gy*gy));
    }
  }
  return result;
}
