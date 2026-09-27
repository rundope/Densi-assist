import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { fitCalibration, type FitResult } from '../core/calibration';
import type { BandRow } from '../core/results';
import type { Calibration, Gel, Project } from '../core/types';
import { useApp } from '../state/store';
import { analyzeLane, engine, type GelStatus, type ProcessedGel } from './engine';

export function useEngineVersion() {
  return useSyncExternalStore(engine.subscribe, engine.version);
}

export function useGelStatus(gel: Gel | null): { status: GelStatus; data: ProcessedGel | null } {
  useEngineVersion();
  const key = gel ? engine.processingKey(gel) : '';
  useEffect(() => {
    if (gel) engine.ensure(gel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gel?.id, key]);
  if (!gel) return { status: { state: 'idle' }, data: null };
  const status = engine.status(gel.id);
  return { status, data: status.state === 'ready' ? status.data : null };
}

/** 모든 겔 처리를 시작하고 준비된 겔 수를 돌려준다 */
export function useAllProcessed(project: Project) {
  const v = useEngineVersion();
  useEffect(() => {
    for (const g of project.gels) engine.ensure(g);
  }, [project.gels]);
  return useMemo(() => {
    let ready = 0;
    for (const g of project.gels) if (engine.status(g.id).state === 'ready') ready++;
    return { ready, total: project.gels.length, version: v };
  }, [project.gels, v]);
}

export interface CalibrationEval {
  calibration: Calibration;
  points: { rowId: string; x: number | null; y: number | null; excluded: boolean; label: string }[];
  fit: FitResult | { error: string };
}

export function signalForSource(project: Project, cal: Calibration, row: Calibration['rows'][number]): { value: number | null; label: string } {
  if (row.source.kind === 'manual') return { value: row.source.value, label: '직접 입력' };
  const { gelId, laneId, bandId } = row.source;
  const gel = project.gels.find((g) => g.id === gelId);
  const lane = gel?.lanes.find((l) => l.id === laneId);
  const bi = lane?.bands.findIndex((b) => b.id === bandId) ?? -1;
  if (!gel || !lane || bi < 0) return { value: null, label: '밴드가 삭제됨' };
  const label = `${gel.name} · ${lane.sample || `레인 ${gel.lanes.indexOf(lane) + 1}`} · 밴드 ${bi + 1}`;
  const st = engine.status(gel.id);
  if (st.state !== 'ready') return { value: null, label };
  const an = analyzeLane(gel, lane, st.data, project.settings.negative);
  const m = an.measures[bi];
  return { value: cal.signal === 'volume' ? m.volume : m.area, label };
}

export function evaluateCalibration(project: Project, cal: Calibration): CalibrationEval {
  const points = cal.rows.map((r) => {
    const s = signalForSource(project, cal, r);
    return { rowId: r.id, x: r.amount, y: s.value, excluded: r.excluded, label: s.label };
  });
  const used = points.filter((p) => !p.excluded && p.x != null && p.y != null);
  const fit = fitCalibration(used.map((p) => p.x!), used.map((p) => p.y!), cal.model, cal.weighting);
  return { calibration: cal, points, fit };
}

export function buildBandRows(project: Project): BandRow[] {
  const rows: BandRow[] = [];
  const evals = project.calibrations.filter((c) => c.targetId).map((c) => evaluateCalibration(project, c));
  for (const gel of project.gels) {
    const st = engine.status(gel.id);
    if (st.state !== 'ready') continue;
    gel.lanes.forEach((lane, li) => {
      if (lane.excluded) return;
      const an = analyzeLane(gel, lane, st.data, project.settings.negative);
      const len = Math.max(1, lane.bottom - lane.top);
      lane.bands.forEach((band, bi) => {
        const m = an.measures[bi];
        let amount: number | null = null;
        let amountStatus: BandRow['amountStatus'] = null;
        const ev = evals.find((e) => e.calibration.targetId === band.targetId);
        if (ev && !('error' in ev.fit)) {
          const y = ev.calibration.signal === 'volume' ? m.volume : m.area;
          const x = ev.fit.inverse(y);
          if (x == null || !Number.isFinite(x)) amountStatus = 'invalid';
          else {
            amount = x;
            amountStatus = x < ev.fit.xmin * 0.999 || x > ev.fit.xmax * 1.001 ? 'extrapolated' : 'ok';
          }
        }
        rows.push({
          gelId: gel.id, gelName: gel.name, laneId: lane.id, laneIndex: li, sample: lane.sample || `레인 ${li + 1}`,
          bandId: band.id, bandIndex: bi, targetId: band.targetId,
          position: an.profile.top + m.peak, rf: m.peak / len,
          height: m.height, area: m.area, volume: m.volume,
          pctLane: an.totalArea > 0 ? (m.area / an.totalArea) * 100 : 0,
          tilt: band.tilt ?? 0,
          saturatedPixels: m.saturatedPixels, negativeFraction: m.negativeFraction,
          amount, amountStatus,
        });
      });
    });
  }
  return rows;
}

export function useBandRows() {
  const project = useApp((s) => s.project);
  const { version } = useAllProcessed(project);
  return useMemo(() => buildBandRows(project), [project, version]);
}
