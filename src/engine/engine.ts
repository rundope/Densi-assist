import { decodeImage, type DecodedImage } from '../core/io/decode';
import { computeBaseline } from '../core/baseline/registry';
import { measureBand, type BandMeasure } from '../core/bands';
import { extractProfile, type LaneProfile } from '../core/profile';
import type { BaselineSpec, Gel, Lane, NegativeHandling } from '../core/types';
import { getImage } from './imageStore';
import type { ProcessRequest, ProcessResponse } from './processor.worker';
import { createProcessorWorker } from './createWorker';

export interface ProcessedGel {
  key: string;
  width: number;
  height: number;
  bitDepth: 8 | 16 | 32;
  maxValue: number;
  /** 회전 등 기하 변환만 적용된 원본 값 */
  raw: Float32Array;
  /** 밴드가 양수인 신호 (극성 변환 + 2D 배경 제거) */
  signal: Float32Array;
  background: Float32Array | null;
  signalRange: [number, number];
}

export type GelStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'processing'; progress: number }
  | { state: 'ready'; data: ProcessedGel }
  | { state: 'error'; message: string; key?: string };

type Listener = () => void;

const decoded = new Map<string, Promise<DecodedImage>>();
const statuses = new Map<string, GelStatus>();
const inflight = new Map<string, string>(); // gelId → key 처리 중
const listeners = new Set<Listener>();
let version = 0;

let worker: Worker | null = null;
let reqId = 0;
const pending = new Map<number, { gelId: string; key: string; decodedImg: DecodedImage }>();

function getWorker() {
  if (!worker) {
    worker = createProcessorWorker();
    // 워커를 불러오지 못하면 "처리 중"에 멈추지 않고 오류로 알린다
    worker.onerror = (e) => {
      const message = `이미지 처리 모듈을 불러오지 못했습니다${e.message ? `: ${e.message}` : ''}. 웹 주소(http)로 접속하거나 Densi-assist.html을 Chrome·Edge로 여세요.`;
      for (const [id, p] of pending) {
        pending.delete(id);
        inflight.delete(p.gelId);
        setStatus(p.gelId, { state: 'error', message, key: p.key });
      }
    };
    worker.onmessage = (ev: MessageEvent<ProcessResponse>) => {
      const msg = ev.data;
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') {
        if (inflight.get(p.gelId) === p.key) setStatus(p.gelId, { state: 'processing', progress: msg.fraction });
        return;
      }
      pending.delete(msg.id);
      if (inflight.get(p.gelId) !== p.key) return; // 더 새로운 요청이 있음
      inflight.delete(p.gelId);
      if (msg.type === 'error') {
        setStatus(p.gelId, { state: 'error', message: msg.message, key: p.key });
        return;
      }
      setStatus(p.gelId, {
        state: 'ready',
        data: {
          key: p.key, width: msg.width, height: msg.height,
          bitDepth: p.decodedImg.bitDepth, maxValue: p.decodedImg.maxValue,
          raw: msg.raw, signal: msg.signal, background: msg.background, signalRange: msg.signalRange,
        },
      });
    };
  }
  return worker;
}

function setStatus(gelId: string, s: GelStatus) {
  statuses.set(gelId, s);
  version++;
  listeners.forEach((l) => l());
}

