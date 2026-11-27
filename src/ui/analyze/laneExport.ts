import { BASELINE_MAP } from '../../core/baseline/registry';
import type { Gel, Lane, Target } from '../../core/types';
import { analyzeLane, variantFor, type LaneAnalysis, type ProcessedGel } from '../../engine/engine';
import { downloadBlob, safeName } from '../../state/persist';
import { useApp } from '../../state/store';
import { BAND_DEFAULT_COLOR } from '../colors';
import { fmt, fmtPct, renderToImageData, sourceFor } from '../render';
import { zipSync } from 'fflate';

/**
 * 기울어진 밴드 구간은 그 기울기로 다시 뽑은 프로파일·바닥선으로 바꿔 끼운 곡선.
 * 화면 그래프와 내보낸 이미지가 실제로 적분하는 값과 같은 선을 그리도록 한 곳에서 계산한다.
 */
export function composedProfile(an: LaneAnalysis, lane: Lane) {
  const n = an.profile.values.length;
  const y = new Float64Array(an.profile.values);
  const base = new Float64Array(an.baseline);
  for (const b of lane.bands) {
    if (!b.tilt) continue;
    const v = variantFor(an, b.tilt);
    for (let i = Math.max(0, b.start); i <= Math.min(n - 1, b.end); i++) {
      y[i] = v.profile.values[i];
      base[i] = v.baseline[i];
    }
  }
  return { y, base };
}

function niceTicks(lo: number, hi: number, count: number) {
  const span = hi - lo || 1;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

const W = 1600, H = 1000;
const FONT = '"Pretendard", system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

/** 레인 하나의 그래프(제목 + 레인 띠 + 프로파일·바닥선·밴드 면적)를 흰 배경 PNG로 그린다 */
export function drawLaneGraph(gel: Gel, lane: Lane, index: number, data: ProcessedGel, an: LaneAnalysis, targets: Target[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);

  const { y, base } = composedProfile(an, lane);
  const n = y.length;
  const L = 110, R = 40, T = 230, B = 90;
  const iw = W - L - R, ih = H - T - B;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, y[i], base[i]); hi = Math.max(hi, y[i], base[i]); }
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad; hi += pad;
  // 밴드 번호·비율·면적 글자가 봉우리와 겹치지 않게 위쪽을 더 비워 둔다
  if (lane.bands.length) hi += (hi - lo) * 0.18;
  const sx = (i: number) => L + (i / Math.max(1, n - 1)) * iw;
  const sy = (v: number) => T + (1 - (v - lo) / (hi - lo)) * ih;

  // 제목
  g.fillStyle = '#1d2330';
  g.font = `700 34px ${FONT}`;
  g.textBaseline = 'alphabetic';
  g.fillText(`레인 ${index + 1}${lane.sample ? ` · ${lane.sample}` : ''}`, L, 56);
  g.font = `400 20px ${FONT}`;
  g.fillStyle = '#5b6474';
  const spec = lane.baseline ?? gel.baseline;
  g.fillText(`${gel.name} · 베이스라인: ${BASELINE_MAP[spec.method]?.label ?? spec.method}${lane.bands.length ? ` · 밴드 ${lane.bands.length}개 · 전체 면적 ${fmt(an.totalArea)}` : " · 밴드 없음"}`, L, 90);

  // 레인 띠: 레인을 눕혀(위 → 왼쪽) 그래프 x축과 맞춘다
  const src = sourceFor(gel, data);
  const top = Math.max(0, Math.round(lane.top));
  const len = Math.max(2, Math.min(data.height, Math.round(lane.bottom)) - top);
  const x0 = Math.max(0, Math.round(lane.cx - lane.width / 2));
  const x1 = Math.min(data.width, Math.round(lane.cx + lane.width / 2));
  const hgt = Math.max(1, x1 - x0);
  const vals = new Float32Array(len * hgt);
  for (let r = 0; r < hgt; r++) for (let i = 0; i < len; i++) vals[r * len + i] = src.values[(top + i) * data.width + x0 + r];
  const strip = document.createElement('canvas');
  strip.width = len;
  strip.height = hgt;
  strip.getContext('2d')!.putImageData(renderToImageData({ ...src, width: len, height: hgt, values: vals }), 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(strip, L, 112, iw, 90);
  g.strokeStyle = '#c9ced8';
  g.lineWidth = 1;
  g.strokeRect(L + 0.5, 112.5, iw - 1, 89);

  // 격자와 눈금
  g.font = `400 18px ${FONT}`;
  g.fillStyle = '#5b6474';
  g.strokeStyle = '#e6e9ef';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (const v of niceTicks(lo, hi, 6)) {
    g.beginPath(); g.moveTo(L, sy(v)); g.lineTo(W - R, sy(v)); g.stroke();
    g.fillText(fmt(v, 3), L - 10, sy(v));
  }
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const v of niceTicks(0, n - 1, 10)) g.fillText(String(Math.round(v)), sx(v), T + ih + 10);
  g.fillText('레인 위치 (px, 위 → 아래)', L + iw / 2, T + ih + 44);
  g.save();
  g.translate(28, T + ih / 2);
  g.rotate(-Math.PI / 2);
  g.textBaseline = 'middle';
  g.fillText('진하기 (신호)', 0, 0);
  g.restore();

  // 밴드 면적(칠한 부분)과 경계선, 번호·비율
  lane.bands.forEach((b, bi) => {
    const t = targets.find((q) => q.id === b.targetId);
    const col = t?.color ?? BAND_DEFAULT_COLOR;
    g.beginPath();
    g.moveTo(sx(b.start), sy(base[b.start]));
    for (let i = b.start; i <= b.end; i++) g.lineTo(sx(i), sy(y[i]));
    for (let i = b.end; i >= b.start; i--) g.lineTo(sx(i), sy(base[i]));
    g.closePath();
    g.globalAlpha = 0.28;
    g.fillStyle = col;
    g.fill();
    g.globalAlpha = 0.6;
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    for (const i of [b.start, b.end]) { g.beginPath(); g.moveTo(sx(i), T); g.lineTo(sx(i), T + ih); g.stroke(); }
    g.globalAlpha = 1;
    const m = an.measures[bi];
    const pct = an.totalArea > 0 && m ? (m.area / an.totalArea) * 100 : 0;
    const cx = (sx(b.start) + sx(b.end)) / 2;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillStyle = col;
    g.font = `700 20px ${FONT}`;
    g.fillText(`${bi + 1}${t ? ` ${t.name}` : ''}`, cx, T + 6);
    g.fillStyle = '#5b6474';
    g.font = `400 17px ${FONT}`;
    g.fillText(fmtPct(pct), cx, T + 30);
    if (m) g.fillText(fmt(m.area), cx, T + 52);
  });

  // 프로파일(검은 선)과 바닥선(주황 점선)
  const line = (arr: ArrayLike<number>) => {
    g.beginPath();
    for (let i = 0; i < n; i++) (i ? g.lineTo : g.moveTo).call(g, sx(i), sy(arr[i]));
    g.stroke();
  };
  g.lineWidth = 2;
  g.strokeStyle = '#1d2330';
  line(y);
  g.setLineDash([8, 6]);
  g.strokeStyle = '#e0712c';
  line(base);
  g.setLineDash([]);
  g.strokeStyle = '#9aa3b2';
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(L, T); g.lineTo(L, T + ih); g.lineTo(W - R, T + ih); g.stroke();

  // 범례
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = `400 17px ${FONT}`;
  const lx = W - R - 330, ly = 56;
  g.strokeStyle = '#1d2330'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + 36, ly); g.stroke();
  g.fillStyle = '#1d2330'; g.fillText('프로파일', lx + 44, ly);
  g.strokeStyle = '#e0712c'; g.setLineDash([8, 6]);
  g.beginPath(); g.moveTo(lx + 150, ly); g.lineTo(lx + 186, ly); g.stroke();
  g.setLineDash([]);
  g.fillText('베이스라인', lx + 194, ly);
  return c;
}

