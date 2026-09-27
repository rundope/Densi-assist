import { useEffect, useMemo, useRef, useState } from 'react';
import type { Band, Gel, Lane } from '../../core/types';
import { BASELINE_MAP } from '../../core/baseline/registry';
import { analyzeLane, variantFor, type LaneAnalysis, type ProcessedGel } from '../../engine/engine';
import { BAND_DEFAULT_COLOR } from '../colors';
import { newBand } from '../../state/project';
import { findGel, useApp } from '../../state/store';
import { detectBandsAction } from '../../state/actions';
import { renderToImageData, sourceFor, fmt, fmtPct } from '../render';
import { Icon, useElementSize } from '../common';

const PAD = { l: 56, r: 12, t: 10, b: 22 };

type ChartDrag =
  | { kind: 'anchor'; bandId: string; side: 's' | 'e' }
  | { kind: 'edge'; bandId: string; edge: 's' | 'e' }
  | { kind: 'new-band'; a: number; b: number };

export function ProfilePanel({ gel, data }: { gel: Gel; data: ProcessedGel | null }) {
  const ui = useApp((s) => s.ui);
  const negative = useApp((s) => s.project.settings.negative);
  const setUi = useApp((s) => s.setUi);
  const update = useApp((s) => s.update);
  const laneIdx = gel.lanes.findIndex((l) => l.id === ui.selectedLaneId);
  const lane = laneIdx >= 0 ? gel.lanes[laneIdx] : null;
  const startY = useRef(0);
  const startH = useRef(0);

  const onResize = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    startH.current = ui.profileHeight;
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    const h = Math.max(160, Math.min(window.innerHeight - 260, startH.current - (e.clientY - startY.current)));
    setUi({ profileHeight: h });
  };

  const step = (d: number) => {
    if (!gel.lanes.length) return;
    const i = laneIdx < 0 ? 0 : (laneIdx + d + gel.lanes.length) % gel.lanes.length;
    setUi({ selectedLaneId: gel.lanes[i].id, selectedBandId: null });
  };

  const an = lane && data ? analyzeLane(gel, lane, data, negative) : null;
  const spec = lane?.baseline ?? gel.baseline;
  const def = BASELINE_MAP[spec.method];

  const convertToManual = () => {
    if (!lane || !an) return;
    // 지금 자동 바닥선이 밴드 양 끝에서 지나는 높이를 시작점·끝점으로 옮겨 담는다
    const anchors = new Map(lane.bands.map((b) => {
      const v = variantFor(an, b.tilt ?? 0);
      return [b.id, [v.baseline[b.start], v.baseline[b.end]] as const];
    }));
    update((d) => {
      const l = findGel(d, gel.id)?.lanes.find((x) => x.id === lane.id);
      if (!l) return;
      l.baseline = { method: 'manual', params: {} };
      for (const b of l.bands) {
        const a = anchors.get(b.id);
        if (a) { b.baseStart = a[0]; b.baseEnd = a[1]; }
      }
    });
  };

  return (
    <div className="profile-panel" style={{ height: ui.profileHeight }}>
      <div className="resize-handle" onPointerDown={onResize} onPointerMove={onResizeMove} title="드래그해 높이 조절" />
      <div className="profile-head">
        <div className="btn-row" style={{ gap: 2 }}>
          <button className="btn sm icon" onClick={() => step(-1)} title="이전 레인 (←)"><Icon name="left" size={14} /></button>
          <button className="btn sm icon" onClick={() => step(1)} title="다음 레인 (→)"><Icon name="right" size={14} /></button>
        </div>
        {lane ? (
          <>
            <b style={{ whiteSpace: 'nowrap' }}>레인 {laneIdx + 1}</b>
            <input type="text" value={lane.sample} placeholder="샘플 이름" style={{ width: 140 }}
              onChange={(e) => update((d) => { const l = findGel(d, gel.id)?.lanes.find((x) => x.id === lane.id); if (l) l.sample = e.target.value; }, `sample-${lane.id}`)} />
            <span className="badge accent" title="베이스라인 방법">{def.label}{lane.baseline ? ' · 레인 개별' : ''}</span>
          </>
        ) : (
          <span className="hint">레인을 선택하면 프로파일이 표시됩니다.</span>
        )}
        <div className="spacer" />
        <div className="seg">
          <button className={!ui.showAllLanes ? 'on' : ''} onClick={() => setUi({ showAllLanes: false })}>선택 레인</button>
          <button className={ui.showAllLanes ? 'on' : ''} onClick={() => setUi({ showAllLanes: true })}>전체 레인 비교</button>
        </div>
        {lane && !ui.showAllLanes && (
          <>
            <button className={`btn sm ${ui.tool === 'band' ? 'active' : ''}`} onClick={() => useApp.getState().setTool(ui.tool === 'band' ? 'select' : 'band')} title="그래프나 이미지에서 드래그해 밴드 추가 (B)">
              <Icon name="band" size={14} />밴드 그리기
            </button>
            {spec.method === 'manual' ? (
              <span className="hint">동그라미 끌기: 시작·끝점과 바닥 높이 · 우클릭: 자동으로</span>
            ) : (
              <button className="btn sm" onClick={convertToManual} title="지금 바닥선을 출발점으로 삼아, 밴드마다 시작·끝점을 직접 옮기는 수동 모드로 바꿉니다"><Icon name="point" size={14} />수동으로 다듬기</button>
            )}
            <button className="btn sm" onClick={() => lane && detectBandsAction(gel.id, [lane.id])}><Icon name="wand" size={14} />밴드 검출</button>
          </>
        )}
      </div>
      <div className="profile-body">
        {ui.showAllLanes ? (
          <SmallMultiples gel={gel} data={data} />
        ) : lane && an && data ? (
          <>
            <LaneStrip gel={gel} lane={lane} data={data} />
            <ProfileChart gel={gel} lane={lane} an={an} />
          </>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}

function LaneStrip({ gel, lane, data }: { gel: Gel; lane: Lane; data: ProcessedGel }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const src = sourceFor(gel, data);
    const top = Math.max(0, Math.round(lane.top));
    const len = Math.max(2, Math.min(data.height, Math.round(lane.bottom)) - top);
    const x0 = Math.max(0, Math.round(lane.cx - lane.width / 2));
    const x1 = Math.min(data.width, Math.round(lane.cx + lane.width / 2));
    const hgt = Math.max(1, x1 - x0);
    // 레인을 눕혀서 (세로 → 가로) 그래프 x축과 맞춘다
    const vals = new Float32Array(len * hgt);
    for (let r = 0; r < hgt; r++) for (let i = 0; i < len; i++) {
      vals[r * len + i] = src.values[(top + i) * data.width + x0 + r];
    }
    c.width = len;
    c.height = hgt;
    const img = renderToImageData({ ...src, width: len, height: hgt, values: vals });
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [gel.display, gel.preprocess.polarity, lane.top, lane.bottom, lane.cx, lane.width, data]);
  return <div className="lane-strip"><canvas ref={ref} /></div>;
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

function ProfileChart({ gel, lane, an }: { gel: Gel; lane: Lane; an: LaneAnalysis }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const ui = useApp((s) => s.ui);
  const targets = useApp((s) => s.project.targets);
  const update = useApp((s) => s.update);
  const setUi = useApp((s) => s.setUi);
  const [drag, setDrag] = useState<ChartDrag | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const n = an.profile.values.length;
  const spec = lane.baseline ?? gel.baseline;
  const manual = spec.method === 'manual';

  // 기울어진 밴드 구간은 그 기울기로 다시 뽑은 프로파일·바닥선을 그린다
  // (검은 선이 기울기 조절에 따라 바뀌어 실제로 적분하는 값과 일치하도록)
  const { y, base } = useMemo(() => {
    const yy = new Float64Array(an.profile.values);
    const bb = new Float64Array(an.baseline);
    for (const b of lane.bands) {
      if (!b.tilt) continue;
      const v = variantFor(an, b.tilt);
      for (let i = Math.max(0, b.start); i <= Math.min(n - 1, b.end); i++) {
        yy[i] = v.profile.values[i];
        bb[i] = v.baseline[i];
      }
    }
    return { y: yy, base: bb };
  }, [an, lane.bands, n]);

  const [lo, hi] = useMemo(() => {
    let a = Infinity, b = -Infinity;
    for (let i = 0; i < n; i++) {
      a = Math.min(a, y[i], base[i]);
      b = Math.max(b, y[i], base[i]);
    }
    const pad = (b - a) * 0.06 || 1;
    return [a - pad, b + pad];
  }, [y, base, n]);

  const W = Math.max(50, size.width), H = Math.max(50, size.height);
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const sx = (i: number) => PAD.l + (i / Math.max(1, n - 1)) * iw;
  const sy = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;
  const ix = (px: number) => Math.max(0, Math.min(n - 1, ((px - PAD.l) / iw) * (n - 1)));
  const iv = (py: number) => lo + (1 - (py - PAD.t) / ih) * (hi - lo);

  const path = (arr: ArrayLike<number>) => {
    let d = '';
    const stepPx = Math.max(1, Math.floor(n / Math.max(1, iw)));
    for (let i = 0; i < n; i += stepPx) d += `${d ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(arr[i]).toFixed(1)}`;
    return d;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const updateBand = (bandId: string, fn: (b: Band) => void, key?: string) => {
    update((d) => {
      const b = findGel(d, gel.id)?.lanes.find((x) => x.id === lane.id)?.bands.find((x) => x.id === bandId);
      if (b) fn(b);
    }, key);
  };

  const onDown = (e: React.PointerEvent) => {
    const t = e.target as Element;
    const p = local(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const kind = t.getAttribute('data-kind');
    if (kind === 'anchor') {
      const bandId = t.getAttribute('data-band')!;
      const side = t.getAttribute('data-side') as 's' | 'e';
      setUi({ selectedBandId: bandId });
      if (e.button === 2) {
        // 오른쪽 클릭: 이 점의 높이를 자동(그 위치의 골짜기 값)으로 되돌린다
        updateBand(bandId, (b) => { if (side === 's') b.baseStart = null; else b.baseEnd = null; });
        return;
      }
      setDrag({ kind: 'anchor', bandId, side });
      return;
    }
    if (kind === 'edge') {
      const bandId = t.getAttribute('data-band')!;
      setUi({ selectedBandId: bandId });
      setDrag({ kind: 'edge', bandId, edge: t.getAttribute('data-edge') as 's' | 'e' });
      return;
    }
    if (e.button !== 0) return;
    if (ui.tool === 'band') {
      const i = Math.round(ix(p.x));
      setDrag({ kind: 'new-band', a: i, b: i });
      return;
    }
    if (kind === 'band') {
      setUi({ selectedBandId: t.getAttribute('data-band') });
      return;
    }
    setUi({ selectedBandId: null });
  };

  const onMove = (e: React.PointerEvent) => {
    const p = local(e);
    setHoverX(p.x >= PAD.l && p.x <= W - PAD.r ? Math.round(ix(p.x)) : null);
    if (!drag) return;
    if (drag.kind === 'anchor') {
      // 가로: 밴드 시작/끝 위치, 세로: 그 점의 바닥 높이
      const i = Math.round(ix(p.x));
      const v = iv(p.y);
      updateBand(drag.bandId, (b) => {
        if (drag.side === 's') { b.start = Math.max(0, Math.min(b.end - 1, i)); b.baseStart = v; }
        else { b.end = Math.min(n - 1, Math.max(b.start + 1, i)); b.baseEnd = v; }
      }, `anchor-${drag.bandId}-${drag.side}`);
    } else if (drag.kind === 'edge') {
      const i = Math.round(ix(p.x));
      update((d) => {
        const b = findGel(d, gel.id)?.lanes.find((x) => x.id === lane.id)?.bands.find((x) => x.id === drag.bandId);
        if (!b) return;
        if (drag.edge === 's') b.start = Math.max(0, Math.min(b.end - 1, i));
        else b.end = Math.min(n - 1, Math.max(b.start + 1, i));
      }, `cedge-${drag.bandId}-${drag.edge}`);
    } else if (drag.kind === 'new-band') {
      setDrag({ ...drag, b: Math.round(ix(p.x)) });
    }
  };

  const onUp = () => {
    if (drag?.kind === 'new-band') {
      const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b);
      if (b - a >= 2) {
        const band = newBand(a, b);
        update((d) => {
          const l = findGel(d, gel.id)?.lanes.find((x) => x.id === lane.id);
          if (!l) return;
          // 겹치는 기존 밴드는 잘라낸다
          l.bands = l.bands.filter((q) => q.end < a || q.start > b);
          l.bands.push(band);
          l.bands.sort((p, q) => p.start - q.start);
        });
        setUi({ selectedBandId: band.id });
      }
    }
    setDrag(null);
  };

  const tickY = niceTicks(lo, hi, Math.max(2, Math.round(ih / 45)));
  const tickX = niceTicks(0, n - 1, Math.max(2, Math.round(iw / 90)));
  const hv = hoverX != null ? { i: hoverX, y: y[hoverX], b: base[hoverX] } : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative', minHeight: 0 }}>
      <svg ref={svgRef} className="chart" width={W} height={H}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHoverX(null)}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: ui.tool === 'band' ? 'crosshair' : 'default', position: 'absolute', inset: 0 }}>
        <g className="grid">
          {tickY.map((v) => <line key={v} x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} />)}
        </g>
        {tickY.map((v) => <text key={v} x={PAD.l - 6} y={sy(v)} textAnchor="end" dominantBaseline="middle">{fmt(v, 3)}</text>)}
        {tickX.map((v) => <text key={v} x={sx(v)} y={H - 6} textAnchor="middle">{Math.round(v)}</text>)}

        {lane.bands.map((b, bi) => {
          const t = targets.find((q) => q.id === b.targetId);
          const c = t?.color ?? BAND_DEFAULT_COLOR;
          const sel = b.id === ui.selectedBandId;
          const m = an.measures[bi];
          // y/base는 이미 기울기가 반영된 값이라, 채운 면적이 실제 적분값과 같다
          let d = `M${sx(b.start)},${sy(base[b.start])}`;
          for (let i = b.start; i <= b.end; i++) d += `L${sx(i)},${sy(y[i])}`;
          for (let i = b.end; i >= b.start; i--) d += `L${sx(i)},${sy(base[i])}`;
          const pct = an.totalArea > 0 ? (m.area / an.totalArea) * 100 : 0;
          return (
            <g key={b.id}>
              <path d={d + 'Z'} fill={c} fillOpacity={sel ? 0.42 : 0.24} data-kind="band" data-band={b.id} style={{ cursor: 'pointer' }} />
              <line x1={sx(b.start)} x2={sx(b.start)} y1={PAD.t} y2={H - PAD.b} stroke={c} className="edge" strokeOpacity={sel ? 1 : 0.55} />
              <line x1={sx(b.end)} x2={sx(b.end)} y1={PAD.t} y2={H - PAD.b} stroke={c} className="edge" strokeOpacity={sel ? 1 : 0.55} />
              <line data-kind="edge" data-edge="s" data-band={b.id} x1={sx(b.start)} x2={sx(b.start)} y1={PAD.t} y2={H - PAD.b} className="edge-hit" />
              <line data-kind="edge" data-edge="e" data-band={b.id} x1={sx(b.end)} x2={sx(b.end)} y1={PAD.t} y2={H - PAD.b} className="edge-hit" />
              <text x={(sx(b.start) + sx(b.end)) / 2} y={PAD.t + 11} textAnchor="middle" style={{ fill: c, fontWeight: sel ? 700 : 600 }}>
                {bi + 1}{t ? ` ${t.name}` : ''}
              </text>
              <text x={(sx(b.start) + sx(b.end)) / 2} y={PAD.t + 24} textAnchor="middle">{fmtPct(pct)}</text>
              {m.saturatedPixels > 0 && <text x={(sx(b.start) + sx(b.end)) / 2} y={PAD.t + 37} textAnchor="middle" style={{ fill: 'var(--err)', fontWeight: 700 }}>포화</text>}
            </g>
          );
        })}

        <path className="profile" d={path(y)} />
        <path className="baseline" d={path(base)} />

        {/* 면적을 재는 시작점·끝점. 수동 모드에서는 끌어서 바닥선을 직접 그린다 */}
        {lane.bands.map((b) => (['s', 'e'] as const).map((side) => {
          const i = side === 's' ? b.start : b.end;
          const c = targets.find((q) => q.id === b.targetId)?.color ?? BAND_DEFAULT_COLOR;
          return (
            <circle key={`${b.id}-${side}`} data-kind={manual ? 'anchor' : undefined} data-band={b.id} data-side={side}
              cx={sx(i)} cy={sy(base[i])} r={manual ? 6 : 3.5}
              className={manual ? 'anchor active' : 'anchor'} stroke={c}
              pointerEvents={manual ? 'all' : 'none'}>
              {manual && <title>끌어서 시작·끝 위치와 바닥 높이를 정합니다 · 오른쪽 클릭: 자동 높이로</title>}
            </circle>
          );
        }))}

        {drag?.kind === 'new-band' && (
          <rect x={sx(Math.min(drag.a, drag.b))} y={PAD.t} width={Math.abs(sx(drag.b) - sx(drag.a))} height={ih} fill="var(--accent)" fillOpacity={0.15} stroke="var(--accent)" />
        )}

        {hv && (
          <g pointerEvents="none">
            <line className="crosshair" x1={sx(hv.i)} x2={sx(hv.i)} y1={PAD.t} y2={H - PAD.b} />
            <circle cx={sx(hv.i)} cy={sy(hv.y)} r={3} fill="var(--chart-profile)" />
            <circle cx={sx(hv.i)} cy={sy(hv.b)} r={3} fill="var(--chart-baseline)" />
          </g>
        )}
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} stroke="var(--line-strong)" />
      </svg>
      {hv && (
        <div className="hud-chip" style={{ position: 'absolute', right: 14, top: 6, pointerEvents: 'none' }}>
          위치 {hv.i} · 프로파일 {fmt(hv.y)} · 베이스라인 {fmt(hv.b)} · 신호 {fmt(hv.y - hv.b)}
        </div>
      )}
    </div>
  );
}

