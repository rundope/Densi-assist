import type { Tool } from '../../state/store';
import { useApp } from '../../state/store';
import { Icon } from '../common';

interface Step { key: Tool | 'results'; title: string; sub: string; todo: string; next: string }

/** 작업 순서. 위에서부터 차례로 누르면 되도록, 하는 일을 이름과 한 줄 설명으로 보여준다 */
const STEPS: Step[] = [
  { key: 'select', title: '이미지 준비', sub: '밴드 색·보정 확인', todo: '왼쪽에서 밴드 색과 보정을 확인하세요. 오른쪽 "보정 후" 이미지가 바로 바뀝니다.', next: '레인 잡기' },
  { key: 'lane', title: '레인', sub: '세로 줄 잡기', todo: '"레인 검출 (Auto)"을 누르거나, 이미지 위에서 끌어서 레인을 그리세요.', next: '밴드 잡기' },
  { key: 'band', title: '밴드', sub: '띠 잡기', todo: '"밴드 검출 (Auto)"을 누르거나, 레인 안에서 위아래로 끌어 밴드를 그리세요.', next: '결과 보기' },
  { key: 'results', title: '결과', sub: '표·엑셀 내보내기', todo: '', next: '' },
];

export function Stepper() {
  const tab = useApp((s) => s.ui.tab);
  const tool = useApp((s) => s.ui.tool);
  const setTool = useApp((s) => s.setTool);
  const setUi = useApp((s) => s.setUi);
  const cur = tab === 'results' ? 3 : tool === 'lane' ? 1 : tool === 'band' || tool === 'baseline' ? 2 : 0;

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
        {STEPS[cur].todo && <span className="todo"><b>지금 할 일</b> {STEPS[cur].todo}</span>}
        <span className="grow" />
        {cur > 0 && cur < 3 && <button className="btn" onClick={() => go(cur - 1)}>← 이전</button>}
        {cur < 3 && <button className="btn primary next" onClick={() => go(cur + 1)}>다음: {STEPS[cur].next} →</button>}
      </div>
    </nav>
  );
}
