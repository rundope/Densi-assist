import { useEffect, useRef } from 'react';
import type { Gel } from '../../core/types';
import type { GelStatus, ProcessedGel } from '../../engine/engine';
import { renderToImageData, type RenderSource } from '../render';

function Pane({ title, caption, source, dim }: { title: string; caption: string; source: RenderSource | null; dim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !source) return;
    c.width = source.width;
    c.height = source.height;
    c.getContext('2d')!.putImageData(renderToImageData(source), 0, 0);
  }, [source]);
  return (
    <section className={`prep-card ${dim ? 'dim' : ''}`}>
      <header><b>{title}</b><small>{caption}</small></header>
      <div className="prep-stage"><canvas ref={ref} className="prep-canvas" /></div>
    </section>
  );
}

/**
 * ① 이미지 준비 단계의 화면. 올린 그대로의 이미지와, 실제 측정에 쓰이는 이미지를 나란히 보여준다.
 * 밴드 색·컬러→흑백·감마·부드럽게·배경 제거를 바꾸면 오른쪽이 바로 바뀌므로 설정의 효과가 눈에 보인다.
 */
export function PrepareView({ gel, data, status }: { gel: Gel; data: ProcessedGel | null; status: GelStatus }) {
  const d = gel.display;
  const original: RenderSource | null = data
    ? { width: data.width, height: data.height, values: data.raw, min: d.min, max: d.max > d.min ? d.max : d.min + 1, gamma: 1, invert: false }
    : null;
  // data.signal은 극성·감마·부드럽게·배경 제거가 이미 반영된 측정용 값이다 (밴드가 클수록 큰 값)
  const measured: RenderSource | null = data
    ? (() => {
        const [lo, hi] = data.signalRange;
        return { width: data.width, height: data.height, values: data.signal, min: Math.min(lo, 0), max: hi > lo ? hi : lo + 1, gamma: 1, invert: false };
      })()
    : null;

  return (
    <div className="prepare">
      {status.state === 'error' && <div className="note err">{status.message}</div>}
      {!data && status.state !== 'error' && <div className="center-msg" style={{ position: 'static', padding: 40 }}>이미지 처리 중…</div>}
      {data && (
        <>
          <div className="prep-pair">
            <Pane title="원본" caption="올린 그대로 (화면 밝기만 자동 조절)" source={original} />
            <div className="prep-arrow" aria-hidden>→</div>
            <Pane title="측정에 쓰이는 이미지" caption="밴드가 밝을수록 큰 값 · 아래 설정이 반영됨" source={measured} />
          </div>
          <div className="prep-foot">
            {gel.fileName} · {data.width}×{data.height} · {gel.bitDepth}-bit{gel.isRGB ? ' RGB' : ''} — 오른쪽 이미지가 ② 레인, ③ 밴드, ④ 결과의 모든 계산에 쓰입니다.
          </div>
        </>
      )}
    </div>
  );
}
