import { useEffect, useState } from 'react';
import { createDemoProject, addImageFiles, nameClipboardFiles, pasteFromClipboard } from '../state/actions';
import { deleteStoredProject, exportProjectFile, importProjectFile, listProjects, loadStoredProject, type ProjectIndexEntry } from '../state/persist';
import { newProject } from '../state/project';
import { findGel, useApp } from '../state/store';
import { AnalyzeView, IMAGE_ACCEPT } from './analyze/AnalyzeView';
import { ResultsView } from './results/ResultsView';
import { Icon, Menu, Modal, pickFiles } from './common';

export function App() {
  const tab = useApp((s) => s.ui.tab);
  const hasGels = useApp((s) => s.project.gels.length > 0);
  const [dragOver, setDragOver] = useState(false);
  useShortcuts();

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDragOver(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e)) { depth = Math.max(0, depth - 1); if (!depth) setDragOver(false); } };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const proj = files.find((f) => f.name.endsWith('.densi'));
      if (proj) openProjectFile(proj);
      else addImageFiles(files);
    };
    // 클립보드에 복사한 이미지(캡처·다른 프로그램에서 복사)나 탐색기에서 복사한 이미지 파일을 Ctrl+V로 추가
    const paste = (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      if (!cd) return;
      let files = Array.from(cd.files).filter((f) => f.type.startsWith('image/') || /\.(tiff?|png|jpe?g|bmp)$/i.test(f.name));
      if (!files.length) {
        files = Array.from(cd.items)
          .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
          .map((it) => it.getAsFile())
          .filter((f): f is File => f !== null);
      }
      if (!files.length) return; // 글자 붙여넣기는 건드리지 않음
      e.preventDefault();
      const named = nameClipboardFiles(files);
      addImageFiles(named);
    };
    window.addEventListener('paste', paste);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('paste', paste);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div className="app">
      <Header />
      <main className="main">
        {/* 표준곡선 화면은 당분간 숨긴다 (코드는 ui/calibration에 보관) */}
        {!hasGels && tab !== 'results' ? <EmptyState /> : tab === 'results' ? <ResultsView /> : <AnalyzeView />}
      </main>
      {dragOver && <div className="drop-overlay">놓으면 이미지를 프로젝트에 추가합니다</div>}
      <Toasts />
    </div>
  );
}

async function openProjectFile(file: File) {
  const app = useApp.getState();
  try {
    const p = await importProjectFile(file);
    app.loadProject(p);
    app.toast({ kind: 'success', text: `"${p.name}" 프로젝트를 열었습니다.` });
  } catch (e) {
    app.toast({ kind: 'error', text: `프로젝트 파일을 열 수 없습니다: ${e instanceof Error ? e.message : e}` }, 8000);
  }
}

