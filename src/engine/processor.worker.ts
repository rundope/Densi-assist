import { applyDisplayTransform, applyGeometry, gaussianBlur, percentile, toGray, toSignal } from '../core/image/preprocess';
import { estimateBackground2D } from '../core/image/background2d';
import type { Background2D, DisplaySettings, Preprocess } from '../core/types';

export interface ProcessRequest {
  id: number;
  width: number;
  height: number;
  bitDepth: 8 | 16 | 32;
  maxValue: number;
  channels: Float32Array[];
  preprocess: Preprocess;
  background: Background2D;
  display: DisplaySettings;
}

export type ProcessResponse =
  | { id: number; type: 'progress'; fraction: number }
  | {
      id: number;
      type: 'done';
      width: number;
      height: number;
      raw: Float32Array;
      signal: Float32Array;
      background: Float32Array | null;
      signalRange: [number, number];
    }
  | { id: number; type: 'error'; message: string };

self.onmessage = (ev: MessageEvent<ProcessRequest>) => {
  const req = ev.data;
  try {
    const gray = toGray(req, req.preprocess.grayMode);
    const geo = applyGeometry(gray, req.preprocess);
    // 요청 채널은 structured clone으로 받은 사본이므로 그대로 transfer해도 된다
    const raw = geo.data;
    // 부드럽게 옵션을 측정에도 적용하면 신호용 이미지에만 블러를 건다. raw는 포화 판정과 표시를 위해 그대로 둔다.
    const smoothSigma = req.display.smoothApply && req.display.smooth > 0 ? req.display.smooth : 0;
    const base = smoothSigma > 0 ? { ...geo, data: gaussianBlur(raw, geo.width, geo.height, smoothSigma) } : { ...geo, data: raw };
    // 감마·표시 범위를 정량에 적용하기로 했다면 신호를 만들기 전에 변환한다.
    // raw(원본 값)는 화면 표시와 포화 판정을 위해 그대로 둔다.
    // 감마는 0~최대값 전체를 기준으로 적용한다(표시 범위는 화면 전용). 감마 1이면 아무것도 바꾸지 않는다.
    const forSignal = req.display.applyToData && req.display.gamma !== 1
      ? applyDisplayTransform(base, 0, base.maxValue, req.display.gamma)
      : base;
    const signal = toSignal(forSignal, req.preprocess.polarity);
    let bg: Float32Array | null = null;
    if (req.background.method !== 'none') {
      bg = estimateBackground2D(signal, geo.width, geo.height, {
        method: req.background.method,
        radius: Math.max(1, req.background.radius),
        presmooth: req.background.presmooth,
        onProgress: (fraction) => post({ id: req.id, type: 'progress', fraction }),
      });
      for (let i = 0; i < signal.length; i++) signal[i] -= bg[i];
    }
    const signalRange = percentile(signal, 0.5, 99.8);
    const msg: ProcessResponse = { id: req.id, type: 'done', width: geo.width, height: geo.height, raw, signal, background: bg, signalRange };
    const transfer: Transferable[] = [raw.buffer, signal.buffer];
    if (bg) transfer.push(bg.buffer);
    (self as unknown as Worker).postMessage(msg, transfer);
  } catch (e) {
    post({ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};

function post(msg: ProcessResponse) {
  (self as unknown as Worker).postMessage(msg);
}
