import { useMemo, useState } from 'react';
import { summarize, type BandRow, type Stat } from '../../core/results';
import type { Project } from '../../core/types';
import { useAllProcessed, useBandRows } from '../../engine/hooks';
import { analyzeAllGels } from '../../state/actions';
import { useApp } from '../../state/store';
import { copyText, Icon } from '../common';
import { fmt, fmtPct } from '../render';
import { BAND_DEFAULT_COLOR } from '../colors';

// 엑셀 라이브러리는 크므로 내보낼 때만 불러온다
const loadExport = () => import('./export');

/**
 * 결과 화면 (간단 버전)
 * - 전체 밴드 표: 이미지·레인·샘플·밴드마다 면적과 %
 * - 타깃을 지정한 밴드가 있으면 샘플별 평균과, 기준 샘플 대비 상대값을 함께 보여준다
 */
export function ResultsView() {
  const project = useApp((s) => s.project);
  const update = useApp((s) => s.update);
  const setUi = useApp((s) => s.setUi);
  const toast = useApp((s) => s.toast);
  const rows = useBandRows();
  const { ready, total } = useAllProcessed(project);
  const [chartTarget, setChartTarget] = useState<string | null>(null);

  const ref = project.settings.referenceSample;
  // 로딩 컨트롤 정규화는 지금은 쓰지 않는다
  const summary = useMemo(() => summarize(rows, 'area', null, ref), [rows, ref]);
  const tname = (id: string | null) => project.targets.find((t) => t.id === id)?.name ?? '';
  const saturated = rows.filter((r) => r.saturatedPixels > 0).length;
  const nonLinear = project.gels.filter((g) => g.display.applyToData);
  const activeTarget = chartTarget && summary.targets.includes(chartTarget) ? chartTarget : summary.targets[0] ?? null;

  if (!project.gels.length) {
    return <div className="page"><div className="page-inner"><div className="card card-body">이미지를 먼저 추가하세요.</div></div></div>;
  }

  const goTo = (r: BandRow) => setUi({ tab: 'analyze', gridView: false, activeGelId: r.gelId, selectedLaneId: r.laneId, selectedBandId: r.bandId });

  return (
    <div className="page">
      <div className="page-inner">
        {ready < total && <div className="note info">이미지 처리 중… ({ready}/{total})</div>}

        {rows.length === 0 && ready === total ? (
          <div className="card card-body" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <b>아직 측정된 밴드가 없습니다.</b>
              <div className="hint">분석 탭에서 레인과 밴드를 정하거나, 모든 이미지를 한 번에 자동으로 분석하세요.</div>
            </div>
            <button className="btn primary" onClick={() => analyzeAllGels()}><Icon name="wand" />모든 이미지 자동 분석</button>
          </div>
        ) : (
          <>
            {/* 샘플별 요약: 타깃을 지정한 밴드가 있을 때만 */}
            {summary.cells.length > 0 && (
              <div className="card">
                <div className="card-head">
                  <h3>샘플별 요약</h3>
                  <span className="hint">같은 샘플 이름의 레인을 모아 평균 ± 표준편차</span>
                  <div className="spacer" />
                  <label className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    기준 샘플 (= 1)
                    <select value={ref ?? ''} onChange={(e) => update((d) => { d.settings.referenceSample = e.target.value || null; })} style={{ width: 'auto' }}>
                      <option value="">없음</option>
                      {summary.samples.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>
                <div className="card-body" style={{ display: 'grid', gap: 14 }}>
                  <div className="table-wrap" style={{ maxHeight: 360 }}>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>샘플</th>
                          {summary.targets.map((t) => (
                            <th key={t} className="num">
                              <span className="dot" style={{ background: project.targets.find((x) => x.id === t)?.color, marginRight: 5 }} />{tname(t)} 면적
                              {ref && <span className="hint"> · 상대값</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {summary.samples.map((s) => (
                          <tr key={s} className={s === ref ? 'sel' : ''}>
                            <td><b>{s}</b>{s === ref && <span className="badge accent" style={{ marginLeft: 6 }}>기준</span>}</td>
                            {summary.targets.map((t) => {
                              const c = summary.cells.find((x) => x.sample === s && x.targetId === t);
                              return (
                                <td key={t} className="num">
                                  {c ? <>{statText(c.raw)} <span className="hint">(n={c.raw.n})</span>{ref && c.relative && <b style={{ marginLeft: 8 }}>{fmt(c.relative.mean, 3)}×</b>}</> : '–'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {activeTarget && (
                    <div>
                      <div className="btn-row" style={{ marginBottom: 6 }}>
                        <b>그래프</b>
                        <select value={activeTarget} onChange={(e) => setChartTarget(e.target.value)} style={{ width: 'auto' }}>
                          {summary.targets.map((t) => <option key={t} value={t}>{tname(t)}</option>)}
                        </select>
                        <span className="hint">{ref ? `${ref} 대비 상대값` : '평균 면적'} · 막대 = 평균, 점 = 각 레인, 선 = 표준편차</span>
                      </div>
                      <BarChart
                        data={summary.samples.map((s) => {
                          const c = summary.cells.find((x) => x.sample === s && x.targetId === activeTarget);
                          return { sample: s, stat: c ? (ref ? c.relative : c.raw) : null };
                        })}
                        color={project.targets.find((t) => t.id === activeTarget)?.color ?? '#2f7fd8'}
                        refLine={!!ref}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-head">
                <h3>전체 밴드</h3>
                <span className="hint">이미지 {ready}장 · 밴드 {rows.length}개 · 행을 누르면 그 밴드로 이동</span>
                <div className="spacer" />
                <button className="btn sm primary" onClick={async () => (await loadExport()).exportXlsx(project, rows, summary, 'area')}><Icon name="download" size={14} />엑셀</button>
                <button className="btn sm" onClick={async () => (await loadExport()).exportCsv(project, rows)}><Icon name="download" size={14} />CSV</button>
                <button className="btn sm" onClick={async () => {
                  const ok = await copyText((await loadExport()).rowsToTsv(project, rows));
                  toast(ok
                    ? { kind: 'success', text: '표를 복사했습니다. 엑셀에 바로 붙여넣으세요.' }
                    : { kind: 'error', text: '브라우저가 복사를 막았습니다. 엑셀 버튼으로 내려받으세요.' });
                }}><Icon name="copy" size={14} />표 복사</button>
              </div>
              {(saturated > 0 || nonLinear.length > 0) && (
                <div className="card-body btn-row" style={{ paddingBottom: 0 }}>
                  {saturated > 0 && <span className="badge warn">포화 픽셀이 있는 밴드 {saturated}개 — 값이 작게 나올 수 있음</span>}
                  {nonLinear.length > 0 && <span className="badge warn">밝기·감마가 측정값에 적용된 이미지: {nonLinear.map((g) => g.name).join(', ')}</span>}
                </div>
              )}
              <div className="table-wrap">
                <BandTable project={project} rows={rows} onRow={goTo} />
              </div>
            </div>
            <div className="hint">
              면적 = 바닥선(베이스라인) 위의 넓이, % 레인 = 그 레인의 모든 밴드 면적 합에 대한 비율입니다.
              엑셀 파일에는 위치·높이·Volume 등 자세한 값과 분석 설정이 함께 들어갑니다.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BandTable({ project, rows, onRow }: { project: Project; rows: BandRow[]; onRow: (r: BandRow) => void }) {
  const [sort, setSort] = useState<{ key: keyof BandRow; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sort.key], vb = b[sort.key];
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
      return String(va ?? '').localeCompare(String(vb ?? ''), 'ko', { numeric: true }) * sort.dir;
    });
  }, [rows, sort]);
  const th = (key: keyof BandRow, label: string, num = false) => (
    <th className={num ? 'num' : ''} style={{ cursor: 'pointer' }} title="눌러서 정렬"
      onClick={() => setSort((s) => ({ key, dir: s?.key === key && s.dir === 1 ? -1 : 1 }))}>
      {label}{sort?.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  );
  // 이미지가 바뀌는 행에 구분선을 넣어 보기 쉽게
  let prevGel = '';
  return (
    <table className="tbl results-table">
      <thead>
        <tr>{th('gelName', '이미지')}{th('laneIndex', '레인', true)}{th('sample', '샘플')}{th('bandIndex', '밴드', true)}{th('targetId', '타깃')}{th('tilt', '기울기', true)}{th('area', '면적', true)}{th('pctLane', '% 레인', true)}</tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const newGel = !sort && r.gelId !== prevGel;
          prevGel = r.gelId;
          const t = project.targets.find((x) => x.id === r.targetId);
          return (
            <tr key={r.bandId} className={`click ${newGel ? 'group-start' : ''}`} onClick={() => onRow(r)}>
              <td>{r.gelName}</td>
              <td className="num">{r.laneIndex + 1}</td>
              <td>{r.sample}</td>
              <td className="num"><span className="dot" style={{ background: t?.color ?? BAND_DEFAULT_COLOR, marginRight: 5 }} />{r.bandIndex + 1}</td>
              <td>{t?.name ?? <span className="hint">–</span>}</td>
              <td className="num">{r.tilt ? r.tilt : <span className="hint">0</span>}</td>
              <td className="num big">{fmt(r.area)}{r.saturatedPixels > 0 && <span className="badge warn" style={{ marginLeft: 4 }}>포화</span>}</td>
              <td className="num big">{fmtPct(r.pctLane)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function statText(s: Stat | null) {
  if (!s) return '–';
  return `${fmt(s.mean)}${s.n > 1 && Number.isFinite(s.sd) ? ` ± ${fmt(s.sd, 2)}` : ''}`;
}

function BarChart({ data: raw, color, refLine }: { data: { sample: string; stat: Stat | null }[]; color: string; refLine: boolean }) {
  const data = raw.filter((d) => d.stat) as { sample: string; stat: Stat }[];
  if (!data.length) return <div className="hint">표시할 값이 없습니다.</div>;
  const W = Math.max(420, data.length * 90), H = 260;
  const pad = { l: 60, r: 16, t: 14, b: 46 };
  let max = 0;
  for (const d of data) for (const v of d.stat.values) max = Math.max(max, v, d.stat.mean + (Number.isFinite(d.stat.sd) ? d.stat.sd : 0));
  max = max * 1.12 || 1;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const bw = (iw / data.length) * 0.56;
  const X = (i: number) => pad.l + (i + 0.5) * (iw / data.length);
  const Y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = Array.from({ length: 5 }, (_, i) => (max / 4) * i);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H} className="chart" style={{ height: H, width: W }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke="var(--chart-grid)" />
            <text x={pad.l - 6} y={Y(t)} textAnchor="end" dominantBaseline="middle">{fmt(t, 3)}</text>
          </g>
        ))}
        {refLine && <line x1={pad.l} x2={W - pad.r} y1={Y(1)} y2={Y(1)} stroke="var(--text-3)" strokeDasharray="4 3" />}
        {data.map((d, i) => {
          const st = d.stat;
          const sd = Number.isFinite(st.sd) ? st.sd : 0;
          return (
            <g key={d.sample}>
              <rect x={X(i) - bw / 2} y={Y(st.mean)} width={bw} height={Math.max(0, Y(0) - Y(st.mean))} fill={color} fillOpacity={0.75} rx={3} />
              {sd > 0 && (
                <g stroke="var(--text)" strokeWidth={1.3}>
                  <line x1={X(i)} x2={X(i)} y1={Y(st.mean + sd)} y2={Y(Math.max(0, st.mean - sd))} />
                  <line x1={X(i) - 7} x2={X(i) + 7} y1={Y(st.mean + sd)} y2={Y(st.mean + sd)} />
                  <line x1={X(i) - 7} x2={X(i) + 7} y1={Y(Math.max(0, st.mean - sd))} y2={Y(Math.max(0, st.mean - sd))} />
                </g>
              )}
              {st.values.map((v, k) => (
                <circle key={k} cx={X(i) + (st.values.length > 1 ? (k / (st.values.length - 1) - 0.5) * bw * 0.5 : 0)} cy={Y(v)} r={3.2} fill="var(--panel)" stroke="var(--text)" strokeWidth={1.2} />
              ))}
              <text x={X(i)} y={Y(st.mean + sd) - 6} textAnchor="middle" style={{ fill: 'var(--text)', fontWeight: 600 }}>{fmt(st.mean, 3)}</text>
              <text x={X(i)} y={H - pad.b + 16} textAnchor="middle" style={{ fill: 'var(--text-2)' }}>{d.sample.length > 14 ? d.sample.slice(0, 13) + '…' : d.sample}</text>
              <text x={X(i)} y={H - pad.b + 30} textAnchor="middle">n={st.n}</text>
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={Y(0)} y2={Y(0)} stroke="var(--line-strong)" />
      </svg>
    </div>
  );
}
