import { del, get, set } from 'idb-keyval';

// 원본 이미지 파일 바이트. 프로젝트 JSON과 분리해 IndexedDB에 저장한다.
const memory = new Map<string, ArrayBuffer>();

export async function putImage(key: string, bytes: ArrayBuffer) {
  memory.set(key, bytes);
  try {
    await set(`img:${key}`, bytes);
  } catch (e) {
    console.warn('IndexedDB 저장 실패 (메모리에만 보관)', e);
  }
}

export async function getImage(key: string): Promise<ArrayBuffer | undefined> {
  const m = memory.get(key);
  if (m) return m;
  try {
    const v = await get<ArrayBuffer>(`img:${key}`);
    if (v) memory.set(key, v);
    return v;
  } catch {
    return undefined;
  }
}

export async function deleteImage(key: string) {
  memory.delete(key);
  try { await del(`img:${key}`); } catch { /* 무시 */ }
}