function SmallMultiples({ gel, data }: { gel: Gel; data: ProcessedGel | null }) {
  const ui = useApp((s) => s.ui);
  const negative = useApp((s) => s.project.settings.negative);
  const setUi = useApp((s) => s.setUi);
  const targets = useApp((s) => s.project.targets);
  if (!data) return null;
  const W = 170, H = 70;
  return (
    <div className="small-multiples">
      {gel.lanes.map((lane, i) => {
        const an = analyzeLane(gel, lane, data, negative);
        const y = an.profile.values, b = an.baseline, n = y.length;
        let lo = Infinity, hi = -Infinity;
        for (let k = 0; k < n; k++) { lo = Math.min(lo, y[k], b[k]); hi = Math.max(hi, y[k], b[k]); }
        const sx = (k: number) => (k / Math.max(1, n - 1)) * W;
        const sy = (v: number) => H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4);
        const step = Math.max(1, Math.floor(n / W));
        let py = '', pb = '';
        for (let k = 0; k < n; k += step) { py += `${py ? 'L' : 'M'}${sx(k).toFixed(1)},${sy(y[k]).toFixed(1)}`; pb += `${pb ? 'L' : 'M'}${sx(k).toFixed(1)},${sy(b[k]).toFixed(1)}`; }
        return (
          <div key={lane.id} className={`mini ${lane.id === ui.selectedLaneId ? 'active' : ''}`} onClick={() => setUi({ selectedLaneId: lane.id, showAllLanes: false })}>
            <div className="t"><span>{i + 1}. {lane.sample || '—'}</span><span>{lane.bands.length}밴드{lane.baseline ? ' · 개별' : ''}</span></div>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', height: H }}>
              {lane.bands.map((band) => {
                const c = targets.find((t) => t.id === band.targetId)?.color ?? BAND_DEFAULT_COLOR;
                return <rect key={band.id} x={sx(band.start)} width={Math.max(1, sx(band.end) - sx(band.start))} y={0} height={H} fill={c} opacity={0.18} />;
              })}
              <path d={py} fill="none" stroke="var(--chart-profile)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <path d={pb} fill="none" stroke="var(--chart-baseline)" strokeWidth={1.2} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
