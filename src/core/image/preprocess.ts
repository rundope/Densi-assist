import type { GrayMode, Polarity, Preprocess, RawImage } from '../types';

export interface ChannelImage {
  width: number;
  height: number;
  bitDepth: 8 | 16 | 32;
  maxValue: number;
  channels: Float32Array[];
}

export function toGray(img: ChannelImage, mode: GrayMode): RawImage {
  const { width, height, channels } = img;
  const n = width * height;
  let data: Float32Array;
  if (channels.length === 1) {
    data = channels[0];
  } else {
    const [r, g, b] = channels;
    data = new Float32Array(n);
    switch (mode) {
      case 'red': data.set(r); break;
      case 'green': data.set(g); break;
      case 'blue': data.set(b); break;
      case 'mean': for (let i = 0; i < n; i++) data[i] = (r[i] + g[i] + b[i]) / 3; break;
      default: for (let i = 0; i < n; i++) data[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
    }
  }
  return { width, height, data, bitDepth: img.bitDepth, maxValue: img.maxValue };
}

/** 회전/뒤집기. 미세 회전은 크기를 유지하고 바깥은 가장자리 값으로 채운다 */
export function applyGeometry(img: RawImage, p: Pick<Preprocess, 'rotate90' | 'rotateFine' | 'flipH'>): RawImage {
  let out = img;
  if (p.rotate90) out = rotate90(out, p.rotate90);
  if (p.flipH) out = flipH(out);
  if (Math.abs(p.rotateFine) > 1e-3) out = rotateFine(out, p.rotateFine);
  return out;
}

function rotate90(img: RawImage, deg: 90 | 180 | 270): RawImage {
  const { width: w, height: h, data } = img;
  const nw = deg === 180 ? w : h;
  const nh = deg === 180 ? h : w;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number, ny: number;
      if (deg === 90) { nx = h - 1 - y; ny = x; }
      else if (deg === 180) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      out[ny * nw + nx] = data[y * w + x];
    }
  }
  return { ...img, width: nw, height: nh, data: out };
}

function flipH(img: RawImage): RawImage {
  const { width: w, height: h, data } = img;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = data[y * w + (w - 1 - x)];
  return { ...img, data: out };
}

function rotateFine(img: RawImage, deg: number): RawImage {
  const { width: w, height: h, data } = img;
  const out = new Float32Array(w * h);
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 출력 좌표를 역회전해 원본에서 샘플링
      const dx = x - cx, dy = y - cy;
      let sx = cos * dx + sin * dy + cx;
      let sy = -sin * dx + cos * dy + cy;
      sx = sx < 0 ? 0 : sx > w - 1 ? w - 1 : sx;
      sy = sy < 0 ? 0 : sy > h - 1 ? h - 1 : sy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
      const fx = sx - x0, fy = sy - y0;
      const top = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
      const bot = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
      out[y * w + x] = top * (1 - fy) + bot * fy;
    }
  }
  return { ...img, data: out };
}

/**
 * 표시 설정(범위 + 감마)을 픽셀 값 자체에 적용한다.
 * 감마 ≠ 1이면 신호와 값이 비례하지 않게 되므로 정량에는 권장하지 않는다.
 */
export function applyDisplayTransform(img: RawImage, min: number, max: number, gamma: number): RawImage {
  const span = max - min || 1;
  const g = 1 / Math.max(gamma, 0.01);
  const out = new Float32Array(img.data.length);
  for (let i = 0; i < out.length; i++) {
    let n = (img.data[i] - min) / span;
    n = n < 0 ? 0 : n > 1 ? 1 : n;
    out[i] = img.maxValue * Math.pow(n, g);
  }
  return { ...img, data: out };
}

/** 밴드가 큰 값이 되도록 신호 이미지로 변환 */
export function toSignal(img: RawImage, polarity: Polarity): Float32Array {
  const { data, maxValue } = img;
  const out = new Float32Array(data.length);
  if (polarity === 'light-bands') {
    out.set(data);
  } else if (polarity === 'dark-bands') {
    for (let i = 0; i < data.length; i++) out[i] = maxValue - data[i];
  } else {
    // OD = log10(I0 / I). ImageJ의 0.434·ln(255/(255−inverted))와 같은 식 (I = 원본 값)
    const floor = 0.5;
    for (let i = 0; i < data.length; i++) out[i] = Math.log10(maxValue / Math.max(data[i], floor));
  }
  return out;
}

/**
 * 밴드는 배경보다 적은 면적을 차지하는 날카로운 구조라는 점을 이용한다.
 * 열마다 중앙값(배경·비네팅)을 빼고 남은 잔차의 양쪽 꼬리를 비교해,
 * 어두운 쪽 꼬리가 길면 어두운 밴드로 본다. (가장자리 밝기 비교는 비네팅에 속는다)
 */
export function suggestPolarity(img: RawImage): Polarity {
  const { width: w, height: h, data } = img;
  const xs = Math.max(1, Math.floor(w / 300));
  const ys = Math.max(1, Math.floor(h / 300));
  const resid: number[] = [];
  const col: number[] = [];
  for (let x = 0; x < w; x += xs) {
    col.length = 0;
    for (let y = 0; y < h; y += ys) col.push(data[y * w + x]);
    const sorted = [...col].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    for (const v of col) resid.push(v - med);
  }
  resid.sort((a, b) => a - b);
  const at = (p: number) => resid[Math.min(resid.length - 1, Math.max(0, Math.round(p * (resid.length - 1))))];
  const low = -at(0.003), high = at(0.997);
  return low >= high ? 'dark-bands' : 'light-bands';
}

export function percentile(data: Float32Array, lowPct: number, highPct: number): [number, number] {
  const step = Math.max(1, Math.floor(data.length / 200000));
  const sample: number[] = [];
  for (let i = 0; i < data.length; i += step) if (Number.isFinite(data[i])) sample.push(data[i]);
  sample.sort((a, b) => a - b);
  if (!sample.length) return [0, 1];
  const at = (p: number) => sample[Math.min(sample.length - 1, Math.max(0, Math.round((p / 100) * (sample.length - 1))))];
  return [at(lowPct), at(highPct)];
}

export function histogram(data: Float32Array, min: number, max: number, bins = 256): Uint32Array {
  const h = new Uint32Array(bins);
  const span = max - min || 1;
  const step = Math.max(1, Math.floor(data.length / 500000));
  for (let i = 0; i < data.length; i += step) {
    let b = Math.floor(((data[i] - min) / span) * bins);
    if (b < 0) b = 0; else if (b >= bins) b = bins - 1;
    h[b]++;
  }
  return h;
}
