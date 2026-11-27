import * as XLSX from 'xlsx';
import { BASELINE_MAP } from '../../core/baseline/registry';
import type { BandRow, summarize, SummaryValue } from '../../core/results';
import type { Project } from '../../core/types';
import { downloadBlob, safeName } from '../../state/persist';

const APP_VERSION = '0.3.0';

function bandTable(project: Project, rows: BandRow[]) {
  const tn = (id: string | null) => project.targets.find((t) => t.id === id)?.name ?? '';
  const header = ['이미지', '레인', '샘플', '밴드', '타깃', '기울기(px)', '면적', '% 레인', '위치(px)', 'Rf', '높이', 'Volume', '포화 픽셀'];
  const body = rows.map((r) => [
    r.gelName, r.laneIndex + 1, r.sample, r.bandIndex + 1, tn(r.targetId), r.tilt, round(r.area, 6), round(r.pctLane, 3),
    Math.round(r.position), round(r.rf, 4), round(r.height, 6), round(r.volume, 6), r.saturatedPixels,
  ]);
  return [header, ...body];
}

const round = (v: number, d: number) => (Number.isFinite(v) ? Number(v.toPrecision(d + 2)) : '');

export function rowsToTsv(project: Project, rows: BandRow[]) {
  return bandTable(project, rows).map((r) => r.join('\t')).join('\n');
}

export function exportCsv(project: Project, rows: BandRow[]) {
  const csv = bandTable(project, rows)
    .map((r) => r.map((c) => (typeof c === 'string' && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\r\n');
  // 엑셀에서 한글이 깨지지 않도록 BOM 추가
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${safeName(project.name)}_bands.csv`);
}

export function exportXlsx(project: Project, rows: BandRow[], summary: ReturnType<typeof summarize>, kind: SummaryValue) {
  const wb = XLSX.utils.book_new();
  const tn = (id: string | null) => project.targets.find((t) => t.id === id)?.name ?? '';
  const ref = project.settings.referenceSample;

  // 샘플별 요약 (타깃이 지정된 밴드가 있을 때)
  if (summary.cells.length) {
    const sum: (string | number)[][] = [[
      '샘플', '타깃', `평균 ${kind === 'volume' ? 'Volume' : '면적'}`, 'SD', 'n', '레인별 값', ref ? `상대값 (기준 ${ref})` : '상대값', '상대값 SD',
    ]];
    for (const c of summary.cells) {
      sum.push([
        c.sample, tn(c.targetId), round(c.raw.mean, 6), round(c.raw.sd, 6), c.raw.n, c.raw.values.map((v) => round(v, 6)).join('; '),
        c.relative ? round(c.relative.mean, 6) : '', c.relative ? round(c.relative.sd, 6) : '',
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), '샘플별 요약');
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bandTable(project, rows)), '밴드');

  // 설정 (재현성 기록)
  const set: (string | number)[][] = [
    ['프로젝트', project.name], ['내보낸 시각', new Date().toISOString()], ['앱 버전', APP_VERSION],
    ['바닥선이 프로파일보다 높은 곳', project.settings.negative === 'clip' ? '0으로 계산' : '빼서 계산'],
    ['기준 샘플', ref ?? ''], [],
    ['이미지', '파일', 'SHA-256', '비트', '극성', '회전', '미세 회전', '2D 배경', '반경', '프로파일', '가장자리 제외 %', '베이스라인', '베이스라인 파라미터', '개별 베이스라인 레인 수', '레인 수', '감마', '감마를 정량에 적용', '부드럽게 (px)', '부드럽게를 정량에 적용', '배경 제거 강도 (%)', '상수 기준 위치 (%)'],
  ];
  for (const g of project.gels) {
    set.push([
      g.name, g.fileName, g.sha256, g.bitDepth, g.preprocess.polarity, g.preprocess.rotate90, g.preprocess.rotateFine,
      g.background.method, g.background.method === 'none' ? '' : g.background.radius, g.profile.aggregate, g.profile.edgeTrimPct,
      BASELINE_MAP[g.baseline.method].label, JSON.stringify(g.baseline.params), g.lanes.filter((l) => l.baseline).length, g.lanes.length,
      g.display.gamma, g.display.gamma === 1 ? '해당 없음 (감마 1)' : g.display.applyToData ? '예 (비선형)' : '아니오 (표시 전용)',
      g.display.smooth ?? 0, (g.display.smooth ?? 0) > 0 ? (g.display.smoothApply ? '예' : '아니오 (표시 전용)') : '',
      g.background.method === 'none' ? '' : g.background.strength ?? 100, g.background.method === 'constant' ? g.background.constantPct ?? 10 : '',
    ]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(set), '설정');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName(project.name)}_results.xlsx`);
}