const toPng = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG 변환 실패'))), 'image/png'));

export function laneFileName(gel: Gel, lane: Lane, i: number) {
  return `${safeName(gel.name)}_레인${String(i + 1).padStart(2, '0')}${lane.sample ? `_${safeName(lane.sample)}` : ''}.png`;
}

interface DirHandle { getFileHandle(name: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>; name: string }

/**
 * 모든 레인 그래프를 PNG로 내보낸다 (레인 하나 = 파일 하나).
 * 폴더 선택을 지원하는 브라우저(Chrome·Edge)는 고른 폴더에 바로 저장하고,
 * 지원하지 않거나 막히면(Firefox·Safari, 일부 file:// 환경) zip 하나로 내려받는다.
 */
export async function exportLaneGraphs(gel: Gel, data: ProcessedGel) {
  const app = useApp.getState();
  if (!gel.lanes.length) return;
  const negative = app.project.settings.negative;
  const targets = app.project.targets;
  const files = gel.lanes.map((lane, i) => ({ lane, i, name: laneFileName(gel, lane, i) }));
  const render = (f: (typeof files)[number]) => toPng(drawLaneGraph(gel, f.lane, f.i, data, analyzeLane(gel, f.lane, data, negative), targets));

  const picker = (window as unknown as { showDirectoryPicker?: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
  if (picker) {
    let dir: DirHandle | null = null;
    try {
      dir = await picker.call(window, { mode: 'readwrite', id: 'densi-lane-graphs' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // 사용자가 취소
      dir = null; // 보안 제한 등 → zip으로
    }
    if (dir) {
      for (const f of files) {
        const fh = await dir.getFileHandle(f.name, { create: true });
        const w = await fh.createWritable();
        await w.write(await render(f));
        await w.close();
      }
      app.toast({ kind: 'success', text: `레인 그래프 ${files.length}장을 "${dir.name}" 폴더에 저장했습니다.` }, 6000);
      return;
    }
  }
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = new Uint8Array(await (await render(f)).arrayBuffer());
  const zip = zipSync(entries, { level: 0 });
  downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `${safeName(gel.name)}_레인그래프.zip`);
  app.toast({ kind: 'success', text: `이 브라우저는 폴더 선택을 지원하지 않아, 레인 그래프 ${files.length}장을 zip 파일 하나로 내려받았습니다.` }, 7000);
}