function Header() {
  const project = useApp((s) => s.project);
  const ui = useApp((s) => s.ui);
  const past = useApp((s) => s.past.length);
  const future = useApp((s) => s.future.length);
  const saveState = useApp((s) => s.saveState);
  const { update, undo, redo, setUi, loadProject, toast } = useApp.getState();
  const [openList, setOpenList] = useState(false);
  const [help, setHelp] = useState(false);
  const bands = project.gels.reduce((s, g) => s + g.lanes.reduce((a, l) => a + l.bands.length, 0), 0);

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark"><svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="3" width="3" height="2" rx=".6" fill="#fff" /><rect x="5.5" y="3" width="3" height="2" rx=".6" fill="#fff" opacity=".7" /><rect x="10" y="3" width="3" height="2" rx=".6" fill="#fff" opacity=".4" /><rect x="1" y="9" width="12" height="1.4" rx=".6" fill="#fff" opacity=".9" /></svg></span>
        Densi-assist
      </div>
      <input className="project-name" value={project.name} onChange={(e) => update((d) => { d.name = e.target.value; }, 'project-name')} aria-label="프로젝트 이름" />
      <nav className="tabs">
        <button className={`tab ${ui.tab === 'analyze' ? 'active' : ''}`} onClick={() => setUi({ tab: 'analyze' })}><Icon name="lane" size={14} />분석<span className="count">{project.gels.length}</span></button>
        <button className={`tab ${ui.tab === 'results' ? 'active' : ''}`} onClick={() => setUi({ tab: 'results' })}><Icon name="table" size={14} />결과<span className="count">{bands}</span></button>
      </nav>
      <div className="spacer" />
      <span className={`save-state ${saveState === 'error' ? 'error' : ''}`}>
        {saveState === 'saved' ? '브라우저에 저장됨' : saveState === 'saving' ? '저장 중…' : saveState === 'dirty' ? '변경됨' : '저장 실패'}
      </span>
      <div className="btn-row" style={{ gap: 2 }}>
        <button className="btn ghost icon" disabled={!past} onClick={undo} title="실행 취소 (Ctrl+Z)"><Icon name="undo" /></button>
        <button className="btn ghost icon" disabled={!future} onClick={redo} title="다시 실행 (Ctrl+Shift+Z)"><Icon name="redo" /></button>
      </div>
      <Menu button={(_, t) => <button className="btn" onClick={t}><Icon name="folder" size={15} />프로젝트<Icon name="down" size={13} /></button>}>
        {(close) => (
          <>
            <button onClick={async () => { close(); addImageFiles(await pickFiles(IMAGE_ACCEPT, true)); }}><Icon name="plus" size={15} />이미지 추가…</button>
            <button onClick={() => { close(); pasteFromClipboard(); }}><Icon name="clipboard" size={15} />복사한 이미지 붙여넣기 (Ctrl+V)</button>
            <hr />
            <button onClick={() => { close(); loadProject(newProject()); }}><Icon name="plus" size={15} />새 프로젝트</button>
            <button onClick={() => { close(); setOpenList(true); }}><Icon name="folder" size={15} />저장된 프로젝트 열기…</button>
            <hr />
            <div className="menu-label">파일 (이미지 포함, 다른 PC로 옮기기)</div>
            <button onClick={async () => {
              close();
              const r = await exportProjectFile(useApp.getState().project);
              toast({ kind: r.missing.length ? 'warn' : 'success', text: r.missing.length ? `원본 이미지를 찾지 못한 겔: ${r.missing.join(', ')}` : '프로젝트 파일(.densi)을 내려받았습니다.' });
            }}><Icon name="download" size={15} />프로젝트 파일로 저장</button>
            <button onClick={async () => { close(); const [f] = await pickFiles('.densi,.zip', false); if (f) openProjectFile(f); }}><Icon name="upload" size={15} />프로젝트 파일 열기…</button>
            <hr />
            <button onClick={() => { close(); createDemoProject(); }}><Icon name="sparkle" size={15} />데모 프로젝트 만들기</button>
          </>
        )}
      </Menu>
      <button className="btn ghost icon" onClick={() => setHelp(true)} title="도움말·단축키 (?)"><Icon name="help" /></button>
      {openList && <ProjectList onClose={() => setOpenList(false)} />}
      {help && <HelpModal onClose={() => setHelp(false)} />}
    </header>
  );
}

