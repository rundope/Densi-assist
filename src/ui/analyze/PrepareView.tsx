import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Gel } from '../../core/types';
import { engine, type GelStatus, type ProcessedGel } from '../../engine/engine';
import { correctedSource, originalSource, renderToImageData, type RenderSource } from '../render';

function Pane({ title, caption, source, notice, reserve = 0, busy = false }: { title: string; caption: string; source: RenderSource | null; notice?: ReactNode; reserve?: number; busy?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !source) return;
    c.width = source.width;
    c.height = source.height;
    c.getContext('2d')!.putImageData(renderToImageData(source), 0, 0);
  }, [source]);
  return (
    <section className="prep-card">
      <header><b>{title}{busy && <span className="busy-tag">적용 중…</span>}</b><small>{caption}</small></header>
      <div className="prep-stage"><canvas ref={ref} className="prep-canvas" /></div>
      {notice ?? (reserve > 0 ? <div style={{ minHeight: reserve }} /> : null)}
    </section>
  );
}

/** 이미지에 대한 안내 문구. 설정 패널이 아니라 원본 이미지 아래에 보여준다 */
function useNotices(gel: Gel, data: ProcessedGel | null): string[] {
  const satCount = useMemo(() => {
    if (!data) return 0;
    const lvl = data.bitDepth === 32 ? data.maxValue : data.maxValue * 0.999;
    let c = 0;
    for (let i = 0; i < data.raw.length; i++) if (data.raw[i] >= lvl) c++;
    return c;
  }, [data]);
  const out: string[] = [];
  if (gel.lossy) out.push('JPG는 압축으로 값이 바뀌어 있습니다. 가능하면 원본 TIFF를 쓰세요.');
  if (gel.bitDepth === 8 && !gel.lossy) out.push('8-bit 이미지입니다. 아주 흐린 밴드와 진한 밴드를 함께 재기 어렵습니다. 가능하면 16-bit 원본 TIFF를 쓰세요.');
  if (satCount > 0) out.push(`가장 밝은 값(포화)인 픽셀이 ${satCount.toLocaleString()}개 있습니다. 해당 밴드는 값이 작게 나올 수 있습니다.`);
  return out;
}

/**
 * ① 이미지 준비 단계의 화면. 올린 그대로의 이미지와, 왼쪽 설정이 반영된 "보정 후" 이미지를 나란히 보여준다.
 * 두 이미지는 같은 밝기 범위·같은 극성으로 그리므로, 보정을 하지 않으면 똑같이 보여야 한다.
 */
export function PrepareView({ gel, data, status }: { gel: Gel; data: ProcessedGel | null; status: GelStatus }) {
  const notices = useNotices(gel, data);
  // 오른쪽 카드에도 같은 높이를 비워 두어 두 이미지가 같은 크기·같은 위치로 보이게 한다
  const noticeH = notices.length * 21 + 20;
  // 다시 그릴 필요가 있을 때만 새 소스를 만든다 (설정과 무관한 렌더링마다 캔버스를 다시 그리지 않게)
  const d = gel.display;
  const original = useMemo(() => (data ? originalSource(gel, data) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, d.min, d.max]);
  const corrected = useMemo(() => (data ? correctedSource(gel, data) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, d.min, d.max, d.gamma, d.applyToData, d.smooth, d.smoothApply, gel.preprocess.polarity, gel.background.method]);
  return (
    <div className="prepare">
      {status.state === 'error' && <div className="note err">{status.message}</div>}
      {!data && status.state !== 'error' && <div className="center-msg" style={{ position: 'static', padding: 40 }}>이미지 처리 중…</div>}
      {data && (
        <>
          <div className="prep-pair">
            <Pane title="원본" caption="올린 그대로" source={original}
              notice={notices.length > 0 ? <ul className="prep-notice" style={{ minHeight: noticeH }}>{notices.map((n) => <li key={n}>{n}</li>)}</ul> : undefined} />
            <div className="prep-arrow" aria-hidden>→</div>
            <Pane title="보정 후" caption="왼쪽 설정이 반영된 모습 · 이 이미지로 측정합니다" source={corrected} reserve={notices.length > 0 ? noticeH : 0} busy={engine.isBusy(gel.id)} />
          </div>
          <div className="prep-foot">{gel.fileName} · {data.width}×{data.height} · {gel.bitDepth}-bit{gel.isRGB ? ' RGB' : ''}</div>
        </>
      )}
    </div>
  );
}
