// 프로젝트 데이터 모델. 이 구조 전체가 프로젝트 파일(project.json)로 저장되며,
// 같은 이미지 + 같은 모델이면 항상 같은 결과가 나온다.

export const PROJECT_SCHEMA = 'densi-project/1';

export interface RawImage {
  width: number;
  height: number;
  /** 단일 채널, 원본 값 그대로 (정규화하지 않음) */
  data: Float32Array;
  bitDepth: 8 | 16 | 32;
  /** 포화 판정 기준값 (8-bit 255, 16-bit 65535, float은 실제 최댓값) */
  maxValue: number;
}

export type Polarity =
  /** 어두운 밴드, 밝은 배경 → 반전 (쿠마시, 은염색, 필름 스캔, 대부분의 화학발광 내보내기) */
  | 'dark-bands'
  /** 밝은 밴드, 어두운 배경 → 그대로 (형광, 반전 저장된 화학발광) */
  | 'light-bands'
  /** 어두운 밴드 + 투과광 스캔 → 광학 밀도(OD) 변환 */
  | 'dark-bands-od';

export type GrayMode = 'luminance' | 'red' | 'green' | 'blue' | 'mean';

export interface Preprocess {
  polarity: Polarity;
  /** 90도 단위 회전 */
  rotate90: 0 | 90 | 180 | 270;
  /** 미세 회전 (deskew), 도 단위 */
  rotateFine: number;
  flipH: boolean;
  grayMode: GrayMode;
}

export type Background2DMethod = 'none' | 'rolling-ball' | 'paraboloid';

export interface Background2D {
  method: Background2DMethod;
  radius: number;
  presmooth: boolean;
}

export interface DisplaySettings {
  /** 원본 값 기준 */
  min: number;
  max: number;
  gamma: number;
  /** 화면을 보정된(배경 제거) 분석 이미지로 볼지 */
  showCorrected: boolean;
  /**
   * 감마·표시 범위를 정량 데이터에도 적용할지. 기본은 false(표시 전용)이며,
   * true로 두면 신호와 값이 비례하지 않게 되므로 결과에 경고가 붙는다.
   */
  applyToData: boolean;
}

export type BaselineMethod =
  | 'none'
  | 'manual'
  | 'valley'
  | 'minimum'
  | 'lane-edge'
  | 'rolling-ball'
  | 'tophat'
  | 'rubber-band'
  | 'snip'
  | 'median'
  | 'asls'
  | 'airpls'
  | 'arpls'
  | 'psalsa'
  | 'modpoly'
  | 'imodpoly';

export interface BaselineSpec {
  method: BaselineMethod;
  /** 방법별 파라미터 (정의는 core/baseline/registry.ts) */
  params: Record<string, number>;
  /** method === 'manual'일 때 [프로파일 위치, 값] */
  points?: [number, number][];
}

export interface Band {
  id: string;
  /** 프로파일 인덱스 (레인 top 기준, 포함 구간) */
  start: number;
  end: number;
  targetId: string | null;
  /**
   * 밴드 기울기. 레인 왼쪽 끝과 오른쪽 끝의 세로 위치 차이(px).
   * 양수면 오른쪽이 아래로 내려간다. 밴드마다 따로 지정한다.
   */
  tilt: number;
  /**
   * 수동 베이스라인에서 밴드 시작점·끝점의 바닥선 높이 (프로파일 값 단위).
   * null이면 그 위치의 프로파일 값(골짜기)을 쓴다.
   */
  baseStart?: number | null;
  baseEnd?: number | null;
}

export interface Lane {
  id: string;
  /** 샘플 이름. 겔을 넘어 같은 이름끼리 묶인다 */
  sample: string;
  /** 레인 중심 x (전처리 후 이미지 좌표) */
  cx: number;
  top: number;
  bottom: number;
  width: number;
  /** null이면 겔 기본 베이스라인 사용 */
  baseline: BaselineSpec | null;
  bands: Band[];
  excluded: boolean;
}

export interface ProfileSettings {
  aggregate: 'mean' | 'median';
  /** 레인 폭 양쪽에서 제외할 비율(%) */
  edgeTrimPct: number;
}

export interface BandDetection {
  /** 최대 신호 대비 최소 prominence (%) */
  minProminencePct: number;
  /** 밴드 경계: 피크 높이 대비 이 비율(%) 아래로 떨어지면 끝 */
  edgePct: number;
  smoothing: number;
}

export interface Gel {
  id: string;
  name: string;
  fileName: string;
  /** IndexedDB/프로젝트 파일 내 원본 파일 키 */
  imageKey: string;
  sha256: string;
  page: number;
  sourceWidth: number;
  sourceHeight: number;
  bitDepth: 8 | 16 | 32;
  isRGB: boolean;
  lossy: boolean;
  preprocess: Preprocess;
  background: Background2D;
  display: DisplaySettings;
  profile: ProfileSettings;
  baseline: BaselineSpec;
  detection: BandDetection;
  lanes: Lane[];
  notes: string;
}

export interface Target {
  id: string;
  name: string;
  color: string;
  /** 정규화 기준(loading control) 후보 */
  isLoadingControl: boolean;
}

export type CalibrationModel = 'linear' | 'linear-origin' | 'quadratic' | 'power' | 'log' | '4pl';
export type CalibrationWeighting = 'none' | '1/x' | '1/x2';

export type SignalSource =
  | { kind: 'manual'; value: number | null }
  | { kind: 'band'; gelId: string; laneId: string; bandId: string };

export interface CalibrationRow {
  id: string;
  amount: number | null;
  source: SignalSource;
  excluded: boolean;
  note: string;
}

export interface Calibration {
  id: string;
  name: string;
  unit: string;
  model: CalibrationModel;
  weighting: CalibrationWeighting;
  /** 이 보정 곡선으로 역산할 타깃 (null이면 역산 안 함) */
  targetId: string | null;
  /** 어느 신호 값을 쓸지 */
  signal: SignalKind;
  rows: CalibrationRow[];
}

export type SignalKind = 'area' | 'volume';
export type NegativeHandling = 'clip' | 'allow';

export interface ProjectSettings {
  negative: NegativeHandling;
  /** 결과 표 기본 정규화 기준 */
  loadingControlId: string | null;
  referenceSample: string | null;
}

export interface Project {
  schema: typeof PROJECT_SCHEMA;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  gels: Gel[];
  targets: Target[];
  calibrations: Calibration[];
  settings: ProjectSettings;
}
