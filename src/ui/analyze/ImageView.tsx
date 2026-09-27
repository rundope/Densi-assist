import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Gel, Lane } from '../../core/types';
import { laneColumns } from '../../core/profile';
import type { ProcessedGel } from '../../engine/engine';
import type { GelStatus } from '../../engine/engine';
import { newBand, newLane } from '../../state/project';
import { findGel, useApp } from '../../state/store';
import { renderToImageData, sourceFor, fmt } from '../render';
import { Icon, useElementSize } from '../common';
import { BAND_DEFAULT_COLOR, DRAFT, LANE_EXCLUDED, LANE_NORMAL, LANE_SELECTED } from '../colors';

interface View { scale: number; tx: number; ty: number }

type Drag =
  | { kind: 'pan'; sx: number; sy: number; tx: number; ty: number }
  | { kind: 'move-lane'; laneId: string; ix: number; iy: number; orig: Lane; moved: boolean }
  | { kind: 'edge'; laneId: string; edge: 'l' | 'r' | 't' | 'b'; orig: Lane; ix: number; iy: number }
  | { kind: 'new-lane'; ix: number; iy: number; cx: number; cy: number }
  | { kind: 'new-band'; laneId: string; iy: number; cy: number }
  | { kind: 'band-edge'; laneId: string; bandId: string; edge: 's' | 'e' }
  | { kind: 'move-band'; laneId: string; bandId: string; iy: number; orig: { start: number; end: number }; moved: boolean }
  | { kind: 'band-tilt'; laneId: string; bandId: string; side: -1 | 1; iy: number; orig: number };

