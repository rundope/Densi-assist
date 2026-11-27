import { makeSpec } from '../core/baseline/registry';
import {
  PROJECT_SCHEMA, type Band, type Calibration, type Gel, type Lane, type Project, type Target,
} from '../core/types';

export const uid = (prefix = '') =>
  prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export const TARGET_COLORS = ['#2f7fd8', '#e0712c', '#2aa876', '#c24dbd', '#d4a017', '#5a6fd6', '#d64f5a', '#3aa6b9'];

export function newProject(name = '새 프로젝트'): Project {
  const now = new Date().toISOString();
  return {
    schema: PROJECT_SCHEMA,
    id: uid('p'),
    name,
    createdAt: now,
    updatedAt: now,
    gels: [],
    targets: [],
    calibrations: [],
    settings: { negative: 'clip', loadingControlId: null, referenceSample: null },
  };
}

export function newGel(init: Pick<Gel, 'name' | 'fileName' | 'imageKey' | 'sha256' | 'sourceWidth' | 'sourceHeight' | 'bitDepth' | 'isRGB' | 'lossy'> & Partial<Gel>): Gel {
  return {
    id: uid('g'),
    page: 0,
    preprocess: { polarity: 'dark-bands', rotate90: 0, rotateFine: 0, flipH: false, grayMode: 'luminance' },
    background: { method: 'none', radius: 50, presmooth: true },
    display: { min: 0, max: init.bitDepth === 8 ? 255 : 65535, gamma: 1, showCorrected: false, applyToData: true, smooth: 0, smoothApply: true },
    profile: { aggregate: 'mean', edgeTrimPct: 10 },
    baseline: makeSpec('rolling-ball'),
    detection: { minProminencePct: 6, edgePct: 3, smoothing: 1.5 },
    lanes: [],
    notes: '',
    ...init,
  };
}

export function newLane(p: Pick<Lane, 'cx' | 'top' | 'bottom' | 'width'> & Partial<Lane>): Lane {
  return { id: uid('l'), sample: '', baseline: null, bands: [], excluded: false, ...p };
}

export function newBand(start: number, end: number, p: Partial<Band> = {}): Band {
  // p.id가 undefined로 들어와도 새 id를 잃지 않도록 각각 기본값을 준다
  return {
    id: p.id ?? uid('b'), start, end, targetId: p.targetId ?? null, tilt: p.tilt ?? 0,
    baseStart: p.baseStart ?? null, baseEnd: p.baseEnd ?? null,
  };
}

export function newTarget(existing: Target[], name?: string): Target {
  return {
    id: uid('t'),
    name: name ?? `타깃 ${existing.length + 1}`,
    color: TARGET_COLORS[existing.length % TARGET_COLORS.length],
    isLoadingControl: false,
  };
}

export function newCalibration(existing: Calibration[]): Calibration {
  return {
    id: uid('c'),
    name: `표준곡선 ${existing.length + 1}`,
    unit: 'ng',
    model: 'linear',
    weighting: 'none',
    targetId: null,
    signal: 'area',
    rows: Array.from({ length: 5 }, () => ({ id: uid('r'), amount: null, source: { kind: 'manual' as const, value: null }, excluded: false, note: '' })),
  };
}

/** 이전 버전 프로젝트 파일을 현재 구조로 맞춘다 */
export function migrateProject(p: Project): Project {
  if (p.schema !== PROJECT_SCHEMA) throw new Error(`지원하지 않는 프로젝트 형식입니다: ${String(p.schema)}`);
  p.settings ??= { negative: 'clip', loadingControlId: null, referenceSample: null };
  p.targets ??= [];
  p.calibrations ??= [];
  for (const g of p.gels) {
    g.display.applyToData ??= false;
    g.display.smooth ??= 0;
    g.display.smoothApply ??= true;
    for (const l of g.lanes) for (const b of l.bands) b.tilt ??= 0;
  }
  return p;
}
