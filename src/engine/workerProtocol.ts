// 메인 스레드와 워커가 함께 쓰는 약속. (워커 파일을 메인에서 import하면 워커 코드가 메인에서 실행되므로 따로 둔다)
import type { DisplaySettings, Preprocess } from '../core/types';

/** 워커에 중간 결과가 없어서 이미지 채널을 다시 보내 달라는 신호 */
export const NEED_CHANNELS = '__need_channels__';

/** 메인 스레드와 워커가 같은 규칙으로 계산하는 "배경 제거 전 단계" 키 */
export function baseKeyOf(imageId: string, preprocess: Preprocess, display: DisplaySettings): string {
  const smoothSigma = display.smoothApply && display.smooth > 0 ? display.smooth : 0;
  const gamma = display.applyToData && display.gamma !== 1 ? display.gamma : 1;
  return JSON.stringify([imageId, preprocess, smoothSigma, gamma]);
}

