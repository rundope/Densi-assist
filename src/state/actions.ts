import { encode as encodePng } from 'fast-png';
import { detectBands } from '../core/bands';
import { cloneSpec, computeBaseline, makeSpec } from '../core/baseline/registry';
import { sha256Hex } from '../core/io/decode';
import { percentile, suggestPolarity, toGray } from '../core/image/preprocess';
import { detectLanes } from '../core/lanes';
import { synthesizeGel, type SynthLane } from '../core/synthetic';
import type { Band, BaselineSpec, Gel, Lane, Project } from '../core/types';
import { analyzeLane, engine } from '../engine/engine';
import { putImage } from '../engine/imageStore';
import { newBand, newCalibration, newGel, newLane, newProject, newTarget, uid } from './project';
import { findGel, useApp } from './store';

const app = () => useApp.getState();

const ACCEPT = /\.(tiff?|png|jpe?g|bmp|webp|gif)$/i;

/** 클립보드 이미지는 이름이 "image.png"로 고정되어 있어, 구분되는 이름을 붙인다. */
export function nameClipboardFiles(files: File[]): File[] {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  return files.map((f, i) => {
    if (f.name && f.name.toLowerCase() !== 'image.png') return f;
    const ext = f.type === 'image/jpeg' ? 'jpg' : f.type === 'image/bmp' ? 'bmp' : 'png';
    return new File([f], `붙여넣은 이미지 ${stamp}${files.length > 1 ? `-${i + 1}` : ''}.${ext}`, { type: f.type });
  });
}

const PASTE_KEY_HINT = '이미지를 복사한 뒤 이 창에서 Ctrl+V(맥은 ⌘+V)를 눌러 주세요.';

/** 버튼으로 클립보드의 이미지를 붙여넣는다. 브라우저가 지원하지 않거나 권한이 없으면 Ctrl+V 안내를 띄운다. */
export async function pasteFromClipboard() {
  if (!navigator.clipboard?.read || !window.isSecureContext) {
    app().toast({ kind: 'info', text: `이 환경에서는 버튼 붙여넣기를 쓸 수 없습니다. ${PASTE_KEY_HINT}` }, 7000);
    return;
  }
  try {
    const items = await navigator.clipboard.read();
    const files: File[] = [];
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      files.push(new File([blob], 'image.png', { type }));
    }
    if (!files.length) {
      app().toast({ kind: 'warn', text: '클립보드에 이미지가 없습니다. 먼저 이미지를 복사하거나 화면을 캡처한 뒤 다시 눌러 주세요.' }, 7000);
      return;
    }
    await addImageFiles(nameClipboardFiles(files));
  } catch (e) {
    console.error(e);
    app().toast({ kind: 'warn', text: `클립보드를 읽지 못했습니다(권한이 거부되었을 수 있음). ${PASTE_KEY_HINT}` }, 8000);
  }
}

export async function addImageFiles(files: File[]) {
  const imgs = files.filter((f) => ACCEPT.test(f.name) || f.type.startsWith('image/'));
  if (!imgs.length) {
    app().toast({ kind: 'warn', text: '이미지 파일(TIFF, PNG, JPG)을 선택하세요.' });
    return;
  }
  let firstId: string | null = null;
  for (const file of imgs) {
    try {
      const bytes = await file.arrayBuffer();
      const sha = await sha256Hex(bytes);
      const imageKey = `${sha.slice(0, 24)}`;
      await putImage(imageKey, bytes);
      const probe = { imageKey, page: 0, fileName: file.name };
      const img = await engine.getDecoded(probe);
      const gray = toGray(img, 'luminance');
      const [lo, hi] = percentile(gray.data, 0.05, 99.95);
      const gel = newGel({
        name: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        imageKey,
        sha256: sha,
        sourceWidth: img.width,
        sourceHeight: img.height,
        bitDepth: img.bitDepth,
        isRGB: img.channels.length > 1,
        lossy: img.lossy,
      });
      gel.preprocess.polarity = suggestPolarity(gray);
      gel.display.min = lo;
      gel.display.max = hi > lo ? hi : lo + 1;
      if (img.pageCount > 1) gel.notes = `멀티페이지 TIFF (${img.pageCount}페이지)`;
      app().update((d) => { d.gels.push(gel); });
      firstId ??= gel.id;
      img.warnings.forEach((w) => app().toast({ kind: 'warn', text: `${file.name}: ${w}` }, 7000));
    } catch (e) {
      console.error(e);
      app().toast({ kind: 'error', text: `${file.name}을(를) 열 수 없습니다: ${e instanceof Error ? e.message : e}` }, 8000);
    }
  }
  if (firstId) {
    app().setUi({ activeGelId: firstId, selectedLaneId: null, selectedBandId: null, tab: 'analyze', gridView: false });
    app().toast({ kind: 'success', text: `이미지 ${imgs.length}장을 추가했습니다. 레인 자동 검출로 시작해 보세요.` });
  }
}