export const engine = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  version: () => version,

  processingKey(gel: Gel) {
    // 표시 설정은 보통 정량에 영향이 없으므로, 데이터에 적용할 때만 키에 넣는다
    const display = gel.display.applyToData ? [gel.display.min, gel.display.max, gel.display.gamma] : null;
    // 부드럽게 한 이미지를 측정에도 쓸 때만 키에 넣는다 (화면 전용이면 다시 처리할 필요 없음)
    const smooth = gel.display.smoothApply && gel.display.smooth > 0 ? gel.display.smooth : 0;
    return JSON.stringify([gel.imageKey, gel.page, gel.preprocess, gel.background, display, smooth]);
  },

  getDecoded(gel: Pick<Gel, 'imageKey' | 'page' | 'fileName'>): Promise<DecodedImage> {
    const k = `${gel.imageKey}#${gel.page}`;
    let p = decoded.get(k);
    if (!p) {
      p = (async () => {
        const bytes = await getImage(gel.imageKey);
        if (!bytes) throw new Error('원본 이미지를 찾을 수 없습니다. 프로젝트 파일에서 다시 가져오세요.');
        return decodeImage(bytes, gel.fileName, gel.page);
      })();
      p.catch(() => decoded.delete(k));
      decoded.set(k, p);
    }
    return p;
  },

  status(gelId: string): GelStatus {
    return statuses.get(gelId) ?? { state: 'idle' };
  },

  /** 현재 설정으로 처리된 결과. 설정이 바뀌었으면 백그라운드 처리 시작 후 이전 결과(있다면)를 반환 */
  ensure(gel: Gel): ProcessedGel | null {
    const key = engine.processingKey(gel);
    const st = statuses.get(gel.id);
    if (st?.state === 'ready' && st.data.key === key) return st.data;
    if (inflight.get(gel.id) === key) return st?.state === 'ready' ? st.data : null;
    if (st?.state === 'error' && st.key === key) return null;
    inflight.set(gel.id, key);
    const prev = st?.state === 'ready' ? st : null;
    if (!prev) setStatus(gel.id, { state: 'loading' });
    engine.getDecoded(gel).then(
      (img) => {
        if (inflight.get(gel.id) !== key) return;
        const id = ++reqId;
        pending.set(id, { gelId: gel.id, key, decodedImg: img });
        const req: ProcessRequest = {
          id, width: img.width, height: img.height, bitDepth: img.bitDepth, maxValue: img.maxValue,
          channels: img.channels, preprocess: gel.preprocess, background: gel.background, display: gel.display,
        };
        getWorker().postMessage(req);
        if (!prev) setStatus(gel.id, { state: 'processing', progress: 0 });
      },
      (e: unknown) => {
        inflight.delete(gel.id);
        setStatus(gel.id, { state: 'error', message: e instanceof Error ? e.message : String(e), key });
      },
    );
    return prev ? prev.data : null;
  },

  /** 모든 겔 처리가 끝날 때까지 기다린다 */
  async whenReady(gel: Gel): Promise<ProcessedGel> {
    const key = engine.processingKey(gel);
    engine.ensure(gel);
    return new Promise((resolve, reject) => {
      const check = () => {
        const st = statuses.get(gel.id);
        if (st?.state === 'ready' && st.data.key === key) { unsub(); resolve(st.data); }
        else if (st?.state === 'error') { unsub(); reject(new Error(st.message)); }
      };
      const unsub = engine.subscribe(check);
      check();
    });
  },

  forget(gelId: string) {
    statuses.delete(gelId);
    inflight.delete(gelId);
  },
};

// ---------------- 레인 분석 (동기, 메모이즈) ----------------

export interface TiltVariant {
  profile: LaneProfile;
  baseline: Float64Array;
}

export interface LaneAnalysis {
  /** 기울기 0 기준 프로파일 (그래프·밴드 검출·베이스라인 편집용) */
  profile: LaneProfile;
  baseline: Float64Array;
  spec: BaselineSpec;
  measures: BandMeasure[];
  totalArea: number;
  /** 기울어진 밴드용 프로파일 (기울기 값별로 하나씩) */
  variants: Map<number, TiltVariant>;
}

/** 해당 기울기에서 쓰는 프로파일·베이스라인 */
export function variantFor(an: LaneAnalysis, tilt: number): TiltVariant {
  return an.variants.get(tilt) ?? { profile: an.profile, baseline: an.baseline };
}

const laneCache = new WeakMap<ProcessedGel, Map<string, { deps: unknown[]; result: LaneAnalysis }>>();

export function effectiveBaseline(gel: Gel, lane: Lane): BaselineSpec {
  return lane.baseline ?? gel.baseline;
}

export function analyzeLane(gel: Gel, lane: Lane, data: ProcessedGel, negative: NegativeHandling): LaneAnalysis {
  let perGel = laneCache.get(data);
  if (!perGel) { perGel = new Map(); laneCache.set(data, perGel); }
  const spec = effectiveBaseline(gel, lane);
  const deps = [lane.cx, lane.top, lane.bottom, lane.width, lane.bands, spec, gel.profile, negative];
  const hit = perGel.get(lane.id);
  if (hit && hit.deps.every((d, i) => d === deps[i])) return hit.result;

  const saturationLevel = data.bitDepth === 32 ? data.maxValue : data.maxValue * 0.999;
  const profile = extractProfile(
    { width: data.width, height: data.height, data: data.signal },
    { width: data.width, height: data.height, data: data.raw },
    saturationLevel, lane, gel.profile,
  );
  const baseline = computeBaseline(spec, { y: profile.values, left: profile.left, right: profile.right, bands: lane.bands });

  // 기울어진 밴드는 그 기울기로 다시 뽑은 프로파일에서 면적을 구한다
  const variants = new Map<number, TiltVariant>();
  for (const b of lane.bands) {
    const tilt = b.tilt ?? 0;
    if (!tilt || variants.has(tilt)) continue;
    const p = extractProfile(
      { width: data.width, height: data.height, data: data.signal },
      { width: data.width, height: data.height, data: data.raw },
      saturationLevel, lane, gel.profile, tilt,
    );
    variants.set(tilt, { profile: p, baseline: computeBaseline(spec, { y: p.values, left: p.left, right: p.right, bands: lane.bands }) });
  }

  const measures = lane.bands.map((b) => {
    const v = variants.get(b.tilt ?? 0) ?? { profile, baseline };
    return measureBand(b, v.profile.values, v.baseline, v.profile.saturated, v.profile.columns, negative);
  });
  const totalArea = measures.reduce((s, m) => s + m.area, 0);
  const result = { profile, baseline, spec, measures, totalArea, variants };
  perGel.set(lane.id, { deps, result });
  return result;
}