function ProjectList({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<ProjectIndexEntry[] | null>(null);
  const current = useApp((s) => s.project.id);
  useEffect(() => { listProjects().then(setList); }, []);
  return (
    <Modal title="저장된 프로젝트" onClose={onClose}>
      <div className="hint">이 브라우저에 자동 저장된 프로젝트입니다. 다른 컴퓨터로 옮기려면 &quot;프로젝트 파일로 저장&quot;을 사용하세요.</div>
      {!list ? <div>불러오는 중…</div> : !list.length ? <div className="hint">저장된 프로젝트가 없습니다.</div> : (
        <table className="tbl">
          <thead><tr><th>이름</th><th className="num">겔</th><th>수정</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className={`click ${p.id === current ? 'sel' : ''}`} onClick={async () => {
                const proj = await loadStoredProject(p.id);
                if (proj) { useApp.getState().loadProject(proj); onClose(); }
              }}>
                <td><b>{p.name}</b>{p.id === current && <span className="badge accent" style={{ marginLeft: 6 }}>열려 있음</span>}</td>
                <td className="num">{p.gels}</td>
                <td>{new Date(p.updatedAt).toLocaleString()}</td>
                <td>
                  {p.id !== current && (
                    <button className="btn ghost sm icon" title="삭제" onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm(`"${p.name}" 프로젝트를 이 브라우저에서 삭제할까요? 되돌릴 수 없습니다.`)) return;
                      await deleteStoredProject(p.id);
                      setList(await listProjects());
                    }}><Icon name="trash" size={13} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const keys: [string, string][] = [
    ['V / L / B', '1. 선택 / 2. 레인 / 3. 밴드 도구'],
    ['← →', '이전 / 다음 레인'],
    ['Delete', '선택한 밴드(없으면 레인) 삭제'],
    ['F', '이미지를 화면에 맞춤'],
    ['Space + 드래그, 휠', '이동, 확대/축소'],
    ['Shift + 레인 드래그', '가로로만 이동'],
    ['Ctrl+Z / Ctrl+Shift+Z', '실행 취소 / 다시 실행'],
    ['1 / 2', '분석 / 결과 탭'],
    ['O', '원본 이미지 보기 켜고 끄기'],
  ];
  return (
    <Modal title="사용 방법" onClose={onClose} width={680}>
      <p style={{ margin: 0, color: 'var(--text-2)' }}>
        위쪽 도구는 작업 순서대로 <b>1. 선택 → 2. 레인 → 3. 밴드</b>입니다. 도구를 누르면 오른쪽 패널에서 그 단계에 필요한 항목만 펼쳐집니다.
      </p>
      <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        <li><b>이미지 올리기</b>: 원본 TIFF(16-bit 권장)를 여러 장 한 번에 끌어다 놓거나, 복사한 이미지를 <b>Ctrl+V</b>로 붙여넣습니다. (캡처 이미지는 8-bit라 정량 정확도가 원본보다 떨어질 수 있음)</li>
        <li><b>1. 선택</b> → ① 이미지: 밴드 색(어두운/밝은 밴드)과 화면 밝기를 확인합니다. 화면 밝기·감마는 기본적으로 측정값에 영향이 없습니다.</li>
        <li><b>2. 레인</b> → <b>레인 그리기</b> 또는 <b>레인 검출 (Auto)</b>. 그린 레인은 바로 끌어서 옮기고, 가장자리를 끌어 상하좌우 크기를 바꿉니다. ③ 레인에서 샘플 이름을 입력합니다(같은 이름은 겔을 넘어 묶입니다). ② 배경 제거는 얼룩이 심할 때만 씁니다.</li>
        <li><b>3. 밴드</b> → <b>밴드 그리기</b> 또는 <b>밴드 검출 (Auto)</b>. 이미지에서는 위아래로, 아래 그래프에서는 좌우로 드래그해 밴드를 만듭니다. 밴드를 끌면 이동하고, 양 끝 동그라미로 <b>기울기</b>를 맞춥니다.</li>
        <li><b>④ 베이스라인</b>: 그래프에서 밴드 밑 바닥선을 정하는 방법입니다. 보통 Rolling ball이면 충분합니다. 직접 정하려면 <b>수동</b>을 고르고(또는 그래프 위 &quot;수동으로 다듬기&quot;), 각 밴드 양 끝의 동그라미를 끌어 시작·끝 위치와 바닥 높이를 정합니다.</li>
        <li><b>⑤ 밴드 · 타깃</b>: 면적과 %를 확인하고 <b>표 복사</b>로 엑셀에 붙여넣습니다. 밴드를 고른 뒤 타깃을 누르면 같은 높이의 밴드에 한 번에 지정됩니다.</li>
        <li><b>결과</b>: 로딩 컨트롤과 기준 샘플을 고르면 정규화·상대값과 막대 그래프가 나옵니다. 엑셀로 내보내면 모든 설정도 함께 기록됩니다.</li>
      </ol>
      <table className="tbl">
        <tbody>{keys.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody>
      </table>
      <div className="note">모든 처리는 브라우저 안에서 이루어지며 이미지는 어떤 서버로도 전송되지 않습니다. 작업은 이 브라우저에 자동 저장됩니다.</div>
    </Modal>
  );
}

function EmptyState() {
  const [over, setOver] = useState(false);
  return (
    <div className="empty">
      <div className="empty-card">
        <div>
          <h1 style={{ margin: '0 0 6px', fontSize: 24, letterSpacing: '-.02em' }}>겔·블롯 밴드 정량</h1>
          <div style={{ color: 'var(--text-2)' }}>여러 장의 겔을 한 프로젝트에서 한 번에 분석하고, 결과를 겔을 넘어 비교합니다.</div>
        </div>
        <div className={`dropzone ${over ? 'over' : ''}`}
          onClick={async () => addImageFiles(await pickFiles(IMAGE_ACCEPT, true))}
          onDragEnter={() => setOver(true)} onDragLeave={() => setOver(false)} onDrop={() => setOver(false)}>
          <Icon name="upload" size={32} />
          <h2>이미지를 끌어다 놓거나, 클릭해 선택하거나, Ctrl+V로 붙여넣기</h2>
          <div className="hint">TIFF (8/16/32-bit, 멀티페이지), PNG (16-bit 포함), JPG · 여러 장 동시에 가능</div>
          <button className="btn primary" onClick={(e) => { e.stopPropagation(); pasteFromClipboard(); }}>
            <Icon name="clipboard" size={15} />복사한 이미지 붙여넣기
          </button>
          <div className="paste-guide" onClick={(e) => e.stopPropagation()}>
            <b>붙여넣기 사용법</b>
            <ol>
              <li>화면 캡처를 하거나 이미지를 복사합니다 (이미지 위에서 우클릭 → 이미지 복사, 또는 Ctrl+C).</li>
              <li>이 창의 아무 곳에서나 <b>Ctrl+V</b>(맥은 ⌘+V)를 누릅니다. 마우스를 어디에 두어도 됩니다.</li>
              <li>키보드를 쓰기 싫으면 위의 <b>복사한 이미지 붙여넣기</b> 버튼을 누릅니다. 브라우저가 클립보드 접근을 물으면 "허용"을 누르세요.</li>
            </ol>
          </div>
        </div>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={() => createDemoProject()}><Icon name="sparkle" size={15} />데모 프로젝트로 둘러보기</button>
          <button className="btn ghost" onClick={async () => { const [f] = await pickFiles('.densi,.zip', false); if (f) openProjectFile(f); }}><Icon name="upload" size={15} />프로젝트 파일 열기</button>
        </div>
        <div className="feature-row">
          <div className="feature"><b>베이스라인 선택</b>Rolling ball, Top-hat, Rubber band, SNIP, 이동 중앙값, 수동 점. 레인별로 달리 적용하고, 기울어진 밴드도 따라 잽니다.</div>
          <div className="feature"><b>여러 겔 동시 분석</b>샘플 이름과 타깃으로 겔을 넘어 묶고, 재프로빙한 로딩 컨트롤로도 정규화.</div>
          <div className="feature"><b>재현 가능한 결과</b>모든 설정이 프로젝트에 저장되고 엑셀 내보내기에 함께 기록됩니다.</div>
        </div>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="txt">{t.text}</span>
          {t.action && <button className="btn sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          <button className="btn ghost sm icon" onClick={() => dismiss(t.id)} aria-label="닫기"><Icon name="x" size={12} /></button>
        </div>
      ))}
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
      const s = useApp.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) s.redo(); else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); s.redo(); return; }
      if (typing || mod || e.altKey) return;
      const { ui } = s;
      if (e.key === '1') s.setUi({ tab: 'analyze' });
      else if (e.key === '2') s.setUi({ tab: 'results' });
      if (ui.tab !== 'analyze') return;
      const gel = s.project.gels.find((g) => g.id === ui.activeGelId);
      if (e.key === 'v' || e.key === 'Escape') s.setTool('select');
      else if (e.key === 'l') s.setTool('lane');
      else if (e.key === 'b') s.setTool('band');
      else if (e.key === 'f') window.dispatchEvent(new Event('densi:fit'));
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && gel?.lanes.length) {
        e.preventDefault();
        const i = gel.lanes.findIndex((l) => l.id === ui.selectedLaneId);
        const n = gel.lanes.length;
        const next = i < 0 ? 0 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
        s.setUi({ selectedLaneId: gel.lanes[next].id, selectedBandId: null });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && gel && ui.selectedLaneId) {
        e.preventDefault();
        if (ui.selectedBandId) {
          s.update((d) => { const l = findGel(d, gel.id)?.lanes.find((x) => x.id === ui.selectedLaneId); if (l) l.bands = l.bands.filter((b) => b.id !== ui.selectedBandId); });
          s.setUi({ selectedBandId: null });
        } else {
          s.update((d) => { const g = findGel(d, gel.id); if (g) g.lanes = g.lanes.filter((l) => l.id !== ui.selectedLaneId); });
          s.setUi({ selectedLaneId: null });
          s.toast({ kind: 'info', text: '레인을 삭제했습니다.', action: { label: '되돌리기', run: () => useApp.getState().undo() } });
        }
      } else if (e.key === '?') {
        // 도움말은 헤더 버튼으로
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
