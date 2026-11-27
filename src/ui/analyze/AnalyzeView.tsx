import { useState } from 'react';
import type { Gel } from '../../core/types';
import { engine } from '../../engine/engine';
import { useAllProcessed, useGelStatus } from '../../engine/hooks';
import { addImageFiles, analyzeAllGels, autoDetectLanes, detectBandsAction, removeGel } from '../../state/actions';
import { findGel, useActiveGel, useApp } from '../../state/store';
import { Icon, Menu, pickFiles } from '../common';
import { thumbnailUrl } from '../render';
import { ImageView } from './ImageView';
import { Inspector } from './Inspector';
import { PrepareView } from './PrepareView';
import { ProfilePanel } from './ProfilePanel';
import { Stepper } from './Stepper';

export const IMAGE_ACCEPT = '.tif,.tiff,.png,.jpg,.jpeg,.bmp,image/*';

export function AnalyzeView() {
  const gel = useActiveGel();
  const gels = useApp((s) => s.project.gels);
  const ui = useApp((s) => s.ui);
  const setUi = useApp((s) => s.setUi);
  const { status, data } = useGelStatus(gel);

  return (
    <div className="analyze">
      <GelSidebar />
      {!ui.gridView && gel && <Stepper />}
      <div className="center">
        <div className="toolbar">
          <div className="seg">
            <button className={!ui.gridView ? 'on' : ''} onClick={() => setUi({ gridView: false })} title="한 장씩 분석"><Icon name="single" size={14} /></button>
            <button className={ui.gridView ? 'on' : ''} onClick={() => setUi({ gridView: true })} title={`전체 겔 한눈에 (${gels.length})`}><Icon name="grid" size={14} /></button>
          </div>
          <div className="sep" />
          {!ui.gridView && gel && (
            <>
              {ui.tool === 'lane' && (
                <div className="subtools">
                  <button className="btn sm active" title="빈 곳을 드래그해 레인을 그립니다. 그린 레인은 바로 끌어서 옮기거나 가장자리로 크기를 바꿀 수 있습니다">
                    <Icon name="lane" size={14} />레인 그리기
                  </button>
                  <button className="btn sm" onClick={() => autoDetectLanes(gel.id)} title="레인을 자동으로 찾습니다">
                    <Icon name="wand" size={14} />레인 검출 (Auto)
                  </button>
                </div>
              )}
              {ui.tool === 'band' && (
                <div className="subtools">
                  <button className="btn sm active" title="레인 안에서 위아래로 드래그해 밴드를 그립니다. 그린 밴드는 바로 끌어서 옮길 수 있습니다">
                    <Icon name="band" size={14} />밴드 그리기
                  </button>
                  <button className="btn sm" disabled={!gel.lanes.length} onClick={() => detectBandsAction(gel.id, 'all')} title="모든 레인에서 밴드를 자동으로 찾습니다">
                    <Icon name="sparkle" size={14} />밴드 검출 (Auto)
                  </button>
                </div>
              )}
              <div className="spacer" />
              <b className="gel-title">{gel.name}</b>
            </>
          )}
          {ui.gridView && (
            <>
              <span className="hint">프로젝트의 모든 겔 · 클릭하면 해당 겔 분석으로 이동</span>
              <div className="spacer" />
              <button className="btn sm primary" onClick={() => analyzeAllGels()}><Icon name="wand" size={14} />모든 겔 자동 분석</button>
            </>
          )}
        </div>
        {ui.gridView ? (
          <GridOverview />
        ) : gel ? (
          <>
            {ui.tool === 'select' ? (
              <PrepareView gel={gel} data={data} status={status} />
            ) : (
              <>
                <ImageView gel={gel} data={data} status={status} />
                <ProfilePanel gel={gel} data={data} />
              </>
            )}
          </>
        ) : (
          <div />
        )}
      </div>
      {gel && !ui.gridView ? <Inspector gel={gel} data={data} /> : <GridSideInfo />}
    </div>
  );
}

