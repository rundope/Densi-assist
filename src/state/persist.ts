import { del, get, set } from 'idb-keyval';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Project } from '../core/types';
import { getImage, putImage } from '../engine/imageStore';
import { migrateProject, uid } from './project';
import { useApp } from './store';

export interface ProjectIndexEntry {
  id: string;
  name: string;
  updatedAt: string;
  gels: number;
}

const INDEX = 'projects:index';
const CURRENT = 'projects:current';

export async function listProjects(): Promise<ProjectIndexEntry[]> {
  try {
    const idx = (await get<ProjectIndexEntry[]>(INDEX)) ?? [];
    return idx.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export async function saveProject(p: Project) {
  await set(`project:${p.id}`, p);
  const idx = (await get<ProjectIndexEntry[]>(INDEX)) ?? [];
  const entry = { id: p.id, name: p.name, updatedAt: p.updatedAt, gels: p.gels.length };
  const i = idx.findIndex((e) => e.id === p.id);
  if (i >= 0) idx[i] = entry; else idx.push(entry);
  await set(INDEX, idx);
  await set(CURRENT, p.id);
}

export async function loadStoredProject(id?: string): Promise<Project | null> {
  try {
    const pid = id ?? (await get<string>(CURRENT));
    if (!pid) return null;
    const p = await get<Project>(`project:${pid}`);
    return p ? migrateProject(p) : null;
  } catch (e) {
    console.warn('프로젝트 불러오기 실패', e);
    return null;
  }
}

export async function deleteStoredProject(id: string) {
  await del(`project:${id}`);
  const idx = ((await get<ProjectIndexEntry[]>(INDEX)) ?? []).filter((e) => e.id !== id);
  await set(INDEX, idx);
}

/** 프로젝트가 바뀔 때마다 잠시 후 자동 저장 */
export function startAutosave() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = useApp.getState().project;
  return useApp.subscribe((s) => {
    if (s.project === last) return;
    last = s.project;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const p = useApp.getState().project;
      useApp.getState().setSaveState('saving');
      try {
        await saveProject(p);
        if (useApp.getState().project === p) useApp.getState().setSaveState('saved');
      } catch (e) {
        console.error(e);
        useApp.getState().setSaveState('error');
      }
    }, 700);
  });
}

// ---------------- 파일 내보내기/가져오기 ----------------

export async function exportProjectFile(p: Project) {
  const files: Record<string, Uint8Array> = {
    'project.json': strToU8(JSON.stringify(p, null, 2)),
  };
  const missing: string[] = [];
  for (const g of p.gels) {
    const bytes = await getImage(g.imageKey);
    if (bytes) files[`images/${g.imageKey}`] = new Uint8Array(bytes);
    else missing.push(g.name);
  }
  const zip = zipSync(files, { level: 6 });
  downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `${safeName(p.name)}.densi`);
  return { missing };
}

export async function importProjectFile(file: File): Promise<Project> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf);
  const json = entries['project.json'];
  if (!json) throw new Error('project.json이 없는 파일입니다.');
  const p = migrateProject(JSON.parse(strFromU8(json)) as Project);
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.startsWith('images/')) continue;
    await putImage(name.slice(7), bytes.slice().buffer);
  }
  // 이미 같은 id의 프로젝트가 있으면 덮어쓰지 않도록 새 id를 준다
  const existing = await listProjects();
  if (existing.some((e) => e.id === p.id)) {
    p.id = uid('p');
    p.name = `${p.name} (가져옴)`;
  }
  return p;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'project';