export function removeGel(gelId: string) {
  const gel = app().project.gels.find((g) => g.id === gelId);
  if (!gel) return;
  app().update((d) => {
    d.gels = d.gels.filter((g) => g.id !== gelId);
    for (const c of d.calibrations) c.rows = c.rows.filter((r) => r.source.kind !== 'band' || r.source.gelId !== gelId);
  });
  const next = app().project.gels[0];
  app().setUi({ activeGelId: next?.id ?? null, selectedLaneId: next?.lanes[0]?.id ?? null, selectedBandId: null });
  app().toast({ kind: 'info', text: `"${gel.name}"을(를) 삭제했습니다.`, action: { label: '되돌리기', run: () => app().undo() } });
}

export async function autoDetectLanes(gelId: string, expected?: number) {
  const gel = app().project.gels.find((g) => g.id === gelId);
  if (!gel) return;
  const data = await engine.whenReady(gel);
  const guesses = detectLanes(data.signal, data.width, data.height, expected);
  if (!guesses.length) {
    app().toast({ kind: 'warn', text: '레인을 찾지 못했습니다. 극성(어두운/밝은 밴드) 설정을 확인하거나 레인 도구로 직접 그려 주세요.' }, 7000);
    return;
  }
  const old = gel.lanes;
  app().update((d) => {
    const g = findGel(d, gelId)!;
    g.lanes = guesses.map((q, i) => newLane({
      cx: q.cx, width: q.width, top: q.top, bottom: q.bottom,
      sample: old[i]?.sample || `S${i + 1}`,
    }));
  });
  const g2 = app().project.gels.find((g) => g.id === gelId)!;
  app().setUi({ selectedLaneId: g2.lanes[0]?.id ?? null, selectedBandId: null });
  app().toast({ kind: 'success', text: `레인 ${guesses.length}개를 찾았습니다. 위치가 어긋나면 드래그로 조정하세요.`, action: { label: '되돌리기', run: () => app().undo() } });
}

/** 밴드 검출. valley처럼 밴드에 의존하는 베이스라인은 검출 단계에서 rubber band로 대신한다 */
export function detectBandsForLane(gel: Gel, lane: Lane, project: Project): Band[] {
  const st = engine.status(gel.id);
  if (st.state !== 'ready') return lane.bands;
  const an = analyzeLane(gel, lane, st.data, project.settings.negative);
  let base = an.baseline;
  const spec: BaselineSpec = lane.baseline ?? gel.baseline;
  // 밴드 경계에 의존하는 베이스라인(valley, 수동)은 검출 단계에서 rubber band로 대신한다
  if (spec.method === 'valley' || spec.method === 'manual') base = computeBaseline(makeSpec('rubber-band'), { y: an.profile.values });
  const sig = an.profile.values.map((v, i) => v - base[i]);
  const ranges = detectBands(sig, gel.detection);
  const len = an.profile.values.length;
  return ranges.map((r) => {
    // 기존 밴드와 겹치면 타깃·기울기를 유지한다
    const prev = lane.bands.find((b) => r.peak >= b.start && r.peak <= b.end);
    return newBand(r.start, r.end, {
      id: prev?.id,
      targetId: prev?.targetId ?? guessTarget(gel, lane, r.peak / len),
      tilt: prev?.tilt ?? 0,
    });
  });
}

/** 같은 겔의 다른 레인에서 비슷한 위치(레인 길이의 4% 이내)의 밴드 타깃을 가져온다 */
function guessTarget(gel: Gel, lane: Lane, rf: number): string | null {
  let best: { d: number; t: string } | null = null;
  for (const l of gel.lanes) {
    if (l.id === lane.id) continue;
    const len = l.bottom - l.top;
    for (const b of l.bands) {
      if (!b.targetId) continue;
      const d = Math.abs((b.start + b.end) / 2 / len - rf);
      if (d < 0.04 && (!best || d < best.d)) best = { d, t: b.targetId };
    }
  }
  return best?.t ?? null;
}

