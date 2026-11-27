import { useEffect, useState, type ReactNode } from 'react';
import { BASELINES, BASELINE_MAP, GROUP_LABELS, VISIBLE_BASELINES, cloneSpec, makeSpec, type BaselineGroup } from '../../core/baseline/registry';
import type { Background2DMethod, BaselineMethod, BaselineSpec, Gel, Polarity, Project } from '../../core/types';
import { analyzeLane, type ProcessedGel } from '../../engine/engine';
import { newBand, newTarget } from '../../state/project';
import { findGel, useApp } from '../../state/store';
import { copyLanesToGel, copySettingsToAll } from '../../state/actions';
import { copyText, Icon, Menu, NumberSlider, Seg, Help } from '../common';
import { fmt, fmtPct } from '../render';
import { BAND_DEFAULT_COLOR } from '../colors';

/** 왼쪽 패널: 지금 단계에 필요한 내용만 보여준다 (① 이미지 준비 / ② 레인 / ③ 밴드) */
export function Inspector({ gel, data }: { gel: Gel; data: ProcessedGel | null }) {
  const project = useApp((s) => s.project);
  const tool = useApp((s) => s.ui.tool);
  return (
    <aside className="inspector">
      {tool === 'select' && <PrepareSettings gel={gel} />}
      {tool === 'lane' && (
        <Block title="레인" sub="레인 폭과 샘플 이름">
          <LanesSection gel={gel} project={project} />
        </Block>
      )}
      {(tool === 'band' || tool === 'baseline') && (
        <>
          <Block title="베이스라인" sub="밴드 밑 바닥선을 정하는 방법">
            <BaselineSection gel={gel} project={project} />
          </Block>
          <Block title="밴드 · 타깃" sub="기울기, 면적, 표 복사">
            <BandsSection gel={gel} data={data} project={project} />
          </Block>
        </>
      )}
    </aside>
  );
}

/** 왼쪽 패널의 한 덩어리. 접거나 펼치지 않고 제목만 크게 보여준다 */
function Block({ title, sub, help, children }: { title: string; sub?: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="block">
      <header className="block-head">
        <h3>{title}{help && <Help>{help}</Help>}</h3>
        {sub && <p>{sub}</p>}
      </header>
      <div className="block-body">{children}</div>
    </section>
  );
}

function useGelUpdate(gelId: string) {
  const update = useApp((s) => s.update);
  return (fn: (g: Gel, d: Project) => void, key?: string) => update((d) => { const g = findGel(d, gelId); if (g) fn(g, d); }, key);
}

// ---------------- ① 이미지 준비 ----------------

const POLARITY_CHOICES: { value: Polarity; title: string; sub: string }[] = [
  { value: 'dark-bands', title: '어두운 밴드', sub: '밝은 배경에 어두운 띠 (쿠마시·은염색·대부분의 화학발광)' },
  { value: 'light-bands', title: '밝은 밴드', sub: '어두운 배경에 밝은 띠 (형광)' },
  { value: 'dark-bands-od', title: '어두운 밴드 (OD 변환)', sub: '필름·투과광 스캔에서 흡광도로 계산' },
];