export function ImageView({ gel, data, status }: { gel: Gel; data: ProcessedGel | null; status: GelStatus }) {
  const ui = useApp((s) => s.ui);
  const targets = useApp((s) => s.project.targets);
  const update = useApp((s) => s.update);
  const setUi = useApp((s) => s.setUi);
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const fittedFor = useRef<string>('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  // 원본 이미지 보기: 레인·밴드 표시를 숨기고 보정 전 이미지를 보여줘 비교하기 쉽게 한다
  const [showOriginal, setShowOriginal] = useState(false);
  const imageDataRef = useRef<ImageData | undefined>(undefined);

  const fit = useCallback(() => {
    if (!data || !size.width || !size.height) return;
    const pad = 28;
    const s = Math.min((size.width - pad * 2) / data.width, (size.height - pad * 2) / data.height);
    const scale = Math.max(0.02, s);
    setView({ scale, tx: (size.width - data.width * scale) / 2, ty: (size.height - data.height * scale) / 2 });
  }, [data, size.width, size.height]);

  useLayoutEffect(() => {
    const k = `${gel.id}|${data?.width}x${data?.height}`;
    if (data && size.width && fittedFor.current !== k) {
      fittedFor.current = k;
      fit();
    }
  }, [gel.id, data, size.width, fit]);

  // 이미지 렌더
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !data) return;
    const id = requestAnimationFrame(() => {
      if (c.width !== data.width || c.height !== data.height) { c.width = data.width; c.height = data.height; }
      const shown = showOriginal ? { ...gel, display: { ...gel.display, showCorrected: false } } : gel;
      const img = renderToImageData(sourceFor(shown, data), imageDataRef.current);
      imageDataRef.current = img;
      c.getContext('2d')!.putImageData(img, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [data, gel.display, gel.preprocess.polarity, showOriginal]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (typing) return;
      if (e.code === 'Space') { setSpace(true); e.preventDefault(); }
      // O: 원본 이미지 보기 켜고 끄기
      if (e.key === 'o' && !e.ctrlKey && !e.metaKey && !e.altKey) setShowOriginal((v) => !v);
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    const onFit = () => fit();
    window.addEventListener('densi:fit', onFit);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('densi:fit', onFit); };
  }, [fit]);

  const toImage = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.tx) / view.scale, y: (e.clientY - r.top - view.ty) / view.scale };
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const scale = Math.min(40, Math.max(0.02, v.scale * factor));
      const k = scale / v.scale;
      return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
    });
  };

  const zoomBy = (f: number) => {
    setView((v) => {
      const mx = size.width / 2, my = size.height / 2;
      const scale = Math.min(40, Math.max(0.02, v.scale * f));
      const k = scale / v.scale;
      return { scale, tx: mx - (mx - v.tx) * k, ty: my - (my - v.ty) * k };
    });
  };

  const selectLane = (laneId: string | null, bandId: string | null = null) => setUi({ selectedLaneId: laneId, selectedBandId: bandId });

  const onPointerDown = (e: React.PointerEvent) => {
    if (!data) return;
    // 이미지 위에 떠 있는 버튼·안내창은 그대로 클릭되게 둔다
    // (여기서 포인터를 캡처해 버리면 그 위의 버튼이 클릭 이벤트를 받지 못한다)
    if ((e.target as Element).closest('.banner, .hud, .view-controls, .orig-toggle')) return;
    e.preventDefault(); // 드래그 중 글자 선택이 시작되지 않게
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toImage(e);
    const t = e.target as Element;
    const kind = t.getAttribute('data-kind');
    const laneId = t.getAttribute('data-lane');
    const lane = gel.lanes.find((l) => l.id === laneId);

    if (e.button === 1 || e.button === 2 || space) {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty });
      return;
    }
    if (kind === 'band-tilt' && lane) {
      const bandId = t.getAttribute('data-band')!;
      const band = lane.bands.find((b) => b.id === bandId);
      selectLane(lane.id, bandId);
      setDrag({ kind: 'band-tilt', laneId: lane.id, bandId, side: Number(t.getAttribute('data-side')) as -1 | 1, iy: p.y, orig: band?.tilt ?? 0 });
      return;
    }
    if (kind === 'band-edge' && lane) {
      const bandId = t.getAttribute('data-band')!;
      selectLane(lane.id, bandId);
      setDrag({ kind: 'band-edge', laneId: lane.id, bandId, edge: t.getAttribute('data-edge') as 's' | 'e' });
      return;
    }
    // 이미 있는 밴드는 어느 도구에서든 바로 끌어서 위아래로 옮긴다
    if (kind === 'band' && lane) {
      const bandId = t.getAttribute('data-band')!;
      const band = lane.bands.find((b) => b.id === bandId);
      selectLane(lane.id, bandId);
      if (band) setDrag({ kind: 'move-band', laneId: lane.id, bandId, iy: p.y, orig: { start: band.start, end: band.end }, moved: false });
      return;
    }
    // 레인 가장자리: 상하좌우로 크기 조절 (선택 도구, 레인 도구 모두)
    if (kind?.startsWith('edge-') && lane) {
      selectLane(lane.id);
      setDrag({ kind: 'edge', laneId: lane.id, edge: kind.slice(5) as 'l' | 'r' | 't' | 'b', orig: lane, ix: p.x, iy: p.y });
      return;
    }
    if (ui.tool === 'band' && lane) {
      selectLane(lane.id);
      setDrag({ kind: 'new-band', laneId: lane.id, iy: p.y, cy: p.y });
      return;
    }
    // 레인 몸통: 어느 도구에서든 바로 끌어서 옮긴다 (레인을 그린 뒤 도구를 바꿀 필요 없음)
    if (kind === 'lane' && lane) {
      selectLane(lane.id);
      setDrag({ kind: 'move-lane', laneId: lane.id, ix: p.x, iy: p.y, orig: lane, moved: false });
      return;
    }
    if (ui.tool === 'lane') {
      setDrag({ kind: 'new-lane', ix: p.x, iy: p.y, cx: p.x, cy: p.y });
      return;
    }
    selectLane(null);
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toImage(e);
    if (data && p.x >= 0 && p.y >= 0 && p.x < data.width && p.y < data.height) setHover(p); else setHover(null);
    if (!drag || !data) return;
    const clampX = (v: number) => Math.max(0, Math.min(data.width, v));
    const clampY = (v: number) => Math.max(0, Math.min(data.height, v));
    switch (drag.kind) {
      case 'pan':
        setView((v) => ({ ...v, tx: drag.tx + e.clientX - drag.sx, ty: drag.ty + e.clientY - drag.sy }));
        break;
      case 'move-lane': {
        const dx = p.x - drag.ix, dy = p.y - drag.iy;
        if (!drag.moved && Math.hypot(dx, dy) * view.scale < 3) return;
        if (!drag.moved) setDrag({ ...drag, moved: true });
        // Shift를 누르면 세로 이동 없이 가로로만
        const oy = e.shiftKey ? 0 : dy;
        update((d) => {
          const l = findGel(d, gel.id)?.lanes.find((x) => x.id === drag.laneId);
          if (!l) return;
          l.cx = clampX(drag.orig.cx + dx);
          const h = drag.orig.bottom - drag.orig.top;
          l.top = Math.max(0, Math.min(data.height - h, drag.orig.top + oy));
          l.bottom = l.top + h;
        }, `lane-move-${drag.laneId}`);
        break;
      }
      case 'edge': {
        const o = drag.orig;
        update((d) => {
          const g = findGel(d, gel.id);
          if (!g) return;
          const targetsL = ui.syncLaneSize ? g.lanes : g.lanes.filter((x) => x.id === drag.laneId);
          if (drag.edge === 'l' || drag.edge === 'r') {
            // 끌고 있는 쪽 가장자리만 움직이고 반대쪽은 고정
            const left0 = o.cx - o.width / 2, right0 = o.cx + o.width / 2;
            const left = drag.edge === 'l' ? Math.min(clampX(p.x), right0 - 4) : left0;
            const right = drag.edge === 'r' ? Math.max(clampX(p.x), left0 + 4) : right0;
            const width = Math.round(right - left);
            const self = g.lanes.find((x) => x.id === drag.laneId);
            if (self) { self.cx = (left + right) / 2; self.width = width; }
            for (const l of targetsL) if (l.id !== drag.laneId) l.width = width;
          } else if (drag.edge === 't') {
            const top = Math.round(Math.min(clampY(p.y), o.bottom - 8));
            for (const l of targetsL) l.top = Math.min(top, l.bottom - 8);
          } else {
            const bottom = Math.round(Math.max(clampY(p.y), o.top + 8));
            for (const l of targetsL) l.bottom = Math.max(bottom, l.top + 8);
          }
        }, `lane-edge-${drag.edge}`);
        break;
      }
      case 'new-lane':
        setDrag({ ...drag, cx: clampX(p.x), cy: clampY(p.y) });
        break;
      case 'new-band':
        setDrag({ ...drag, cy: clampY(p.y) });
        break;
      case 'band-tilt': {
        update((d) => {
          const b = findGel(d, gel.id)?.lanes.find((x) => x.id === drag.laneId)?.bands.find((x) => x.id === drag.bandId);
          if (!b) return;
          // 모서리를 1px 움직이면 기울기는 2px 바뀐다 (모서리는 중심에서 폭의 절반만큼 떨어져 있음)
          b.tilt = Math.round((drag.orig + drag.side * 2 * (p.y - drag.iy)) * 10) / 10;
        }, `band-tilt-${drag.bandId}`);
        break;
      }
      case 'move-band': {
        const dy = Math.round(p.y - drag.iy);
        if (!drag.moved && Math.abs(dy) * view.scale < 3) return;
        if (!drag.moved) setDrag({ ...drag, moved: true });
        update((d) => {
          const l = findGel(d, gel.id)?.lanes.find((x) => x.id === drag.laneId);
          const b = l?.bands.find((x) => x.id === drag.bandId);
          if (!l || !b) return;
          const len = Math.round(l.bottom) - Math.round(l.top) - 1;
          const span = drag.orig.end - drag.orig.start;
          const start = Math.max(0, Math.min(len - span, drag.orig.start + dy));
          b.start = start;
          b.end = start + span;
        }, `band-move-${drag.bandId}`);
        break;
      }
      case 'band-edge': {
        update((d) => {
          const l = findGel(d, gel.id)?.lanes.find((x) => x.id === drag.laneId);
          const b = l?.bands.find((x) => x.id === drag.bandId);
          if (!l || !b) return;
          const pos = Math.round(p.y - Math.round(l.top));
          const len = Math.round(l.bottom) - Math.round(l.top) - 1;
          if (drag.edge === 's') b.start = Math.max(0, Math.min(b.end - 1, pos));
          else b.end = Math.min(len, Math.max(b.start + 1, pos));
        }, `band-edge-${drag.bandId}-${drag.edge}`);
        break;
      }
    }
  };

  const onPointerUp = () => {
    if (!drag || !data) { setDrag(null); return; }
    if (drag.kind === 'new-lane') {
      const w = Math.abs(drag.cx - drag.ix), h = Math.abs(drag.cy - drag.iy);
      const ref = gel.lanes.find((l) => l.id === ui.selectedLaneId) ?? gel.lanes[gel.lanes.length - 1];
      let lane: Lane;
      if (w * view.scale < 6 && h * view.scale < 6) {
        // 클릭: 기존 레인과 같은 크기로 추가
        const width = ref?.width ?? Math.max(10, Math.round(data.width / 12));
        const top = ref?.top ?? Math.round(data.height * 0.05);
        const bottom = ref?.bottom ?? Math.round(data.height * 0.95);
        lane = newLane({ cx: drag.ix, width, top, bottom });
      } else {
        const top = Math.min(drag.iy, drag.cy), bottom = Math.max(drag.iy, drag.cy);
        lane = newLane({ cx: (drag.ix + drag.cx) / 2, width: Math.max(4, Math.round(w)), top, bottom });
      }
      update((d) => {
        const g = findGel(d, gel.id)!;
        const nextIdx = g.lanes.filter((l) => l.cx < lane.cx).length;
        lane.sample = `S${g.lanes.length + 1}`;
        if (ui.syncLaneSize && g.lanes.length && !(w * view.scale < 6 && h * view.scale < 6)) {
          for (const l of g.lanes) { l.width = lane.width; l.top = lane.top; l.bottom = lane.bottom; }
        }
        g.lanes.splice(nextIdx, 0, lane);
      });
      selectLane(lane.id);
    } else if (drag.kind === 'new-band') {
      const lane = gel.lanes.find((l) => l.id === drag.laneId);
      if (lane) {
        const a = Math.round(Math.min(drag.iy, drag.cy) - Math.round(lane.top));
        const b = Math.round(Math.max(drag.iy, drag.cy) - Math.round(lane.top));
        if (b - a >= 2) {
          const band = newBand(Math.max(0, a), b);
          update((d) => {
            const l = findGel(d, gel.id)?.lanes.find((x) => x.id === lane.id);
            if (!l) return;
            band.end = Math.min(Math.round(l.bottom - l.top) - 1, b);
            l.bands.push(band);
            l.bands.sort((p, q) => p.start - q.start);
          });
          selectLane(lane.id, band.id);
        }
      }
    }
    setDrag(null);
  };

  const sw = (px: number) => px / view.scale;
  const selectedLane = gel.lanes.find((l) => l.id === ui.selectedLaneId);
  const hoverRaw = hover && data ? data.raw[Math.floor(hover.y) * data.width + Math.floor(hover.x)] : null;
  const hoverSig = hover && data ? data.signal[Math.floor(hover.y) * data.width + Math.floor(hover.x)] : null;
  const cursor = drag?.kind === 'pan' ? 'grabbing' : space ? 'grab' : ui.tool === 'lane' || ui.tool === 'band' ? 'crosshair' : 'default';

  return (
    <div
      ref={wrapRef}
      className="viewport"
      style={{ cursor }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {data && (
        <>
          <canvas ref={canvasRef} className="image" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }} />
          <svg
            className="overlay"
            width={data.width}
            height={data.height}
            style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, display: showOriginal ? 'none' : undefined }}
          >
            {gel.lanes.map((lane, i) => {
              const sel = lane.id === ui.selectedLaneId;
              const x = lane.cx - lane.width / 2;
              const xr = x + lane.width;
              const { x0, x1 } = laneColumns(lane, data.width, gel.profile.edgeTrimPct);
              const color = lane.excluded ? LANE_EXCLUDED : sel ? LANE_SELECTED : LANE_NORMAL;
              return (
                <g key={lane.id} opacity={lane.excluded ? 0.55 : 1}>
                  {/* 레인 틀을 먼저 그려야 그 위의 밴드를 클릭할 수 있다 */}
                  <rect data-kind="lane" data-lane={lane.id} x={x} y={lane.top} width={lane.width} height={lane.bottom - lane.top}
                    fill={sel ? 'rgba(10,124,255,0.07)' : 'transparent'} stroke={color} strokeWidth={sw(sel ? 2.4 : 1.8)}
                    style={{ cursor: ui.tool === 'band' ? 'crosshair' : 'move' }} pointerEvents="all" fillOpacity={1} />
                  {lane.bands.map((b, bi) => {
                    const t = targets.find((q) => q.id === b.targetId);
                    const c = t?.color ?? BAND_DEFAULT_COLOR;
                    const bsel = sel && b.id === ui.selectedBandId;
                    const y0 = Math.round(lane.top) + b.start, y1 = Math.round(lane.top) + b.end + 1;
                    // 기울기: 왼쪽 끝은 -tilt/2, 오른쪽 끝은 +tilt/2 만큼 내려간다
                    const dy = (b.tilt ?? 0) / 2;
                    const poly = (yy: number) => `${x},${yy - dy} ${xr},${yy + dy}`;
                    return (
                      <g key={b.id}>
                        {/* 레인 도구에서는 밴드가 레인 이동을 막지 않도록 클릭을 통과시킨다 */}
                        <polygon data-kind="band" data-lane={lane.id} data-band={b.id}
                          points={`${poly(y0)} ${xr},${y1 + dy} ${x},${y1 - dy}`}
                          pointerEvents={ui.tool === 'lane' ? 'none' : 'all'} style={{ cursor: 'move' }}
                          fill={c} fillOpacity={bsel ? 0.3 : 0.14} stroke={c} strokeOpacity={0.95} strokeWidth={sw(bsel ? 2.2 : 1.4)} />
                        {(sel || ui.tool === 'band') && ui.tool !== 'lane' && (
                          <>
                            <line data-kind="band-edge" data-edge="s" data-lane={lane.id} data-band={b.id} x1={x} x2={xr} y1={y0 - dy} y2={y0 + dy} stroke="transparent" strokeWidth={sw(9)} style={{ cursor: 'ns-resize' }} />
                            <line data-kind="band-edge" data-edge="e" data-lane={lane.id} data-band={b.id} x1={x} x2={xr} y1={y1 - dy} y2={y1 + dy} stroke="transparent" strokeWidth={sw(9)} style={{ cursor: 'ns-resize' }} />
                          </>
                        )}
                        {view.scale * (y1 - y0) > 12 && (
                          <text x={xr + sw(4)} y={(y0 + y1) / 2 + dy} fontSize={sw(11)} fill={c} dominantBaseline="middle"
                            style={{ pointerEvents: 'none', paintOrder: 'stroke' }} stroke="rgba(255,255,255,0.85)" strokeWidth={sw(2.5)}>{bi + 1}</text>
                        )}
                      </g>
                    );
                  })}
                  {sel && gel.profile.edgeTrimPct > 0 && (
                    <rect x={x0} y={lane.top} width={x1 - x0} height={lane.bottom - lane.top} fill="none" stroke={color} strokeDasharray={`${sw(4)} ${sw(3)}`} strokeWidth={sw(1.2)} pointerEvents="none" />
                  )}
                  {/* 레인 가장자리: 마우스를 올리면 바로 크기 조절 (선택·레인 도구) */}
                  {ui.tool !== 'band' && (
                    <>
                      <line data-kind="edge-l" data-lane={lane.id} x1={x} x2={x} y1={lane.top} y2={lane.bottom} stroke="transparent" strokeWidth={sw(8)} style={{ cursor: 'ew-resize' }} />
                      <line data-kind="edge-r" data-lane={lane.id} x1={xr} x2={xr} y1={lane.top} y2={lane.bottom} stroke="transparent" strokeWidth={sw(8)} style={{ cursor: 'ew-resize' }} />
                      <line data-kind="edge-t" data-lane={lane.id} x1={x} x2={xr} y1={lane.top} y2={lane.top} stroke="transparent" strokeWidth={sw(8)} style={{ cursor: 'ns-resize' }} />
                      <line data-kind="edge-b" data-lane={lane.id} x1={x} x2={xr} y1={lane.bottom} y2={lane.bottom} stroke="transparent" strokeWidth={sw(8)} style={{ cursor: 'ns-resize' }} />
                    </>
                  )}
                  {sel && ui.tool !== 'band' && [[x, lane.top], [xr, lane.top], [x, lane.bottom], [xr, lane.bottom]].map(([hx, hy], k) => (
                    <rect key={k} x={hx - sw(3.5)} y={hy - sw(3.5)} width={sw(7)} height={sw(7)} fill={LANE_SELECTED} stroke="#fff" strokeWidth={sw(1)} pointerEvents="none" />
                  ))}
                  <text x={lane.cx} y={lane.top - sw(7)} fontSize={sw(13)} textAnchor="middle" fill={color} fontWeight={700}
                    style={{ pointerEvents: 'none', paintOrder: 'stroke' }} stroke="rgba(255,255,255,0.9)" strokeWidth={sw(3.5)}>
                    {lane.sample || `레인 ${i + 1}`}
                  </text>
                </g>
              );
            })}
            {/* 밴드 기울기 손잡이는 모든 레인보다 나중에(맨 위에) 그린다.
                레인 안에서 그리면 오른쪽 손잡이가 옆 레인의 테두리·가장자리 핸들에 가려 잡히지 않는다 */}
            {(() => {
              const lane = gel.lanes.find((l) => l.id === ui.selectedLaneId);
              const b = lane?.bands.find((q) => q.id === ui.selectedBandId);
              if (!lane || !b) return null;
              const c = targets.find((q) => q.id === b.targetId)?.color ?? BAND_DEFAULT_COLOR;
              const x = lane.cx - lane.width / 2, xr = x + lane.width;
              const dy = (b.tilt ?? 0) / 2;
              const y0 = Math.round(lane.top) + b.start;
              return ([[x, y0 - dy, -1], [xr, y0 + dy, 1]] as [number, number, number][]).map(([hx, hy, side]) => (
                <circle key={side} data-kind="band-tilt" data-lane={lane.id} data-band={b.id} data-side={side}
                  cx={hx} cy={hy} r={sw(6)} fill={c} stroke="#fff" strokeWidth={sw(1.5)} style={{ cursor: 'ns-resize' }}>
                  <title>위아래로 끌어 밴드 기울기를 맞춥니다</title>
                </circle>
              ));
            })()}
            {drag?.kind === 'new-lane' && (
              <rect x={Math.min(drag.ix, drag.cx)} y={Math.min(drag.iy, drag.cy)} width={Math.abs(drag.cx - drag.ix)} height={Math.abs(drag.cy - drag.iy)}
                fill="rgba(10,124,255,0.14)" stroke={DRAFT} strokeWidth={sw(2)} strokeDasharray={`${sw(5)} ${sw(3)}`} />
            )}
            {drag?.kind === 'new-band' && (() => {
              const l = gel.lanes.find((q) => q.id === drag.laneId);
              return l ? <rect x={l.cx - l.width / 2} y={Math.min(drag.iy, drag.cy)} width={l.width} height={Math.abs(drag.cy - drag.iy)}
                fill={BAND_DEFAULT_COLOR} fillOpacity={0.22} stroke={BAND_DEFAULT_COLOR} strokeWidth={sw(2)} /> : null;
            })()}
          </svg>
        </>
      )}

      {(status.state === 'loading' || status.state === 'processing') && (
        <>
          <div className="progress" style={{ width: `${status.state === 'processing' ? Math.max(5, status.progress * 100) : 5}%` }} />
          {!data && <div className="center-msg">이미지 처리 중…</div>}
        </>
      )}
      {status.state === 'error' && <div className="center-msg"><div className="note err">{status.message}</div></div>}

      {ui.tool === 'lane' && (
        <div className="banner" title="빈 곳을 드래그하면 새 레인을 그리고, 그냥 클릭하면 선택한 레인과 같은 크기로 추가합니다. 이미 있는 레인은 몸통을 끌어 옮기고 가장자리를 끌어 크기를 바꿉니다">
          <span>빈 곳 드래그: 새 레인 · 레인 끌기: 이동 · 가장자리: 크기</span>
          <button className="btn sm" onClick={() => useApp.getState().setTool('select')}>완료</button>
        </div>
      )}
      {ui.tool === 'band' && (
        <div className="banner" title="이미지: 레인 안에서 위아래로 드래그하면 밴드가 됩니다. 아래 그래프: 좌우로 드래그해도 밴드를 만들거나 경계를 옮길 수 있습니다">
          <span>이미지: 위아래 드래그 · 아래 그래프: 좌우 드래그 · 밴드 끌기: 이동</span>
          <button className="btn sm" onClick={() => useApp.getState().setTool('select')}>완료</button>
        </div>
      )}

      <div className="hud">
        <div className="hud-chip">{Math.round(view.scale * 100)}%</div>
        {hover && hoverRaw != null && (
          <div className="hud-chip">
            x {Math.floor(hover.x)}, y {Math.floor(hover.y)} · 원본 {fmt(hoverRaw, 5)} · 신호 {fmt(hoverSig, 4)}
          </div>
        )}
        {selectedLane && <div className="hud-chip">선택: {selectedLane.sample || '레인'} · 폭 {Math.round(selectedLane.width)}px</div>}
      </div>
      {data && (
        <label className={`orig-toggle ${showOriginal ? 'on' : ''}`} title="레인·밴드 표시를 숨기고 원본 이미지를 봅니다 (O)">
          <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
          원본 이미지 보기
        </label>
      )}
      <div className="view-controls">
        <button className="btn sm icon" onClick={() => zoomBy(1 / 1.25)} title="축소"><Icon name="zoomout" size={14} /></button>
        <button className="btn sm icon" onClick={() => zoomBy(1.25)} title="확대"><Icon name="zoomin" size={14} /></button>
        <button className="btn sm icon" onClick={fit} title="화면에 맞춤 (F)"><Icon name="fit" size={14} /></button>
        <button className="btn sm icon" onClick={() => setView((v) => ({ ...v, scale: 1, tx: size.width / 2 - (data?.width ?? 0) / 2, ty: size.height / 2 - (data?.height ?? 0) / 2 }))} title="100% 원본 크기">1:1</button>
      </div>
    </div>
  );
}
