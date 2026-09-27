// 체험·검증용 합성 겔 이미지. 밴드 양을 알고 있으므로 정량 정확도를 확인할 수 있다.

export interface SynthBand {
  /** 0–1, 이미지 높이 대비 위치 */
  y: number;
  amount: number;
  sigma?: number;
}

export interface SynthLane {
  sample: string;
  bands: SynthBand[];
}

export interface SynthOptions {
  width: number;
  height: number;
  lanes: SynthLane[];
  seed?: number;
  /** 밴드 양 1당 봉우리 높이 */
  peakPerUnit?: number;
  background?: number;
  noise?: number;
  gradient?: number;
  smile?: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** 어두운 밴드 / 밝은 배경의 16-bit 이미지 (화학발광 이미저 내보내기와 비슷) */
export function synthesizeGel(o: SynthOptions): { data: Uint16Array; laneCenters: number[]; laneWidth: number } {
  const { width: w, height: h, lanes } = o;
  const rand = rng(o.seed ?? 7);
  const bgLevel = o.background ?? 52000;
  const peakPerUnit = o.peakPerUnit ?? 1500;
  const noise = o.noise ?? 350;
  const gradient = o.gradient ?? 5000;
  const smile = o.smile ?? 4;
  const pitch = w / (lanes.length + 0.6);
  const laneWidth = Math.round(pitch * 0.62);
  const laneCenters = lanes.map((_, i) => Math.round(pitch * (i + 0.8)));
  const signal = new Float64Array(w * h);

  lanes.forEach((lane, li) => {
    const cx = laneCenters[li];
    const half = laneWidth / 2;
    for (const b of lane.bands) {
      const sigma = b.sigma ?? h * 0.012;
      const cy = b.y * h;
      // 폭 방향 부드러운 사각형: 가장자리 ±3px에서 감쇠
      const peak = peakPerUnit * b.amount;
      const x0 = Math.max(0, Math.floor(cx - half - 6)), x1 = Math.min(w - 1, Math.ceil(cx + half + 6));
      const y0 = Math.max(0, Math.floor(cy - sigma * 5 - smile)), y1 = Math.min(h - 1, Math.ceil(cy + sigma * 5 + smile));
      for (let x = x0; x <= x1; x++) {
        const d = Math.abs(x - cx) - half;
        const edge = d <= -3 ? 1 : d >= 3 ? 0 : 0.5 - 0.5 * Math.sin((d / 3) * (Math.PI / 2));
        if (edge <= 0) continue;
        const u = (x - cx) / half;
        const yc = cy - smile * u * u;
        for (let y = y0; y <= y1; y++) {
          const t = (y - yc) / sigma;
          signal[y * w + x] += peak * edge * Math.exp(-0.5 * t * t);
        }
      }
    }
    // 레인을 따라 번진 약한 smear
    for (let y = 0; y < h * 0.95; y++) {
      // 웰 근처에서 부드럽게 시작 (smoothstep)
      const t = Math.min(1, Math.max(0, (y / h - 0.02) / 0.12));
      const ramp = t * t * (3 - 2 * t);
      for (let x = Math.round(cx - half); x <= cx + half; x++) signal[y * w + x] += 600 * ramp * (1 - y / h);
    }
  });

  const data = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const vignette = gradient * (((x - w / 2) / (w / 2)) ** 2 * 0.6 + (y / h) * 0.8);
      const n = (rand() + rand() + rand() - 1.5) * noise;
      const v = bgLevel - vignette - signal[y * w + x] + n;
      data[y * w + x] = Math.max(0, Math.min(65535, Math.round(v)));
    }
  }
  return { data, laneCenters, laneWidth };
}
