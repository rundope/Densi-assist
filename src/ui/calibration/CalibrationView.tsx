import { useMemo, useState } from 'react';
import { MODEL_INFO, type FitResult } from '../../core/calibration';
import type { Calibration, CalibrationModel, CalibrationRow, CalibrationWeighting, Project } from '../../core/types';
import { useBandRows, evaluateCalibration, type CalibrationEval } from '../../engine/hooks';
import { useAllProcessed } from '../../engine/hooks';
import { newCalibration, uid } from '../../state/project';
import { useApp } from '../../state/store';
import { Icon, Modal, Seg } from '../common';
import { fmt } from '../render';

export function CalibrationView() {
  const project = useApp((s) => s.project);
  const calId = useApp((s) => s.ui.calibrationId);
  const setUi = useApp((s) => s.setUi);
  const update = useApp((s) => s.update);
  useAllProcessed(project);
  const cal = project.calibrations.find((c) => c.id === calId) ?? project.calibrations[0] ?? null;

  const add = () => {
    const c = newCalibration(project.calibrations);
    update((d) => { d.calibrations.push(c); });
    setUi({ calibrationId: c.id });
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="cal-layout">
          <div className="cal-list">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <b>표준곡선</b>
              <button className="btn sm" onClick={add}><Icon name="plus" size={14} />새로 만들기</button>
            </div>
            {project.calibrations.map((c) => {
              const ev = evaluateCalibration(project, c);
              return (
                <div key={c.id} className={`cal-item ${cal?.id === c.id ? 'active' : ''}`} onClick={() => setUi({ calibrationId: c.id })}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  <div className="hint">{MODEL_INFO[c.model].label} · {'error' in ev.fit ? '점 부족' : `R² ${ev.fit.r2.toFixed(4)}`}</div>
                </div>
              );
            })}
            <div className="note" style={{ marginTop: 6 }}>
              농도(양)별로 로딩한 표준 시료의 신호로 곡선을 만들고, 같은 타깃의 미지 시료 밴드를 양으로 환산합니다.
              분석 화면은 그대로 두고 여기서만 다룹니다.
            </div>
          </div>
          {cal ? <CalibrationEditor key={cal.id} cal={cal} project={project} /> : (
            <div className="card card-body" style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
              <b>표준곡선이 없습니다.</b>
              <div className="hint">농도별로 로딩한 밴드가 있다면 표준곡선을 만들어 정량값을 계산할 수 있습니다. 엑셀에서 두 열(양, 신호)을 복사해 붙여넣어도 됩니다.</div>
              <button className="btn primary" onClick={add}><Icon name="plus" />표준곡선 만들기</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CalibrationEditor({ cal, project }: { cal: Calibration; project: Project }) {
  const update = useApp((s) => s.update);
  const setUi = useApp((s) => s.setUi);
  const toast = useApp((s) => s.toast);
  const [picker, setPicker] = useState(false);
  const [logX, setLogX] = useState(false);
  const ev = useMemo(() => evaluateCalibration(project, cal), [project, cal]);
  const fit = 'error' in ev.fit ? null : ev.fit;

  const upCal = (fn: (c: Calibration) => void, key?: string) => update((d) => { const c = d.calibrations.find((x) => x.id === cal.id); if (c) fn(c); }, key);
  const upRow = (rowId: string, fn: (r: CalibrationRow) => void, key?: string) => upCal((c) => { const r = c.rows.find((x) => x.id === rowId); if (r) fn(r); }, key);
  const newRow = (): CalibrationRow => ({ id: uid('r'), amount: null, source: { kind: 'manual', value: null }, excluded: false, note: '' });

  const onPaste = (e: React.ClipboardEvent, rowIndex: number, col: 0 | 1) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.trim())) return; // 한 칸짜리는 기본 동작
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    const parsed = lines.map((l) => l.split('\t').map((s) => s.trim()));
    // 첫 줄이 숫자가 아니면 머리글로 보고 건너뜀
    const isNum = (s: string | undefined) => s != null && s !== '' && Number.isFinite(Number(s.replace(/,/g, '')));
    const data = parsed.filter((cells, i) => !(i === 0 && !cells.some(isNum)));
    const num = (s: string | undefined) => (isNum(s) ? Number(s!.replace(/,/g, '')) : null);
    upCal((c) => {
      while (c.rows.length < rowIndex + data.length) c.rows.push(newRow());
      data.forEach((cells, k) => {
        const r = c.rows[rowIndex + k];
        if (col === 0) {
          r.amount = num(cells[0]);
          if (cells.length > 1) r.source = { kind: 'manual', value: num(cells[1]) };
        } else {
          r.source = { kind: 'manual', value: num(cells[0]) };
        }
      });
    });
    toast({ kind: 'success', text: `${data.length}행을 붙여넣었습니다.` });
  };

  return (
    <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <div className="card">
        <div className="card-head">
          <input type="text" value={cal.name} onChange={(e) => upCal((c) => { c.name = e.target.value; }, 'cal-name')} style={{ fontWeight: 600, width: 220 }} />
          <div className="spacer" />
          <button className="btn sm danger" onClick={() => {
            update((d) => { d.calibrations = d.calibrations.filter((c) => c.id !== cal.id); });
            setUi({ calibrationId: null });
            toast({ kind: 'info', text: '표준곡선을 삭제했습니다.', action: { label: '되돌리기', run: () => useApp.getState().undo() } });
          }}><Icon name="trash" size={14} />삭제</button>
        </div>
        <div className="card-body controls">
          <div className="field">
            <div className="label"><span>모델</span></div>
            <select value={cal.model} onChange={(e) => upCal((c) => { c.model = e.target.value as CalibrationModel; })}>
              {(Object.keys(MODEL_INFO) as CalibrationModel[]).map((m) => <option key={m} value={m}>{MODEL_INFO[m].label} — {MODEL_INFO[m].formula}</option>)}
            </select>
          </div>
          <div className="field">
            <div className="label"><span>가중치</span></div>
            <Seg value={cal.weighting} onChange={(v: CalibrationWeighting) => upCal((c) => { c.weighting = v; })}
              options={[{ value: 'none', label: '없음' }, { value: '1/x', label: '1/x' }, { value: '1/x2', label: '1/x²' }]} />
          </div>
          <div className="field">
            <div className="label"><span>단위</span></div>
            <input type="text" value={cal.unit} onChange={(e) => upCal((c) => { c.unit = e.target.value; }, 'cal-unit')} style={{ width: 90 }} />
          </div>
          <div className="field">
            <div className="label"><span>밴드 신호</span></div>
            <Seg value={cal.signal} onChange={(v) => upCal((c) => { c.signal = v; })} options={[{ value: 'area', label: '면적' }, { value: 'volume', label: 'Volume' }]} />
          </div>
          <div className="field">
            <div className="label"><span>역산할 타깃</span></div>
            <select value={cal.targetId ?? ''} onChange={(e) => upCal((c) => { c.targetId = e.target.value || null; })}>
              <option value="">(역산 안 함)</option>
              {project.targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="hint">{MODEL_INFO[cal.model].note}</div>
        </div>
      </div>

      <div className="cal-grid">
        <div className="card" style={{ minWidth: 0 }}>
          <div className="card-head">
            <h3>표준 시료</h3>
            <div className="spacer" />
            <button className="btn sm" onClick={() => setPicker(true)} disabled={!project.gels.length}><Icon name="band" size={14} />밴드에서 가져오기</button>
            <button className="btn sm" onClick={() => upCal((c) => { c.rows.push(newRow()); })}><Icon name="plus" size={14} />행</button>
          </div>
          <div className="table-wrap">
            <table className="tbl sheet">
              <thead>
                <tr><th style={{ width: 30 }} title="곡선 적합에 사용">사용</th><th>양 ({cal.unit})</th><th>신호</th><th>출처</th><th className="num">역산</th><th className="num">회수율</th><th /></tr>
              </thead>
              <tbody>
                {cal.rows.map((r, i) => {
                  const p = ev.points[i];
                  const back = fit && p?.y != null ? fit.inverse(p.y) : null;
                  const rec = back != null && r.amount ? (back / r.amount) * 100 : null;
                  return (
                    <tr key={r.id} className={r.excluded ? 'muted' : ''}>
                      <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!r.excluded} onChange={(e) => upRow(r.id, (x) => { x.excluded = !e.target.checked; })} /></td>
                      <td>
                        <input type="number" value={r.amount ?? ''} placeholder="입력"
                          onPaste={(e) => onPaste(e, i, 0)}
                          onChange={(e) => upRow(r.id, (x) => { x.amount = e.target.value === '' ? null : Number(e.target.value); }, `amt-${r.id}`)} />
                      </td>
                      <td>
                        {r.source.kind === 'manual' ? (
                          <input type="number" value={r.source.value ?? ''} placeholder="신호"
                            onPaste={(e) => onPaste(e, i, 1)}
                            onChange={(e) => upRow(r.id, (x) => { x.source = { kind: 'manual', value: e.target.value === '' ? null : Number(e.target.value) }; }, `sig-${r.id}`)} />
                        ) : (
                          <span className="ro num" style={{ display: 'block', padding: '0 8px' }}>{fmt(p?.y)}</span>
                        )}
                      </td>
                      <td className="ro" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={p?.label}>
                        {r.source.kind === 'band' ? (
                          <a href="#" onClick={(e) => {
                            e.preventDefault();
                            if (r.source.kind === 'band') setUi({ tab: 'analyze', gridView: false, activeGelId: r.source.gelId, selectedLaneId: r.source.laneId, selectedBandId: r.source.bandId });
                          }}>{p?.label}</a>
                        ) : '직접 입력'}
                      </td>
                      <td className="num ro">{fmt(back)}</td>
                      <td className={`num ro`} style={{ color: rec != null && Math.abs(rec - 100) > 20 ? 'var(--warn)' : undefined }}>{rec != null ? `${rec.toFixed(1)}%` : '–'}</td>
                      <td>
                        <button className="btn ghost sm icon" title="행 삭제" onClick={() => upCal((c) => { c.rows = c.rows.filter((x) => x.id !== r.id); })}><Icon name="x" size={12} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-body hint">
            엑셀에서 <b>양·신호</b> 두 열을 복사해 &quot;양&quot; 칸에 붙여넣으면 여러 행이 한 번에 채워집니다. 신호를 측정한 밴드와 연결하면 베이스라인을 바꿀 때 자동으로 갱신됩니다.
          </div>
        </div>

        <div className="card" style={{ minWidth: 0 }}>
          <div className="card-head">
            <h3>곡선</h3>
            <div className="spacer" />
            <label className="check"><input type="checkbox" checked={logX} onChange={(e) => setLogX(e.target.checked)} />log x축</label>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 12 }}>
            {'error' in ev.fit ? <div className="note warn">{ev.fit.error}</div> : null}
            <CurveChart ev={ev} logX={logX} />
            {fit && <FitStats fit={fit} unit={cal.unit} />}
          </div>
        </div>
      </div>

      {cal.targetId && <Unknowns cal={cal} fit={fit} project={project} />}
      {picker && <BandPicker cal={cal} project={project} onClose={() => setPicker(false)} />}
    </div>
  );
}

function FitStats({ fit, unit }: { fit: FitResult; unit: string }) {
  return (
    <>
      <div className="mono" style={{ fontSize: 13 }}>{fit.equation}</div>
      <div className="stat-grid">
        <div className="stat"><div className="k">R²</div><div className="v" style={{ color: fit.r2 < 0.98 ? 'var(--warn)' : undefined }}>{fit.r2.toFixed(4)}</div></div>
        <div className="stat"><div className="k">보정 R²</div><div className="v">{Number.isFinite(fit.adjR2) ? fit.adjR2.toFixed(4) : '–'}</div></div>
        <div className="stat"><div className="k">RMSE</div><div className="v">{fmt(fit.rmse, 3)}</div></div>
        <div className="stat"><div className="k">점 수</div><div className="v">{fit.n}</div></div>
        <div className="stat"><div className="k">범위 ({unit})</div><div className="v">{fmt(fit.xmin, 3)}–{fmt(fit.xmax, 3)}</div></div>
        {fit.lod != null && <div className="stat" title="3.3 × 잔차 표준편차 / 기울기"><div className="k">LOD ({unit})</div><div className="v">{fmt(fit.lod, 3)}</div></div>}
        {fit.loq != null && <div className="stat" title="10 × 잔차 표준편차 / 기울기"><div className="k">LOQ ({unit})</div><div className="v">{fmt(fit.loq, 3)}</div></div>}
      </div>
    </>
  );
}

function CurveChart({ ev, logX }: { ev: CalibrationEval; logX: boolean }) {
  const rows = useBandRows();
  const fit = 'error' in ev.fit ? null : ev.fit;
  const pts = ev.points.filter((p) => p.x != null && p.y != null && (!logX || p.x! > 0));
  const unknowns = fit && ev.calibration.targetId
    ? rows.filter((r) => r.targetId === ev.calibration.targetId && r.amount != null && !ev.calibration.rows.some((cr) => cr.source.kind === 'band' && cr.source.bandId === r.bandId))
      .map((r) => ({ x: r.amount!, y: ev.calibration.signal === 'volume' ? r.volume : r.area, out: r.amountStatus !== 'ok', label: r.sample }))
      .filter((u) => !logX || u.x > 0)
    : [];
  if (!pts.length) return <div className="hint" style={{ height: 260, display: 'grid', placeItems: 'center' }}>양과 신호를 입력하면 곡선이 그려집니다.</div>;

  const W = 520, H = 300, pad = { l: 64, r: 16, t: 12, b: 40 };
  const xs = [...pts.map((p) => p.x!), ...unknowns.map((u) => u.x)];
  const ys = [...pts.map((p) => p.y!), ...unknowns.map((u) => u.y)];
  const tx = (v: number) => (logX ? Math.log10(v) : v);
  let x0 = Math.min(...xs.map(tx)), x1 = Math.max(...xs.map(tx));
  if (!logX) x0 = Math.min(0, x0);
  const xp = (x1 - x0) * 0.06 || 1;
  x0 -= logX ? xp : 0; x1 += xp;
  let y0 = Math.min(0, ...ys), y1 = Math.max(...ys);
  const yp = (y1 - y0) * 0.08 || 1;
  y1 += yp; if (y0 < 0) y0 -= yp;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const X = (v: number) => pad.l + ((tx(v) - x0) / (x1 - x0)) * iw;
  const Y = (v: number) => pad.t + ih - ((v - y0) / (y1 - y0)) * ih;

  let curve = '';
  if (fit) {
    for (let k = 0; k <= 120; k++) {
      const t = x0 + ((x1 - x0) * k) / 120;
      const xv = logX ? Math.pow(10, t) : t;
      const yv = fit.predict(xv);
      if (!Number.isFinite(yv)) continue;
      curve += `${curve ? 'L' : 'M'}${X(xv).toFixed(1)},${Y(Math.max(y0, Math.min(y1, yv))).toFixed(1)}`;
    }
  }
  const ticksX = Array.from({ length: 5 }, (_, i) => x0 + ((x1 - x0) * i) / 4);
  const ticksY = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" style={{ width: '100%', height: 'auto' }}>
      {ticksY.map((t, i) => <g key={i}><line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke="var(--chart-grid)" /><text x={pad.l - 6} y={Y(t)} textAnchor="end" dominantBaseline="middle">{fmt(t, 3)}</text></g>)}
      {ticksX.map((t, i) => <text key={i} x={pad.l + ((t - x0) / (x1 - x0)) * iw} y={H - pad.b + 16} textAnchor="middle">{fmt(logX ? Math.pow(10, t) : t, 3)}</text>)}
      <text x={pad.l + iw / 2} y={H - 6} textAnchor="middle">양 ({ev.calibration.unit})</text>
      <text x={14} y={pad.t + ih / 2} textAnchor="middle" transform={`rotate(-90 14 ${pad.t + ih / 2})`}>신호</text>
      {fit && fit.xmin < fit.xmax && (
        <rect x={X(logX ? Math.max(fit.xmin, 1e-12) : fit.xmin)} y={pad.t} width={Math.max(0, X(fit.xmax) - X(logX ? Math.max(fit.xmin, 1e-12) : fit.xmin))} height={ih} fill="var(--accent)" opacity={0.05} />
      )}
      {curve && <path d={curve} fill="none" stroke="var(--accent)" strokeWidth={2} />}
      {pts.map((p) => p.excluded ? (
        <g key={p.rowId} stroke="var(--text-3)" strokeWidth={1.6}>
          <line x1={X(p.x!) - 4} x2={X(p.x!) + 4} y1={Y(p.y!) - 4} y2={Y(p.y!) + 4} />
          <line x1={X(p.x!) - 4} x2={X(p.x!) + 4} y1={Y(p.y!) + 4} y2={Y(p.y!) - 4} />
        </g>
      ) : (
        <circle key={p.rowId} cx={X(p.x!)} cy={Y(p.y!)} r={4.5} fill="var(--accent)" stroke="var(--panel)" strokeWidth={1.5}><title>{`${p.x} → ${fmt(p.y)}`}</title></circle>
      ))}
      {unknowns.map((u, i) => (
        <g key={i}>
          <rect x={X(u.x) - 4} y={Y(u.y) - 4} width={8} height={8} transform={`rotate(45 ${X(u.x)} ${Y(u.y)})`} fill="var(--panel)" stroke={u.out ? 'var(--warn)' : 'var(--ok)'} strokeWidth={1.8} />
          <title>{`${u.label}: ${fmt(u.x)}`}</title>
        </g>
      ))}
      <line x1={pad.l} x2={pad.l} y1={pad.t} y2={pad.t + ih} stroke="var(--line-strong)" />
      <line x1={pad.l} x2={W - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke="var(--line-strong)" />
      {unknowns.length > 0 && (
        <g transform={`translate(${pad.l + 8}, ${pad.t + 8})`}>
          <circle cx={4} cy={4} r={4} fill="var(--accent)" /><text x={12} y={8}>표준</text>
          <rect x={52} y={0} width={8} height={8} transform="rotate(45 56 4)" fill="none" stroke="var(--ok)" strokeWidth={1.6} /><text x={66} y={8}>미지 시료</text>
        </g>
      )}
    </svg>
  );
}

function Unknowns({ cal, fit, project }: { cal: Calibration; fit: FitResult | null; project: Project }) {
  const rows = useBandRows();
  const setUi = useApp((s) => s.setUi);
  const tname = project.targets.find((t) => t.id === cal.targetId)?.name;
  const list = rows.filter((r) => r.targetId === cal.targetId && !cal.rows.some((cr) => cr.source.kind === 'band' && cr.source.bandId === r.bandId));
  return (
    <div className="card">
      <div className="card-head"><h3>미지 시료 역산: {tname}</h3><span className="hint">표준곡선에 쓰인 밴드는 제외</span></div>
      <div className="table-wrap">
        {list.length && fit ? (
          <table className="tbl">
            <thead><tr><th>겔</th><th>레인</th><th>샘플</th><th className="num">신호</th><th className="num">양 ({cal.unit})</th><th>상태</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.bandId} className="click" onClick={() => setUi({ tab: 'analyze', gridView: false, activeGelId: r.gelId, selectedLaneId: r.laneId, selectedBandId: r.bandId })}>
                  <td>{r.gelName}</td><td className="num">{r.laneIndex + 1}</td><td>{r.sample}</td>
                  <td className="num">{fmt(cal.signal === 'volume' ? r.volume : r.area)}</td>
                  <td className="num">{fmt(r.amount)}</td>
                  <td>{r.amountStatus === 'ok' ? <span className="badge ok">범위 안</span> : r.amountStatus === 'extrapolated' ? <span className="badge warn" title="표준 범위를 벗어난 외삽값은 신뢰도가 낮습니다">범위 밖 (외삽)</span> : <span className="badge err">계산 불가</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="card-body hint">{fit ? `"${tname}" 타깃으로 지정된 다른 밴드가 없습니다.` : '곡선 적합이 먼저 필요합니다.'}</div>}
      </div>
    </div>
  );
}

function BandPicker({ cal, project, onClose }: { cal: Calibration; project: Project; onClose: () => void }) {
  const update = useApp((s) => s.update);
  const rows = useBandRows();
  const [gelId, setGelId] = useState(project.gels[0]?.id ?? '');
  const [targetId, setTargetId] = useState<string>(cal.targetId ?? '');
  const candidates = rows.filter((r) => r.gelId === gelId && (!targetId || r.targetId === targetId));
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const parseAmount = (s: string) => {
    const m = s.match(/(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  };
  return (
    <Modal title="밴드에서 표준 시료 가져오기" onClose={onClose} width={680}>
      <div className="controls">
        <div className="field">
          <div className="label"><span>겔</span></div>
          <select value={gelId} onChange={(e) => { setGelId(e.target.value); setChecked(new Set()); }}>
            {project.gels.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div className="field">
          <div className="label"><span>타깃</span></div>
          <select value={targetId} onChange={(e) => { setTargetId(e.target.value); setChecked(new Set()); }}>
            <option value="">(모든 밴드)</option>
            {project.targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="tbl">
          <thead><tr>
            <th><input type="checkbox" checked={candidates.length > 0 && checked.size === candidates.length} onChange={(e) => setChecked(e.target.checked ? new Set(candidates.map((c) => c.bandId)) : new Set())} /></th>
            <th>레인</th><th>샘플</th><th>밴드</th><th className="num">면적</th><th className="num">샘플명에서 읽은 양</th>
          </tr></thead>
          <tbody>
            {candidates.map((r) => (
              <tr key={r.bandId} className="click" onClick={() => setChecked((s) => { const n = new Set(s); if (n.has(r.bandId)) n.delete(r.bandId); else n.add(r.bandId); return n; })}>
                <td><input type="checkbox" readOnly checked={checked.has(r.bandId)} /></td>
                <td className="num">{r.laneIndex + 1}</td><td>{r.sample}</td><td className="num">{r.bandIndex + 1}</td>
                <td className="num">{fmt(r.area)}</td><td className="num">{fmt(parseAmount(r.sample))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!candidates.length && <div className="hint" style={{ padding: 10 }}>조건에 맞는 밴드가 없습니다.</div>}
      </div>
      <div className="hint">샘플 이름에 숫자가 있으면 (예: &quot;Std 10 ng&quot;) 양으로 미리 채웁니다. 가져온 뒤 표에서 수정할 수 있습니다.</div>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={!checked.size} onClick={() => {
          const picked = candidates.filter((c) => checked.has(c.bandId));
          update((d) => {
            const c = d.calibrations.find((x) => x.id === cal.id);
            if (!c) return;
            // 빈 행은 정리
            c.rows = c.rows.filter((r) => !(r.source.kind === 'manual' && r.source.value == null && r.amount == null));
            for (const p of picked) {
              if (c.rows.some((r) => r.source.kind === 'band' && r.source.bandId === p.bandId)) continue;
              c.rows.push({ id: uid('r'), amount: parseAmount(p.sample), source: { kind: 'band', gelId: p.gelId, laneId: p.laneId, bandId: p.bandId }, excluded: false, note: '' });
            }
            if (!c.targetId && targetId) c.targetId = targetId;
          });
          onClose();
        }}>{checked.size}개 가져오기</button>
      </div>
    </Modal>
  );
}
