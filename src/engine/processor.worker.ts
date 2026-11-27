import { applyDisplayTransform, applyGeometry, gaussianBlur, percentile, toGray, toSignal } from '../core/image/preprocess';
import { applyBackground, estimateBackground } from '../core/image/background2d';
import type { Background2D, DisplaySettings, Preprocess } from '../core/types';
import { NEED_CHANNELS, baseKeyOf } from './workerProtocol';

export interface ProcessRequest {
  id: number;
  /** 겔 id와 이미지 식별자: 워커가 단계별 중간 결과를 겔마다 기억해 두는 데 쓴다 */
  gelId: string;
  imageId: string;
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

/**
 * 겔마다 마지막 중간 결과를 기억한다. 설정 하나만 바뀌면 그 앞 단계는 다시 계산하지 않는다.
 * - base: 회색 변환·기하·부드럽게·감마·극성까지 (배경 제거 전 신호)
 * - estimate: 배경 추정(롤링볼 등). 강도만 바뀌면 이것을 그대로 다시 쓴다.
 * 중간 결과는 워커 안에 두고, 메인 스레드에는 사본을 보낸다(전달하면 워커 쪽 배열이 비워지므로).
 */
interface GelCache {
  baseKey: string;
  width: number;
  height: number;
  raw: Float32Array;
  signal0: Float32Array;
  bgKey?: string;
  estimate?: Float32Array;
}
const cache = new Map<string, GelCache>();

self.onmessage = (ev: MessageEvent<ProcessRequest>) => {
  const req = ev.data;
  try {
    const smoothSigma = req.display.smoothApply && req.display.smooth > 0 ? req.display.smooth : 0;
    const gamma = req.display.applyToData && req.display.gamma !== 1 ? req.display.gamma : 1;
    const baseKey = baseKeyOf(req.imageId, req.preprocess, req.display);
    let c = cache.get(req.gelId);
    if (!c || c.baseKey !== baseKey) {
      // 메인 스레드가 "이미 갖고 있을 것"이라 보고 이미지 채널을 생략했는데 없으면 다시 보내 달라고 알린다
      if (!req.channels.length) { post({ id: req.id, type: 'error', message: NEED_CHANNELS }); return; }
      const gray = toGray(req, req.preprocess.grayMode);
      const geo = applyGeometry(gray, req.preprocess);
      const raw = geo.data;
      // 부드럽게 옵션을 측정에도 적용하면 신호용 이미지에만 블러를 건다. raw는 포화 판정과 표시를 위해 그대로 둔다.
      const base = smoothSigma > 0 ? { ...geo, data: gaussianBlur(raw, geo.width, geo.height, smoothSigma) } : { ...geo, data: raw };
      // 감마는 0~최대값 전체를 기준으로 적용한다(표시 범위는 화면 전용). 감마 1이면 아무것도 바꾸지 않는다.
      const forSignal = gamma !== 1 ? applyDisplayTransform(base, 0, base.maxValue, gamma) : base;
      c = { baseKey, width: geo.width, height: geo.height, raw, signal0: toSignal(forSignal, req.preprocess.polarity) };
      cache.set(req.gelId, c);
    }
    const signal = c.signal0.slice();
    let bg: Float32Array | null = null;
    const b = req.background;
    if (b.method !== 'none') {
      // 강도는 키에서 뺀다: 강도만 바뀌면 무거운 배경 추정을 건너뛴다
      const bgKey = JSON.stringify([b.method, b.radius, b.presmooth, b.method === 'constant' ? b.constantPct : null]);
      if (c.bgKey !== bgKey || !c.estimate) {
        c.estimate = estimateBackground(c.signal0, c.width, c.height, b, (fraction) => post({ id: req.id, type: 'progress', fraction }));
        c.bgKey = bgKey;
      }
      bg = applyBackground(signal, c.estimate, b);
    }
    const signalRange = percentile(signal, 0.5, 99.8);
    const raw = c.raw.slice();
    const msg: ProcessResponse = { id: req.id, type: 'done', width: c.width, height: c.height, raw, signal, background: bg, signalRange };
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