/** ① 이미지 준비 단계의 설정: 밴드 색, 이미지 보정, 배경 제거를 한 화면에 모아서 보여준다 */
function PrepareSettings({ gel }: { gel: Gel }) {
  const up = useGelUpdate(gel.id);
  const p = gel.preprocess;
  const d = gel.display;
  return (
    <>
      <Block title="밴드 색" sub="이미지에서 밴드가 어떻게 보이나요?"
        help="측정에서 어느 쪽을 신호로 볼지 정합니다. 화면의 이미지는 바뀌지 않고, 아래 그래프와 측정값에 반영됩니다. 이미지에서 밴드가 어두우면 '어두운 밴드'를 고르세요.">
        <div className="choice-list" role="radiogroup" aria-label="밴드 색">
          {POLARITY_CHOICES.map((c) => (
            <button key={c.value} role="radio" aria-checked={p.polarity === c.value} className={`choice ${p.polarity === c.value ? 'on' : ''}`}
              onClick={() => up((g) => { g.preprocess.polarity = c.value; })}>
              <span className="radio" aria-hidden />
              <span className="choice-text"><b>{c.title}</b><small>{c.sub}</small></span>
            </button>
          ))}
        </div>
      </Block>

      <Block title="이미지 보정" sub="오른쪽 &quot;보정 후&quot; 이미지에 바로 반영됩니다">
        {gel.isRGB && (
          <div className="field">
            <div className="label"><span>컬러 → 흑백<Help>컬러 이미지를 흑백으로 바꾸는 방법입니다. 이미지가 이미 흑백(색 없음)이면 무엇을 골라도 결과가 같습니다.</Help></span></div>
            <Seg value={p.grayMode} onChange={(v) => up((g) => { g.preprocess.grayMode = v as Gel['preprocess']['grayMode']; })}
              options={[{ value: 'luminance', label: '밝기', title: '밝기 (기본)' }, { value: 'mean', label: '평균', title: 'RGB 평균' },
                { value: 'red', label: '빨강' }, { value: 'green', label: '초록' }, { value: 'blue', label: '파랑' }]} />
          </div>
        )}
        <NumberSlider label="기울기 보정" help="사진이 살짝 기울어 찍혔을 때 바로잡습니다. 측정에 반영됩니다." unit="도" min={-10} max={10} step={0.1} value={p.rotateFine}
          onChange={(v) => up((g) => { g.preprocess.rotateFine = v; }, 'rotateFine')} />
        <NumberSlider label="감마 (밝기 조절)" min={0.1} max={4} step={0.05} value={d.gamma}
          help="화면 밝기 곡선을 바꿉니다. 1이 원래 밝기이고, 1보다 크면 어두운 곳이 밝아집니다. 측정에도 적용하면 밴드 사이 비율이 실제와 달라질 수 있어 감마가 1이 아닐 때 결과에 표시가 남습니다."
          extra={<label className="label-extra" title="켜면 감마를 측정에도 사용합니다"><input type="checkbox" checked={d.applyToData} onChange={(e) => up((g) => { g.display.applyToData = e.target.checked; })} />측정에도 적용</label>}
          onChange={(v) => up((g) => { g.display.gamma = v; }, 'gamma')} />
        <NumberSlider label="부드럽게 (노이즈 제거)" unit="px" min={0} max={3} step={0.1} value={d.smooth ?? 0}
          help="점무늬·잡음을 줄입니다(가우시안 블러). 측정에도 적용하면 부드러워진 이미지에서 밴드를 읽습니다. 값이 클수록 가는 밴드가 퍼질 수 있으니 필요한 만큼만 쓰세요."
          extra={<label className="label-extra" title="켜면 부드럽게 한 이미지에서 측정합니다"><input type="checkbox" checked={d.smoothApply ?? true} onChange={(e) => up((g) => { g.display.smoothApply = e.target.checked; })} />측정에도 적용</label>}
          onChange={(v) => up((g) => { g.display.smooth = v; }, 'smooth')} />
      </Block>

      <Block title="배경 제거" sub="이미지 전체의 얼룩·그늘 (선택)"
        help="이미지 전체의 얼룩·그늘을 지웁니다. 보통은 꺼 두고 ③ 단계의 베이스라인만 써도 충분합니다. 롤링볼·파라볼로이드는 배경을 0으로 맞추고, 상수 빼기는 배경 값 하나를 빼며, 얼룩만 고르게는 전체 밝기를 유지한 채 얼룩만 고릅니다. 강도로 얼마나 뺄지 조절할 수 있습니다.">
        <BackgroundSection gel={gel} />
      </Block>
    </>
  );
}

