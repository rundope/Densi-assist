// 단독 실행판용: 워커 코드를 HTML 안에 내장한다.
// 파일(file://)로 연 페이지는 다른 파일을 불러올 수 없으므로 워커도 한 파일에 들어가야 한다.
import ProcessorWorker from './processor.worker.ts?worker&inline';

export function createProcessorWorker(): Worker {
  return new ProcessorWorker();
}
