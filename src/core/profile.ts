import type { Lane, ProfileSettings } from './types';

export interface ImagePlane {
  width: number;
  height: number;
  data: Float32Array;
}

export interface LaneProfile {
  /** 레인 폭 방향 평균(또는 중앙값) 프로파일. 인덱스 0 = 레인 top */
  values: Float64Array;
  /** 레인 바로 바깥 왼쪽/오른쪽 띠의 프로파일 (lane-edge 베이스라인용) */
  left: Float64Array;
  right: Float64Array;
  /** 행마다 포화 픽셀 수 */
  saturated: Uint16Array;
  top: number;
  x0: number;
  x1: number;
  /** 실제로 평균에 쓰인 열 수 (volume = area × columns) */
  columns: number;
  /** 이 프로파일을 만들 때 쓴 기울기 (px, 레인 폭 전체 기준) */
  tilt: number;
}

export function laneColumns(lane: Pick<Lane, 'cx' | 'width'>, imageWidth: number, edgeTrimPct: number) {
  const trim = (lane.width * Math.min(Math.max(edgeTrimPct, 0), 45)) / 100;
  let x0 = Math.round(lane.cx - lane.width / 2 + trim);
  let x1 = Math.round(lane.cx + lane.width / 2 - trim);
  x0 = Math.max(0, Math.min(imageWidth - 1, x0));
  x1 = Math.max(x0 + 1, Math.min(imageWidth, x1));
  return { x0, x1 };
}

/** 기울어진 밴드를 따라가도록 열마다 세로로 밀어서 값을 읽는다 (세로 선형 보간) */
function sampleColumn(data: Float32Array, w: number, h: number, x: number, y: number): number {
  if (y <= 0) return data[x];
  if (y >= h - 1) return data[(h - 1) * w + x];
  const y0 = Math.floor(y);
  const f = y - y0;
  return data[y0 * w + x] * (1 - f) + data[(y0 + 1) * w + x] * f;
}

export function extractProfile(
  signal: ImagePlane,
  raw: ImagePlane,
  saturationLevel: number,
  lane: Lane,
  settings: ProfileSettings,
  tilt = 0,
): LaneProfile {
  const { width: w, height: h, data } = signal;
  const top = Math.max(0, Math.min(h - 1, Math.round(lane.top)));
  const bottom = Math.max(top + 2, Math.min(h, Math.round(lane.bottom)));
  const len = bottom - top;
  const { x0, x1 } = laneColumns(lane, w, settings.edgeTrimPct);
  const cols = x1 - x0;
  const values = new Float64Array(len);
  const saturated = new Uint16Array(len);
  const buf = new Float64Array(cols);

  // lane-edge용 띠: 레인 폭의 10% (최소 2px) 만큼 레인 경계 바깥
  const band = Math.max(2, Math.round(lane.width * 0.1));
  const outerL0 = Math.max(0, Math.round(lane.cx - lane.width / 2) - band);
  const outerL1 = Math.max(outerL0 + 1, Math.round(lane.cx - lane.width / 2));
  const outerR0 = Math.min(w - 1, Math.round(lane.cx + lane.width / 2));
  const outerR1 = Math.min(w, Math.max(outerR0 + 1, outerR0 + band));
  const left = new Float64Array(len);
  const right = new Float64Array(len);

  // 열마다의 세로 이동량 (레인 중심에서 0)
  const shift = (x: number) => (tilt === 0 ? 0 : (tilt * (x - lane.cx)) / Math.max(1, lane.width));

  for (let r = 0; r < len; r++) {
    let sum = 0;
    let sat = 0;
    for (let x = x0, k = 0; x < x1; x++, k++) {
      const y = top + r + shift(x);
      const v = tilt === 0 ? data[(top + r) * w + x] : sampleColumn(data, w, h, x, y);
      buf[k] = v;
      sum += v;
      const ry = Math.max(0, Math.min(h - 1, Math.round(y)));
      if (raw.data[ry * w + x] >= saturationLevel) sat++;
    }
    if (settings.aggregate === 'median') {
      buf.sort();
      values[r] = cols % 2 ? buf[cols >> 1] : 0.5 * (buf[cols / 2 - 1] + buf[cols / 2]);
    } else {
      values[r] = sum / cols;
    }
    saturated[r] = sat;
    left[r] = stripMedian(data, w, h, top + r, outerL0, outerL1, shift);
    right[r] = stripMedian(data, w, h, top + r, outerR0, outerR1, shift);
  }
  return { values, left, right, saturated, top, x0, x1, columns: cols, tilt };
}

function stripMedian(data: Float32Array, w: number, h: number, row: number, a: number, b: number, shift: (x: number) => number): number {
  const n = b - a;
  if (n <= 0) return NaN;
  const tmp: number[] = [];
  for (let x = a; x < b; x++) tmp.push(sampleColumn(data, w, h, x, row + shift(x)));
  if (n === 1) return tmp[0];
  tmp.sort((p, q) => p - q);
  return n % 2 ? tmp[n >> 1] : 0.5 * (tmp[n / 2 - 1] + tmp[n / 2]);
}