const BG_METHODS: { value: Background2DMethod; label: string; sub: string }[] = [
  { value: 'none', label: '사용 안 함', sub: '배경을 건드리지 않습니다.' },
  { value: 'rolling-ball', label: '롤링볼', sub: '배경 전체를 0으로 맞춥니다 (ImageJ 방식).' },
  { value: 'paraboloid', label: '파라볼로이드', sub: '완만하게 휘는 배경에 알맞습니다 (ImageJ 방식).' },
  { value: 'constant', label: '상수 빼기', sub: '이미지의 배경 값 하나를 통째로 뺍니다.' },
  { value: 'flatten', label: '얼룩만 고르게', sub: '밝기 얼룩만 고르게 하고 전체 밝기는 유지합니다.' },
];

function BackgroundSection({ gel }: { gel: Gel }) {
  const up = useGelUpdate(gel.id);
  const b = gel.background;
  const cur = BG_METHODS.find((m) => m.value === b.method) ?? BG_METHODS[0];
  return (
    <>
      <div className="chips" role="radiogroup" aria-label="배경 제거 방법">
        {BG_METHODS.map((m) => (
          <button key={m.value} role="radio" aria-checked={b.method === m.value} className={`chip ${b.method === m.value ? 'on' : ''}`}
            onClick={() => up((g) => { g.background.method = m.value; })}>{m.label}</button>
        ))}
      </div>
      <div className="hint" style={{ margin: '2px 0 12px' }}>{cur.sub}</div>
      {b.method !== 'none' && (
        <>
          {b.method === 'constant' ? (
            <NumberSlider label="기준 위치" unit="% (어두운 쪽부터)" min={0} max={50} step={1} value={b.constantPct ?? 10}
              help="신호가 낮은 쪽(배경에 해당) 몇 %의 값을 배경으로 볼지 정합니다. 밴드가 이미지를 많이 차지하면 낮게, 배경이 넓으면 높게 잡으세요."
              onChange={(v) => up((g) => { g.background.constantPct = Math.round(v); }, 'bgConst')} />
          ) : (
            <NumberSlider label="반경" unit="px" min={2} max={400} step={1} value={b.radius}
              help="가장 두꺼운 밴드보다 크게 잡으세요."
              onChange={(v) => up((g) => { g.background.radius = Math.round(v); }, 'bgRadius')} />
          )}
          <NumberSlider label="강도" unit="%" min={0} max={100} step={5} value={b.strength ?? 100}
            help="추정한 배경을 얼마나 뺄지 정합니다. 100%는 모두 빼고, 낮추면 일부만 빼서 약하게 제거합니다."
            onChange={(v) => up((g) => { g.background.strength = Math.round(v); }, 'bgStrength')} />
          {b.method !== 'constant' && (
            <label className="check"><input type="checkbox" checked={b.presmooth} onChange={(e) => up((g) => { g.background.presmooth = e.target.checked; })} />잡티 무시 (작은 먼지·노이즈를 먼저 고름)</label>
          )}
        </>
      )}
    </>
  );
}

// ---------------- ③ 레인 ----------------

