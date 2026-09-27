// 웹 배포용: 워커를 별도 파일로 불러온다.
// 단독 실행판(Densi-assist.html) 빌드에서는 createWorker.inline.ts로 바꿔 끼운다 (vite.config.ts의 standalone 모드).
export function createProcessorWorker(): Worker {
  return new Worker(new URL('./processor.worker.ts', import.meta.url), { type: 'module' });
}