export async function detectBandsAction(gelId: string, laneIds: string[] | 'all') {
  const gel0 = app().project.gels.find((g) => g.id === gelId);
  if (!gel0) return;
  await engine.whenReady(gel0);
  const project = app().project;
  const gel = project.gels.find((g) => g.id === gelId)!;
  const targets = laneIds === 'all' ? gel.lanes.filter((l) => !l.excluded) : gel.lanes.filter((l) => laneIds.includes(l.id));
  const results = new Map<string, Band[]>();
  for (const lane of targets) results.set(lane.id, detectBandsForLane(gel, lane, project));
  app().update((d) => {
    const g = findGel(d, gelId)!;
    for (const l of g.lanes) if (results.has(l.id)) l.bands = results.get(l.id)!;
  });
  const total = [...results.values()].reduce((s, b) => s + b.length, 0);
  return total;
}

export async function analyzeAllGels() {
  const { project } = app();
  let lanes = 0, bands = 0;
  for (const gel of project.gels) {
    try {
      if (!gel.lanes.length) {
        await autoDetectLanes(gel.id);
      }
      const g = app().project.gels.find((x) => x.id === gel.id)!;
      lanes += g.lanes.length;
      const needs = g.lanes.filter((l) => !l.bands.length).map((l) => l.id);
      if (needs.length) bands += (await detectBandsAction(g.id, needs)) ?? 0;
    } catch (e) {
      app().toast({ kind: 'error', text: `${gel.name}: ${e instanceof Error ? e.message : e}` });
    }
  }
  app().toast({ kind: 'success', text: `겔 ${project.gels.length}장 · 레인 ${lanes}개 · 새 밴드 ${bands}개를 분석했습니다. 밴드에 타깃을 지정하면 결과 표에 나타납니다.` }, 6000);
}

export function copyLanesToGel(fromGelId: string, toGelId: string) {
  const { project } = app();
  const from = project.gels.find((g) => g.id === fromGelId);
  const to = project.gels.find((g) => g.id === toGelId);
  if (!from || !to) return;
  const sx = to.sourceWidth / from.sourceWidth, sy = to.sourceHeight / from.sourceHeight;
  app().update((d) => {
    const g = findGel(d, toGelId)!;
    g.lanes = from.lanes.map((l) => newLane({
      cx: l.cx * sx, width: l.width * sx, top: l.top * sy, bottom: l.bottom * sy, sample: l.sample, excluded: l.excluded,
    }));
  });
  app().toast({ kind: 'success', text: `"${from.name}"의 레인 ${from.lanes.length}개(샘플명 포함)를 "${to.name}"에 복사했습니다.`, action: { label: '되돌리기', run: () => app().undo() } });
}

/** 겔 처리 설정(극성, 배경, 프로파일, 베이스라인, 검출)을 다른 겔에 복사 */
export function copySettingsToAll(fromGelId: string) {
  const from = app().project.gels.find((g) => g.id === fromGelId);
  if (!from) return;
  app().update((d) => {
    for (const g of d.gels) {
      if (g.id === fromGelId) continue;
      g.preprocess = { ...from.preprocess, rotate90: g.preprocess.rotate90, rotateFine: g.preprocess.rotateFine, flipH: g.preprocess.flipH };
      g.background = { ...from.background };
      g.profile = { ...from.profile };
      g.baseline = cloneSpec(from.baseline);
      g.detection = { ...from.detection };
    }
  });
  app().toast({ kind: 'success', text: '처리 설정을 모든 겔에 복사했습니다 (회전은 겔마다 유지).', action: { label: '되돌리기', run: () => app().undo() } });
}

// ---------------- 데모 프로젝트 ----------------