function GelThumb({ gel }: { gel: Gel }) {
  const { status: st } = useGelStatus(gel);
  if (st.state !== 'ready') {
    return <div className="gel-thumb" style={{ display: 'grid', placeItems: 'center', color: '#8a93a3', fontSize: 11 }}>{st.state === 'error' ? '오류' : '처리 중…'}</div>;
  }
  return <img className="gel-thumb" src={thumbnailUrl(gel, st.data, 240)} alt="" draggable={false} />;
}

function GelSidebar() {
  const gels = useApp((s) => s.project.gels);
  const activeId = useApp((s) => s.ui.activeGelId);
  const gridView = useApp((s) => s.ui.gridView);
  const setUi = useApp((s) => s.setUi);
  const update = useApp((s) => s.update);
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h3>이미지 {gels.length}</h3>
        <button className="btn sm" onClick={async () => addImageFiles(await pickFiles(IMAGE_ACCEPT, true))} title="이미지 추가 (여러 장 가능). 창 어디에나 끌어다 놓거나 Ctrl+V로 붙여넣어도 추가됩니다"><Icon name="plus" size={14} />추가</button>
      </div>
      <div className="gel-list">
        {gels.map((g) => {
          const bands = g.lanes.reduce((s, l) => s + l.bands.length, 0);
          const assigned = g.lanes.reduce((s, l) => s + l.bands.filter((b) => b.targetId).length, 0);
          return (
            <div key={g.id} className={`gel-item ${g.id === activeId && !gridView ? 'active' : ''}`}
              onClick={() => setUi({ activeGelId: g.id, selectedLaneId: g.lanes[0]?.id ?? null, selectedBandId: null, gridView: false })}>
              <GelThumb gel={g} />
              <div className="gel-info">
                {renaming === g.id ? (
                  <input type="text" autoFocus defaultValue={g.name} onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { update((d) => { const x = findGel(d, g.id); if (x) x.name = e.target.value || x.name; }); setRenaming(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
                ) : (
                  <div className="name" title={g.name} onDoubleClick={(e) => { e.stopPropagation(); setRenaming(g.id); }}>{g.name}</div>
                )}
                <div className="meta">
                  <span className="badge">{g.lanes.length} 레인</span>
                  <span className={`badge ${bands && assigned === bands ? 'ok' : bands ? 'accent' : ''}`}>{bands} 밴드</span>
                  {g.lossy && <span className="badge warn">JPG</span>}
                </div>
              </div>
              <div style={{ position: 'absolute', top: 3, right: 3 }} onClick={(e) => e.stopPropagation()}>
                <Menu button={(_, t) => <button className="btn sm icon" style={{ background: 'rgba(255,255,255,.85)', color: '#1d2330' }} onClick={t}><Icon name="more" size={14} stroke={3} /></button>}>
                  {(close) => (
                    <>
                      <button onClick={() => { setRenaming(g.id); close(); }}>이름 바꾸기</button>
                      <button className="danger" onClick={() => { removeGel(g.id); close(); }}>이미지 삭제</button>
                    </>
                  )}
                </Menu>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function GridOverview() {
  const project = useApp((s) => s.project);
  const gels = project.gels;
  const targets = project.targets;
  const setUi = useApp((s) => s.setUi);
  useAllProcessed(project);
  return (
    <div className="grid-view" style={{ gridRow: '2 / span 2' }}>
      {gels.map((g) => {
        const st = engine.status(g.id);
        const d = st.state === 'ready' ? st.data : null;
        const bands = g.lanes.reduce((s, l) => s + l.bands.length, 0);
        return (
          <div key={g.id} className="grid-card" onClick={() => setUi({ activeGelId: g.id, selectedLaneId: g.lanes[0]?.id ?? null, gridView: false })}>
            <div className="img">
              {d ? (
                <>
                  <img src={thumbnailUrl(g, d, 640)} alt="" draggable={false} />
                  <svg viewBox={`0 0 ${d.width} ${d.height}`} preserveAspectRatio="none">
                    {g.lanes.map((l) => (
                      <g key={l.id} opacity={l.excluded ? 0.4 : 1}>
                        {l.bands.map((b) => {
                          const c = targets.find((t) => t.id === b.targetId)?.color ?? '#ffffff';
                          return <rect key={b.id} x={l.cx - l.width / 2} y={l.top + b.start} width={l.width} height={b.end - b.start} fill={c} fillOpacity={0.25} stroke={c} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />;
                        })}
                        <rect x={l.cx - l.width / 2} y={l.top} width={l.width} height={l.bottom - l.top} fill="none" stroke="#ffd24d" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                      </g>
                    ))}
                  </svg>
                </>
              ) : (
                <div style={{ aspectRatio: '16/10', display: 'grid', placeItems: 'center', color: '#8a93a3' }}>처리 중…</div>
              )}
            </div>
            <div className="body">
              <b>{g.name}</b>
              <div className="btn-row" style={{ gap: 4 }}>
                <span className="badge">{g.lanes.length} 레인</span>
                <span className="badge">{bands} 밴드</span>
                <span className="badge">{g.bitDepth}-bit</span>
              </div>
              <div className="hint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {g.lanes.map((l) => l.sample).filter(Boolean).join(' · ') || '샘플 이름 없음'}
              </div>
            </div>
          </div>
        );
      })}
      <div className="grid-card" style={{ display: 'grid', placeItems: 'center', minHeight: 200, borderStyle: 'dashed' }}
        onClick={async () => addImageFiles(await pickFiles(IMAGE_ACCEPT, true))}>
        <div style={{ textAlign: 'center', color: 'var(--text-2)' }}><Icon name="plus" size={28} /><div>이미지 추가</div></div>
      </div>
    </div>
  );
}

function GridSideInfo() {
  const project = useApp((s) => s.project);
  const lanes = project.gels.reduce((s, g) => s + g.lanes.length, 0);
  const bands = project.gels.reduce((s, g) => s + g.lanes.reduce((a, l) => a + l.bands.length, 0), 0);
  const assigned = project.gels.reduce((s, g) => s + g.lanes.reduce((a, l) => a + l.bands.filter((b) => b.targetId).length, 0), 0);
  const samples = new Set(project.gels.flatMap((g) => g.lanes.map((l) => l.sample).filter(Boolean)));
  const setUi = useApp((s) => s.setUi);
  return (
    <aside className="inspector">
      <div className="section-body" style={{ paddingTop: 14 }}>
        <div className="subhead" style={{ marginTop: 0 }}>프로젝트 요약</div>
        <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="stat"><div className="k">겔</div><div className="v">{project.gels.length}</div></div>
          <div className="stat"><div className="k">샘플</div><div className="v">{samples.size}</div></div>
          <div className="stat"><div className="k">레인</div><div className="v">{lanes}</div></div>
          <div className="stat"><div className="k">밴드 (타깃 지정)</div><div className="v">{assigned}/{bands}</div></div>
        </div>
        <div className="subhead">여러 겔을 한 번에 분석하는 순서</div>
        <ol style={{ paddingLeft: 18, margin: 0, display: 'grid', gap: 6, color: 'var(--text-2)' }}>
          <li>이미지를 모두 추가합니다.</li>
          <li><b>모든 겔 자동 분석</b>으로 레인·밴드를 한 번에 검출합니다.</li>
          <li>각 겔을 열어 레인 위치와 <b>샘플 이름</b>을 확인합니다. 같은 샘플은 이름을 똑같이 적으면 겔을 넘어 묶입니다.</li>
          <li>밴드에 <b>타깃</b>을 지정합니다 (★ 로딩 컨트롤).</li>
          <li>한 겔에서 정한 처리 설정은 &quot;모든 겔에 복사&quot;로 통일합니다.</li>
          <li><a href="#" onClick={(e) => { e.preventDefault(); setUi({ tab: 'results' }); }}>결과</a> 탭에서 정규화된 값을 확인하고 엑셀로 내보냅니다.</li>
        </ol>
        <div className="subhead">정규화 기준</div>
        <div className="hint">
          로딩 컨트롤: {project.targets.find((t) => t.id === project.settings.loadingControlId)?.name ?? '미지정'}<br />
          기준 샘플: {project.settings.referenceSample ?? '미지정'}
        </div>
      </div>
    </aside>
  );
}