function LanesSection({ gel, project }: { gel: Gel; project: Project }) {
  const up = useGelUpdate(gel.id);
  const ui = useApp((s) => s.ui);
  const setUi = useApp((s) => s.setUi);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const ref = gel.lanes.find((l) => l.id === ui.selectedLaneId) ?? gel.lanes[0];
  const others = project.gels.filter((g) => g.id !== gel.id);

  if (!gel.lanes.length) {
    return <div className="hint">위쪽의 <b>레인 검출 (Auto)</b>을 누르거나, 이미지 위에서 끌어서 레인을 그리세요.</div>;
  }
  return (
    <>
      {ref && (
        <>
          <NumberSlider label="레인 폭" unit="px" min={4} max={Math.max(40, Math.round(gel.sourceWidth / 3))} step={1} value={Math.round(ref.width)}
            onChange={(v) => up((g) => { for (const l of g.lanes) if (ui.syncLaneSize || l.id === ref.id) l.width = v; }, 'laneWidth')} />
          <label className="check" style={{ marginBottom: 10 }}><input type="checkbox" checked={ui.syncLaneSize} onChange={(e) => setUi({ syncLaneSize: e.target.checked })} />모든 레인 크기를 같게</label>
        </>
      )}
      <NumberSlider label="양옆 가장자리 제외" unit="% 폭" min={0} max={40} step={1} value={gel.profile.edgeTrimPct}
        help="밴드 양끝의 번짐을 빼고 가운데만 잽니다 (점선 안쪽)."
        onChange={(v) => up((g) => { g.profile.edgeTrimPct = v; }, 'trim')} />
      <div className="field">
        <div className="label"><span>레인 폭 방향 값 합치기<Help>{gel.profile.aggregate === 'mean'
          ? '평균: 가로 한 줄의 픽셀 값을 평균합니다. 일반적으로 이걸 씁니다.'
          : '중앙값: 가로 한 줄에서 가운데 값을 씁니다. 먼지·반점처럼 튀는 픽셀에 덜 흔들립니다.'}</Help></span></div>
        <Seg value={gel.profile.aggregate} onChange={(v) => up((g) => { g.profile.aggregate = v; })}
          options={[{ value: 'mean', label: '평균' }, { value: 'median', label: '중앙값' }]} />
      </div>

      <div className="subhead" style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>샘플 이름</span>
        <button className="btn ghost sm" onClick={() => setPasteOpen((o) => !o)} title="엑셀에서 한 열을 복사해 붙여넣기">엑셀에서 붙여넣기</button>
      </div>
      {pasteOpen && (
        <div className="field">
          <textarea rows={4} placeholder={'샘플 이름 열을 복사해 붙여넣으세요.\n왼쪽 레인부터 차례로 채웁니다.'} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
          <div className="btn-row">
            <button className="btn sm primary" onClick={() => {
              const names = pasteText.split(/\r?\n|\t/).map((s) => s.trim()).filter(Boolean);
              up((g) => { g.lanes.forEach((l, i) => { if (names[i] != null) l.sample = names[i]; }); });
              setPasteOpen(false); setPasteText('');
            }}>적용</button>
          </div>
        </div>
      )}
      <table className="tbl">
        <thead><tr><th>#</th><th>샘플</th><th title="분석에서 제외">제외</th><th /></tr></thead>
        <tbody>
          {gel.lanes.map((l, i) => (
            <tr key={l.id} className={l.id === ui.selectedLaneId ? 'sel' : ''} onClick={() => setUi({ selectedLaneId: l.id, selectedBandId: null })}>
              <td className="num">{i + 1}</td>
              <td><input type="text" value={l.sample} onChange={(e) => up((g) => { const x = g.lanes.find((q) => q.id === l.id); if (x) x.sample = e.target.value; }, `sample-${l.id}`)} /></td>
              <td><input type="checkbox" checked={l.excluded} onChange={(e) => up((g) => { const x = g.lanes.find((q) => q.id === l.id); if (x) x.excluded = e.target.checked; })} /></td>
              <td><button className="btn ghost sm icon" title="레인 삭제" onClick={(e) => { e.stopPropagation(); up((g) => { g.lanes = g.lanes.filter((q) => q.id !== l.id); }); }}><Icon name="trash" size={13} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint" style={{ marginTop: 6 }}>같은 샘플 이름은 다른 겔에 있어도 결과에서 하나로 묶입니다.</div>

      {others.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Menu align="left" button={(_, t) => <button className="btn sm" onClick={t}><Icon name="copy" size={14} />레인 배치를 다른 겔로 복사</button>}>
            {(close) => others.map((g) => (
              <button key={g.id} onClick={() => { copyLanesToGel(gel.id, g.id); close(); }}>{g.name} <span className="hint">({g.lanes.length}개 → 덮어쓰기)</span></button>
            ))}
          </Menu>
        </div>
      )}
    </>
  );
}

// ---------------- ④ 베이스라인 ----------------

function BaselineSection({ gel, project }: { gel: Gel; project: Project }) {
  const up = useGelUpdate(gel.id);
  const update = useApp((s) => s.update);
  const toast = useApp((s) => s.toast);
  const ui = useApp((s) => s.ui);
  const lane = gel.lanes.find((l) => l.id === ui.selectedLaneId) ?? null;
  const [scope, setScope] = useState<'gel' | 'lane'>(lane?.baseline ? 'lane' : 'gel');
  useEffect(() => { setScope(lane?.baseline ? 'lane' : 'gel'); }, [lane?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const spec: BaselineSpec = scope === 'lane' && lane ? lane.baseline ?? gel.baseline : gel.baseline;
  const def = BASELINE_MAP[spec.method];
  const overrides = gel.lanes.filter((l) => l.baseline).length;
  // % 레인 길이를 px로 바꿔 보여주기 위한 기준 길이
  const laneLen = Math.round(((lane ?? gel.lanes[0])?.bottom ?? 0) - ((lane ?? gel.lanes[0])?.top ?? 0));

  const setSpec = (fn: (s: BaselineSpec) => BaselineSpec, key?: string) => {
    up((g) => {
      if (scope === 'lane' && lane) {
        const l = g.lanes.find((x) => x.id === lane.id);
        if (l) l.baseline = fn(cloneSpec(l.baseline ?? g.baseline));
      } else {
        g.baseline = fn(cloneSpec(g.baseline));
      }
    }, key);
  };

  const visible = VISIBLE_BASELINES.includes(spec.method) ? VISIBLE_BASELINES : [...VISIBLE_BASELINES, spec.method];
  const groups = (Object.keys(GROUP_LABELS) as BaselineGroup[]).filter((g) => BASELINES.some((b) => b.group === g && visible.includes(b.method)));
  return (
    <>
      <div className="field">
        <div className="label"><span>방법<Help>아래 그래프(레인 프로파일)에서 밴드 밑의 <b>바닥선</b>(주황 점선)을 정합니다. 바닥선 위 넓이가 밴드 값이 됩니다. ② 배경 제거는 이미지 전체를, 베이스라인은 레인마다 처리합니다.{spec.method === 'manual' && ' 수동: 그래프에서 각 밴드 양 끝의 동그라미를 끌어 시작·끝 위치와 바닥 높이를 정하고, 오른쪽 클릭하면 그 점은 자동(골짜기)으로 돌아갑니다.'}</Help></span></div>
        <select value={spec.method} onChange={(e) => {
          const m = e.target.value as BaselineMethod;
          setSpec((s) => makeSpec(m, s));
        }}>
          {groups.map((grp) => (
            <optgroup key={grp} label={GROUP_LABELS[grp]}>
              {BASELINES.filter((b) => b.group === grp && visible.includes(b.method)).map((b) => <option key={b.method} value={b.method}>{b.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="method-card">
        <div>{def.summary}</div>
        <div className="when"><b>이럴 때:</b> {def.when}</div>
        {def.caution && <div className="caution"><b>주의:</b> {def.caution}</div>}
      </div>

      {def.params.map((pd) => {
        const v = spec.params[pd.key] ?? pd.default;
        if (pd.options) {
          return (
            <div className="field" key={pd.key}>
              <div className="label"><span>{pd.label}{pd.hint && <Help>{pd.hint}</Help>}</span></div>
              <select value={v} onChange={(e) => {
                const nv = Number(e.target.value);
                setSpec((s) => ({ ...s, params: { ...s.params, [pd.key]: nv } }));
              }}>
                {pd.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          );
        }
        const isPct = pd.unit?.includes('레인 길이');
        const unit = isPct && laneLen > 0 ? `% 레인 길이 ≈ ${Math.round((v / 100) * laneLen)} px` : pd.unit;
        return (
          <NumberSlider key={pd.key} label={pd.label} unit={unit} min={pd.min} max={pd.max} step={pd.step} value={v} help={pd.hint}
            onChange={(nv) => setSpec((s) => ({ ...s, params: { ...s.params, [pd.key]: nv } }), `bl-${pd.key}`)} />
        );
      })}

      <div className="field" style={{ marginTop: 10 }}>
        <div className="label"><span>적용할 곳</span></div>
        <Seg value={scope} onChange={(v) => {
          setScope(v);
          if (v === 'lane' && lane && !lane.baseline) up((g) => { const l = g.lanes.find((x) => x.id === lane.id); if (l) l.baseline = cloneSpec(g.baseline); });
        }} options={[
          { value: 'gel', label: '이 겔 전체' },
          { value: 'lane', label: lane ? `선택한 레인만 (${gel.lanes.indexOf(lane) + 1})` : '선택한 레인만' },
        ]} />
        {scope === 'gel' && overrides > 0 && (
          <div className="hint">레인 {overrides}개는 따로 설정되어 있습니다. <a href="#" onClick={(e) => { e.preventDefault(); up((g) => { for (const l of g.lanes) l.baseline = null; }); }}>모두 겔 설정으로</a></div>
        )}
      </div>
      <div className="btn-row">
        <button className="btn sm" onClick={() => {
          const s = cloneSpec(spec);
          update((d) => { for (const g of d.gels) { g.baseline = cloneSpec(s); for (const l of g.lanes) l.baseline = null; } });
          toast({ kind: 'success', text: `모든 겔에 "${def.label}"을(를) 적용했습니다.`, action: { label: '되돌리기', run: () => useApp.getState().undo() } });
        }}>모든 겔에 같은 설정</button>
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <div className="label"><span>바닥선이 그래프보다 높은 곳</span></div>
        <Seg value={project.settings.negative} onChange={(v) => update((d) => { d.settings.negative = v; })}
          options={[{ value: 'clip', label: '0으로 계산 (권장)' }, { value: 'allow', label: '빼서 계산' }]} />
      </div>
    </>
  );
}

// ---------------- ⑤ 밴드 · 타깃 ----------------

function BandsSection({ gel, data, project }: { gel: Gel; data: ProcessedGel | null; project: Project }) {
  const up = useGelUpdate(gel.id);
  const update = useApp((s) => s.update);
  const ui = useApp((s) => s.ui);
  const setUi = useApp((s) => s.setUi);
  const toast = useApp((s) => s.toast);
  const lane = gel.lanes.find((l) => l.id === ui.selectedLaneId) ?? null;
  const an = lane && data ? analyzeLane(gel, lane, data, project.settings.negative) : null;
  const selBand = lane?.bands.find((b) => b.id === ui.selectedBandId) ?? null;
  const [renaming, setRenaming] = useState<string | null>(null);
  const det = gel.detection;

  /** 선택한 밴드와 같은 높이(레인 길이의 4% 이내)의 밴드에 모두 타깃을 지정 */
  const assignTarget = (targetId: string | null) => {
    if (!lane || !selBand) {
      toast({ kind: 'info', text: '먼저 이미지나 표에서 밴드를 하나 고르세요.' });
      return;
    }
    const rf = (selBand.start + selBand.end) / 2 / (lane.bottom - lane.top);
    let count = 0;
    up((g) => {
      for (const l of g.lanes) {
        const len = l.bottom - l.top;
        let best: { d: number; id: string } | null = null;
        for (const b of l.bands) {
          const dd = Math.abs((b.start + b.end) / 2 / len - rf);
          if (b.id === selBand.id) { best = { d: -1, id: b.id }; break; }
          if (dd < 0.04 && (!best || dd < best.d)) best = { d: dd, id: b.id };
        }
        const b = best && l.bands.find((q) => q.id === best!.id);
        if (b) { b.targetId = targetId; count++; }
      }
    });
    const name = project.targets.find((t) => t.id === targetId)?.name ?? '없음';
    toast({ kind: 'success', text: `같은 높이의 밴드 ${count}개를 "${name}"(으)로 지정했습니다.` });
  };

  const copyTable = async (all: boolean) => {
    if (!data) return;
    const header = ['레인', '샘플', '밴드', '타깃', '기울기(px)', '면적', '% 레인', 'Volume'];
    const lines = [header.join('\t')];
    const lanes = all ? gel.lanes : lane ? [lane] : [];
    for (const l of lanes) {
      const a = analyzeLane(gel, l, data, project.settings.negative);
      l.bands.forEach((b, i) => {
        const m = a.measures[i];
        lines.push([
          gel.lanes.indexOf(l) + 1, l.sample, i + 1, project.targets.find((t) => t.id === b.targetId)?.name ?? '',
          b.tilt ?? 0, round(m.area), a.totalArea ? round((m.area / a.totalArea) * 100) : 0, round(m.volume),
        ].join('\t'));
      });
    }
    const ok = await copyText(lines.join('\n'));
    toast(ok
      ? { kind: 'success', text: `${all ? '이 이미지 전체' : '이 레인'} 밴드 ${lines.length - 1}개를 복사했습니다. 엑셀에 붙여넣으세요.` }
      : { kind: 'error', text: '브라우저가 복사를 막았습니다. 결과 탭의 엑셀 내보내기를 이용하세요.' });
  };

  const copyBandsToAll = () => {
    if (!lane) return;
    up((g) => {
      for (const l of g.lanes) {
        if (l.id === lane.id) continue;
        const scale = (l.bottom - l.top) / (lane.bottom - lane.top);
        l.bands = lane.bands.map((b) => newBand(Math.round(b.start * scale), Math.round(b.end * scale), { targetId: b.targetId, tilt: b.tilt }));
      }
    });
    toast({ kind: 'success', text: '이 레인의 밴드 구간을 모든 레인에 복사했습니다.', action: { label: '되돌리기', run: () => useApp.getState().undo() } });
  };

  return (
    <>
      {lane && an ? (
        <>
          <div className="subhead" style={{ display: 'flex', alignItems: 'center', marginTop: 0 }}>
            <span style={{ flex: 1 }}>레인 {gel.lanes.indexOf(lane) + 1} · {lane.sample || '샘플 이름 없음'}</span>
          </div>
          {lane.bands.length ? (
            <table className="tbl band-table">
              <thead><tr><th>#</th><th className="num" title="밴드가 비스듬한 정도 (왼쪽 끝과 오른쪽 끝의 높이 차, px)">기울기</th><th className="num">면적</th><th className="num">% 레인</th></tr></thead>
              <tbody>
                {lane.bands.map((b, i) => {
                  const m = an.measures[i];
                  const color = project.targets.find((t) => t.id === b.targetId)?.color ?? BAND_DEFAULT_COLOR;
                  return (
                    <tr key={b.id} className={`click ${b.id === ui.selectedBandId ? 'sel' : ''}`} onClick={() => setUi({ selectedBandId: b.id })}>
                      <td className="num"><span className="dot" style={{ background: color, marginRight: 5 }} />{i + 1}</td>
                      <td className="num" style={{ width: 70 }}>
                        <input type="number" step={0.5} value={b.tilt ?? 0} style={{ textAlign: 'right' }}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            up((g) => { const bb = g.lanes.find((l) => l.id === lane.id)?.bands.find((q) => q.id === b.id); if (bb) bb.tilt = v; }, `tilt-${b.id}`);
                          }} />
                      </td>
                      <td className="num big" title={`Volume ${fmt(m.volume)}`}>
                        {fmt(m.area)}
                        {m.saturatedPixels > 0 && <span className="badge warn" style={{ marginLeft: 4 }} title={`포화 픽셀 ${m.saturatedPixels}`}>포화</span>}
                      </td>
                      <td className="num big">{fmtPct(an.totalArea ? (m.area / an.totalArea) * 100 : 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="hint">밴드가 없습니다. 위쪽의 <b>밴드 검출 (Auto)</b>을 누르거나, 레인 안에서 위아래로 끌어 밴드를 그리세요.</div>
          )}
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn sm primary" disabled={!lane.bands.length} onClick={() => copyTable(false)} title="이 표를 엑셀에 붙여넣을 수 있게 복사"><Icon name="copy" size={14} />표 복사</button>
            <button className="btn sm" onClick={() => copyTable(true)} title="이 겔의 모든 레인 밴드를 한 번에 복사"><Icon name="table" size={14} />겔 전체 복사</button>
            {lane.bands.length > 0 && <button className="btn ghost sm" onClick={copyBandsToAll} title="같은 구간을 다른 모든 레인에 복사">구간 → 모든 레인</button>}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>밴드 사용법<Help>밴드를 고르면 이미지에서 양 끝 동그라미로 기울기를, 테두리로 위아래 범위를 바꿀 수 있습니다. 밴드 삭제는 <kbd>Delete</kbd>.</Help></div>
        </>
      ) : (
        <div className="hint">레인을 고르면 그 레인의 밴드가 표시됩니다.</div>
      )}

      <div className="subhead">타깃 (단백질 이름)</div>
      <div className="btn-row" style={{ marginBottom: 4 }}>
        {project.targets.map((t) => (
          renaming === t.id ? (
            <input key={t.id} type="text" autoFocus defaultValue={t.name} style={{ width: 110, height: 26 }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v) update((d) => { const x = d.targets.find((q) => q.id === t.id); if (x) x.name = v; }); setRenaming(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
          ) : (
            <span key={t.id} className={`target-chip ${selBand?.targetId === t.id ? 'on' : ''}`}>
              <button className="chip-main" onClick={() => assignTarget(t.id)} onDoubleClick={() => setRenaming(t.id)} title="누르면 선택한 밴드(와 같은 높이의 밴드)에 지정 · 두 번 눌러 이름 바꾸기">
                <span className="dot" style={{ background: t.color }} />{t.name}
              </button>
              <button className="btn ghost sm icon" title="타깃 삭제" onClick={() => update((d) => {
                d.targets = d.targets.filter((x) => x.id !== t.id);
                for (const g of d.gels) for (const l of g.lanes) for (const b of l.bands) if (b.targetId === t.id) b.targetId = null;
                if (d.settings.loadingControlId === t.id) d.settings.loadingControlId = null;
              })}><Icon name="x" size={11} /></button>
            </span>
          )
        ))}
        <button className="btn sm" onClick={() => { const t = newTarget(project.targets); update((d) => { d.targets.push(t); }); setRenaming(t.id); }}><Icon name="plus" size={14} />타깃</button>
        {selBand?.targetId && <button className="btn ghost sm" onClick={() => assignTarget(null)}>지정 해제</button>}
      </div>
      <div className="hint">타깃 지정 방법<Help>밴드를 고른 뒤 타깃을 누르면 같은 높이의 밴드에 한 번에 지정됩니다. 결과 탭에서 타깃별로 모아 봅니다.</Help></div>

      <details className="more" style={{ marginTop: 12 }}>
        <summary>자동 검출 민감도</summary>
        <NumberSlider label="작은 밴드도 찾기" unit="% 가장 큰 밴드" min={0.5} max={50} step={0.5} value={det.minProminencePct}
          help="값이 작을수록 흐린 밴드까지 찾습니다."
          onChange={(v) => up((g) => { g.detection.minProminencePct = v; }, 'det-prom')} />
        <NumberSlider label="밴드 경계" unit="% 봉우리 높이" min={0} max={50} step={0.5} value={det.edgePct}
          help="신호가 이 비율 아래로 떨어지는 곳을 밴드 끝으로 봅니다."
          onChange={(v) => up((g) => { g.detection.edgePct = v; }, 'det-edge')} />
      </details>

      {project.gels.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <button className="btn sm" onClick={() => copySettingsToAll(gel.id)}><Icon name="copy" size={14} />이 겔의 처리 설정을 모든 겔에 복사</button>
        </div>
      )}
    </>
  );
}

const round = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(7)) : '');