async function addSynthGel(project: Project, name: string, lanes: SynthLane[], seed: number, w: number, h: number, smile: number) {
  const synth = synthesizeGel({ width: w, height: h, lanes, seed, smile });
  const png = encodePng({ width: w, height: h, data: synth.data, depth: 16, channels: 1 });
  const bytes = png.slice().buffer;
  const sha = await sha256Hex(bytes);
  const imageKey = sha.slice(0, 24);
  await putImage(imageKey, bytes);
  const gel = newGel({
    name, fileName: `${name}.png`, imageKey, sha256: sha, sourceWidth: w, sourceHeight: h,
    bitDepth: 16, isRGB: false, lossy: false,
  });
  gel.display.min = 20000;
  gel.display.max = 56000;
  gel.lanes = synth.laneCenters.map((cx, i) => newLane({
    cx, width: synth.laneWidth, top: Math.round(h * 0.06), bottom: Math.round(h * 0.94), sample: lanes[i].sample,
  }));
  project.gels.push(gel);
  return gel;
}

export async function createDemoProject() {
  const p = newProject('데모: p-ERK 약물 처리');
  const perk = newTarget([], 'p-ERK');
  const gapdh = { ...newTarget([perk], 'GAPDH'), isLoadingControl: true };
  p.targets = [perk, gapdh];
  p.settings.loadingControlId = gapdh.id;
  p.settings.referenceSample = 'Ctrl';
  const W = 1000, H = 560;
  const stds = [1, 2, 4, 8, 16];
  const doses: [string, number, number][] = [['Ctrl', 3, 6], ['Drug 1µM', 4.6, 6.4], ['Drug 10µM', 8.2, 5.6], ['Drug 100µM', 11.5, 6.1]];

  const gA = await addSynthGel(p, '블롯1 p-ERK + 표준', [
    ...stds.map((a) => ({ sample: `Std ${a} ng`, bands: [{ y: 0.42, amount: a }] })),
    ...doses.map(([s, a]) => ({ sample: s, bands: [{ y: 0.42, amount: a }, { y: 0.7, amount: 1.4 }] })),
  ], 11, W, H, 5);
  const gB = await addSynthGel(p, '블롯1 GAPDH (재프로빙)', doses.map(([s, , lc]) => ({ sample: s, bands: [{ y: 0.36, amount: lc }] })), 23, W, H, 3);
  const gC = await addSynthGel(p, '블롯2 반복 (p-ERK + GAPDH)', doses.map(([s, a, lc]) => ({ sample: s, bands: [{ y: 0.3, amount: lc * 0.95 }, { y: 0.55, amount: a * 1.08 }] })), 37, W, H, 4);

  const cal = newCalibration([]);
  cal.name = 'p-ERK 표준곡선';
  cal.targetId = perk.id;
  cal.rows = [];
  p.calibrations.push(cal);

  app().loadProject(p);
  app().setUi({ tab: 'analyze', gridView: true });

  // 처리 → 밴드 검출 → 타깃 지정 → 표준곡선 행 채우기
  for (const g of [gA, gB, gC]) await detectBandsAction(g.id, 'all');
  const assign = (gelId: string, rules: [number, string][]) => {
    app().update((d) => {
      const g = findGel(d, gelId)!;
      for (const l of g.lanes) for (const b of l.bands) {
        const y = (l.top + (b.start + b.end) / 2) / H;
        const hit = rules.find(([ry]) => Math.abs(ry - y) < 0.05);
        b.targetId = hit ? hit[1] : null;
      }
    });
  };
  assign(gA.id, [[0.42, perk.id]]);
  assign(gB.id, [[0.36, gapdh.id]]);
  assign(gC.id, [[0.3, gapdh.id], [0.55, perk.id]]);

  app().update((d) => {
    const c = d.calibrations[0];
    const g = findGel(d, gA.id)!;
    c.rows = g.lanes.slice(0, stds.length).flatMap((l, i) => {
      const b = l.bands.find((x) => x.targetId === perk.id);
      return b ? [{ id: uid('r'), amount: stds[i], source: { kind: 'band' as const, gelId: g.id, laneId: l.id, bandId: b.id }, excluded: false, note: '' }] : [];
    });
  });
  // 데모 준비 과정은 되돌리기 기록에 남기지 않는다
  useApp.setState({ past: [], future: [] });
  const g = app().project.gels[0];
  app().setUi({ activeGelId: g.id, selectedLaneId: g.lanes[5]?.id ?? g.lanes[0]?.id ?? null, calibrationId: app().project.calibrations[0]?.id ?? null });
  app().toast({ kind: 'success', text: '데모 프로젝트를 만들었습니다: 겔 3장, 표준 5점, 약물 처리 4조건.' }, 6000);
}
