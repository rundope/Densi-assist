import type { Tool } from '../../state/store';
import { useActiveGel, useApp } from '../../state/store';
import { Icon } from '../common';
import { SPOONBILL_LOGO } from '../spoonbill';

interface Step { key: Tool | 'results'; title: string; sub: string; next: string }

/** 작업 순서. 위에서부터 차례로 누르면 되도록, 하는 일을 이름과 한 줄 설명으로 보여준다 */
const STEPS: Step[] = [
  { key: 'select', title: '이미지 준비', sub: '밴드 색·보정 확인', next: '레인 잡기' },
  { key: 'lane', title: '레인', sub: '세로 줄 잡기', next: '밴드 잡기' },
  { key: 'band', title: '밴드', sub: '띠 잡기', next: '결과 보기' },
  { key: 'results', title: '결과', sub: '표·엑셀 내보내기', next: '' },
];

interface Guide { now: string; ready: boolean; tip?: string }

/** 지금 단계에서 할 일. 할 일을 끝냈으면(ready) 다음 버튼으로 넘어가라고 안내한다 */
const GRAPH_TIP = '아래 그래프: "선택 레인"은 한 레인씩 자세히, "전체 레인 비교"는 모든 레인과 밴드를 한눈에 보여 줘요.';

function guideFor(step: number, lanes: number, bands: number): Guide {
  if (step === 0) return { now: '왼쪽에서 밴드 색과 보정을 확인하세요. 오른쪽 "보정 후" 이미지가 바로 바뀝니다.', ready: true };
  if (step === 1) {
    return lanes > 0
      ? { now: `레인 ${lanes}개를 잡았어요. 빠진 레인이 있으면 클릭하거나 끌어서 추가하세요.`, ready: true, tip: GRAPH_TIP }
      : { now: '이미지 위를 클릭하거나 끌어서 레인을 그리세요. "레인 검출 (Auto)"로 자동으로 잡을 수도 있어요 (놓치는 레인이 있을 수 있음).', ready: false };
  }
  return bands > 0
    ? { now: `밴드 ${bands}개를 잡았어요. 아래 그래프에서 밴드 범위를 확인하세요.`, ready: true, tip: GRAPH_TIP }
    : { now: '"밴드 검출 (Auto)"을 누르세요. 직접 그리려면 레인 안을 위아래로 끌거나, 아래 그래프를 좌우로 끄세요.', ready: false };
}

export function Stepper() {
  const tab = useApp((s) => s.ui.tab);
  const tool = useApp((s) => s.ui.tool);
  const setTool = useApp((s) => s.setTool);
  const setUi = useApp((s) => s.setUi);
  const gel = useActiveGel();
  const cur = tab === 'results' ? 3 : tool === 'lane' ? 1 : tool === 'band' || tool === 'baseline' ? 2 : 0;
  const lanes = gel?.lanes.length ?? 0;
  const bands = gel?.lanes.reduce((s, l) => s + l.bands.length, 0) ?? 0;
  const guide = cur < 3 ? guideFor(cur, lanes, bands) : null;

  const go = (i: number) => {
    if (i === 3) { setUi({ tab: 'results' }); return; }
    setUi({ tab: 'analyze' });
    setTool(STEPS[i].key as Tool);
  };

  return (
    <nav className="stepper" aria-label="작업 순서">
      <ol className="steps">
        {STEPS.map((s, i) => {
          const state = i < cur ? 'done' : i === cur ? 'current' : 'todo';
          return (
            <li key={s.key} className="step-item">
              {i > 0 && <span className={`step-line ${i <= cur ? 'on' : ''}`} aria-hidden />}
              <button className={`step ${state}`} onClick={() => go(i)} aria-current={i === cur ? 'step' : undefined}
                title={`${i + 1}단계: ${s.title} — ${s.sub}`}>
                <span className="step-num">{state === 'done' ? <Icon name="check" size={15} /> : i + 1}</span>
                <span className="step-text"><b>{s.title}</b><small>{s.sub}</small></span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="step-guide">
        {guide && (
          <div className="guide">
            <img className="mascot" src={SPOONBILL_LOGO} alt="" aria-hidden />
            <div key={`${cur}-${guide.now}`} className={`bubble ${guide.ready ? 'ready' : ''}`} role="status">
              <span className="bubble-now"><b>지금 할 일</b> {guide.now}</span>
              {guide.tip && <span className="bubble-tip">💡 {guide.tip}</span>}
              {guide.ready && <span className="bubble-next">다 됐으면 → <b>다음: {STEPS[cur].next}</b>를 누르세요</span>}
            </div>
          </div>
        )}
        <span className="grow" />
        {cur > 0 && cur < 3 && <button className="btn" onClick={() => go(cur - 1)}>← 이전</button>}
        {cur < 3 && (
          <button className={`btn primary next ${guide?.ready ? 'pulse' : ''}`} onClick={() => go(cur + 1)}>다음: {STEPS[cur].next} →</button>
        )}
      </div>
    </nav>
  );
}
