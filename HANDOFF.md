# HANDOFF — Densi-assist 개발 인수인계

> 작성: 2026-09-26, 이전 Claude Code 세션(대화 ID `3c01a325-6a5f-4ad0-8772-0577523ce83c`)에서 작성.
> 이 문서만 읽고 작업을 이어갈 수 있게 쓴 것이다. 코드와 이전 대화에서 확인된 사실만 적었고, 불확실한 것은 "확실하지 않음"으로 표시했다.
> **[Claude 판단]** = 사용자가 직접 요구하지 않았고 이전 Claude가 판단해 넣은 것. 표시가 없으면 사용자가 요구했거나 승인한 것.
> 사용자와의 대화는 **한국어**로 한다. UI 문구도 한국어다.

---

## 0. 한 줄 요약

전기영동 겔·웨스턴 블롯 사진에서 밴드 진하기를 정량하는 **브라우저 전용 웹앱**(ImageJ Gel Analyzer 대체). React 19 + TypeScript + Vite. 현재 v0.3.0(이후 기능 추가됨), 테스트 34개(`real-gel.png` 없으면 33 통과 + 1 skip). 설치 없이 쓰는 단독 실행판 `Densi-assist.html`(HTML 파일 하나, 약 1MB)도 빌드로 만들어진다. GitHub 업로드는 끝났고(저장소 `rundope/Densi-assist`, `main`), 저장소는 2026-11-27에 **공개로 전환**했고 Pages Source를 GitHub Actions로 설정해 배포에 성공했다. 실제 주소는 **`https://rundope.github.io/Densi-assist/`**(대소문자 구분. 소문자 `densi-assist`는 404). `main` push 시 자동 배포. 비공개로 되돌리면 무료 요금제에서 Pages가 불가하므로 `Densi-assist.html` 다운로드 방식을 쓴다. 개인 PC 경로는 공개 대비로 일반 표기(`<이전 PC>` 등)로 바꿨다. 홈페이지 탑재는 **준비만 되어 있고 아직 하지 않았다**.

---

## 1. 프로젝트 개요

### 무엇을
- 겔/블롯 이미지를 올리면 → 레인(세로 줄)을 정하고 → 레인 방향 진하기 곡선(프로파일)을 만들고 → 바닥선(베이스라인) 위의 봉우리 넓이를 밴드 값(면적)으로 계산한다.
- 결과를 표로 보고 엑셀/CSV/클립보드로 내보낸다.

### 누구를 위해
- 사용자(한국어 사용, 연구실/회사 실험자)와 그 동료 실험자. 최종적으로 **회사 홈페이지에 탑재**할 계획(사용자 발언: "나중에 우리 홈페이지에 탑재를 할 수 있게").
- 회사 보안 때문에 이 PC의 Claude는 GitHub에 연동되지 않는다(사용자 발언).

### 사용자가 처음부터 요구한 핵심
1. ImageJ처럼 밴드 intensity를 수치화
2. 감마 등으로 배경을 전체적으로 조절
3. 베이스라인을 롤링볼 또는 **사용자가 자유롭게** 잡아 면적 계산
4. **일관된 결과**(재현성)
5. 만들기 전에 ImageJ 등 기존 소프트웨어 알고리즘 **먼저 조사**
6. 여러 베이스라인 방법 중 **선택**
7. **여러 장의 겔을 한 창에서** 한 번에 측정
8. 농도별 로딩 데이터를 엑셀 같은 표에 넣어 **표준곡선(calibration curve)** — 이후 사용자가 "일단 없애자"로 **화면에서 숨김**
9. 부가 기능이 측정을 방해하지 않고 친절할 것

### 핵심 차별점 (ImageJ 대비)
- 베이스라인 방법 선택(현재 화면에 7종) + 레인별 개별 지정 + 밴드별 수동 시작·끝점
- 밴드마다 **기울기(tilt)** 를 주어 비스듬한 밴드를 따라 적분
- 여러 이미지를 한 프로젝트에서, 샘플 이름으로 이미지를 넘어 묶어 평균±SD·상대값
- 표시(감마·밝기)와 정량 분리(기본). 모든 설정을 프로젝트 파일과 엑셀 "설정" 시트에 기록
- 이미지가 서버로 가지 않음(전부 브라우저 안에서 처리, Web Worker)

---

## 2. 파일 구조

> **중요:** 이 프로젝트의 `index.html`에는 앱 코드가 없다. 앱 코드는 전부 `src/`에 있고, `index.html`은 Vite 진입점(껍데기)이다. "주요 함수가 index.html 안 어디에 있는지"는 해당 없음 — 대신 아래에 `src/` 안 위치를 적었다.
> `Densi-assist.html`은 빌드 산출물(모든 JS·CSS가 한 줄로 들어간 파일)이므로 **직접 수정하지 않는다.**

### 루트
| 파일 | 역할 |
|---|---|
| `index.html` | Vite 진입점. `<script type="module" src="/src/main.tsx">`. 머리에 `<!-- file-guard -->` 스크립트가 있어, **파일(file://)로 열면 같은 폴더의 `Densi-assist.html`로 이동**한다 |
| `Densi-assist.html` | 단독 실행판(더블클릭 실행). `npm run build` 또는 `npm run build:standalone`이 생성. 저장소에 포함하기로 함 [Claude 판단] |
| `vite.config.ts` | 두 가지 빌드: 기본(웹 배포 `dist/`, `base: './'` 상대 경로) / `--mode standalone`(워커 iife 내장 + `singleFileHtml()` 플러그인이 `closeBundle`에서 JS·CSS를 HTML에 넣어 `Densi-assist.html` 생성, 중간 결과 `node_modules/.densi-standalone`은 삭제). Vitest 설정도 여기 |
| `package.json` | 스크립트: `dev`, `build`(타입검사→웹빌드→단독실행판), `build:standalone`, `preview`, `test`, `typecheck`, `check`. `license: UNLICENSED` [Claude 판단] |
| `package-lock.json` | 의존성 고정. `xlsx`는 SheetJS CDN tarball URL |
| `tsconfig.json` | strict, `noUnusedLocals`. include: `src`, `tests`, `vite.config.ts` |
| `README.md` | 소개, 실행, 폴더 구조, 문서 목록 |
| `.gitignore` | `node_modules/`, `dist/`, `*.tsbuildinfo`, `.claude/`, `.vscode/`, `tests/fixtures/real-gel.png`(회사 실험 이미지, 보안) |
| `.gitattributes` | LF 통일, 이미지·zip 바이너리 |
| `.nvmrc` | `22` (CI가 이 값을 씀) |
| `.github/workflows/ci.yml` | push(main)/PR 시 `npm ci → typecheck → test → build`, dist 아티팩트 업로드 |
| `.github/workflows/deploy-pages.yml` | GitHub Pages 배포. **`main` push 시 자동 + 수동 실행**. Settings → Pages → Source는 GitHub Actions로 설정되어 있음 |
| `.claude/launch.json` | Claude 데스크톱 앱 미리보기용 서버 설정 (3장 참고). **gitignore 대상이라 GitHub/zip으로 옮겨지지 않음** |
| `HANDOFF.md` | 이 문서 |
| `CLAUDE.md` | 첫 줄 `@HANDOFF.md` (새 세션이 자동으로 이 문서를 읽게) |

### docs/
| 파일 | 내용 |
|---|---|
| `USER_MANUAL.ko.md` / `.en.md` / `.ja.md` / `.zh-CN.md` | 사용자 매뉴얼 4개 언어(스크린샷 없음). 앱 화면은 한국어뿐이라, 번역판은 화면 문구를 **한국어 그대로** 적고 괄호에 번역을 붙임. 한국어판을 고치면 나머지 3개도 같이 고쳐야 함 |
| `DEPLOY.md` | GitHub 업로드 3가지 방법, 홈페이지 탑재(iframe 예시), GitHub Pages, 단독 실행판 배포 |
| `DESIGN.md` | 설계 문서. **일부는 v0.2 기준이라 화면에서 숨긴 기능(표준곡선, 로딩 컨트롤 정규화, 베이스라인 16종 전체)을 설명함** — 현재 화면과 다를 수 있음 |
| `images/` | 매뉴얼 그림. 지금은 `smoothing-before/after.png`(**합성 이미지**로 만든 부드럽게 전/후). **실제 실험 이미지는 저장소가 공개이므로 넣지 말 것** |
| `RESEARCH.md` | 사전 조사: ImageJ BackgroundSubtracter/GelAnalyzer 소스 분석, Image Lab·Image Studio·TotalLab·GelAnalyzer·ImageQuant, pybaselines 알고리즘, 출처 목록 |

### src/core — 순수 알고리즘 (React 무관, 테스트 대상)
| 파일 | 주요 함수 |
|---|---|
| `types.ts` | 데이터 모델: `Project`, `Gel`, `Lane`, `Band`(`start/end/targetId/tilt/baseStart/baseEnd`), `BaselineSpec`, `DisplaySettings`(`applyToData`), `Calibration` 등. `PROJECT_SCHEMA = 'densi-project/1'`. **좌표 규칙**: 레인 `cx/top/bottom/width`는 전처리(회전) 후 이미지 px, 밴드 `start/end`는 `round(lane.top)` 기준 프로파일 인덱스(포함 구간), `tilt`는 레인 왼쪽 끝과 오른쪽 끝의 세로 차(px, 양수=오른쪽이 아래), `baseStart/baseEnd`는 프로파일 값 단위(null=그 위치의 프로파일 값) |
| `io/decode.ts` | `decodeImage`(TIFF: geotiff, PNG 16-bit: fast-png, JPG/BMP: 브라우저), `detectFormat`, `sha256Hex`(WebCrypto 없으면 순수 JS `sha256`로 대체 — HTTP 서버 대응) |
| `image/preprocess.ts` | `toGray`, `applyGeometry`(rotate90/flipH/미세회전), `gaussianBlur`(화면·측정용 분리형 블러), `toSignal`(극성: dark-bands 반전 / light-bands / OD), `applyDisplayTransform`(감마를 정량에 적용할 때), `suggestPolarity`(열 중앙값 제거 후 꼬리 비교), `percentile`, `histogram`(현재 UI에서는 안 씀) |
| `image/background2d.ts` | `estimateBackground2D` — ImageJ rolling ball(축소·arcTrim·bilinear 확대) / sliding paraboloid 포팅. `ballParams`, `slideParabola` |
| `profile.ts` | `extractProfile(signal, raw, satLevel, lane, settings, tilt)` — 레인 폭 평균/중앙값, 가장자리 제외 %, **tilt만큼 열마다 세로로 밀어 샘플링**, 좌우 바깥 띠(lane-edge용), 행별 포화 수. `laneColumns` |
| `baseline/registry.ts` | 베이스라인 정의 `BASELINES`(16종 메타데이터: 설명·주의·파라미터), `VISIBLE_BASELINES`(화면 노출 7종), `computeBaseline`, `cloneSpec`(**immer draft 복사용**), `makeSpec`, `manualBandBaseline`(밴드별 시작·끝점 직선), `rollingBall1D`, `rubberBand`, `snip`, `asls/airpls/arpls/psalsa`, `modpoly`, `scaledLam`(λ를 1000점 기준 환산) |
| `lanes.ts` | `detectLanes` — 행 하위10% 제거→열 점수→슬라이딩 최솟값으로 비네팅 제거→로그 압축→prominence 봉우리→봉우리 사이 최솟값 경계→반치폭으로 중심·폭→세로 범위 |
| `bands.ts` | `detectBands`(평활→prominence→경계), `measureBand`(area=Σ(profile−baseline), volume=area×열 수, 포화 픽셀, 음수 비율) |
| `math.ts` | 평활, 슬라이딩 min/max/median, `solveWhittaker`(밴드 Cholesky), `polyFit`, `solveDense`, 통계 |
| `results.ts` | `BandRow` 타입, `summarize`(샘플×타깃 평균·SD, 로딩 컨트롤 정규화(현재 UI에서 null 전달), 기준 샘플 상대값) |
| `calibration.ts` | `fitCalibration`(선형/원점/2차/거듭제곱/로그/4PL LM), `MODEL_INFO` — **화면에서 숨김** |
| `synthetic.ts` | `synthesizeGel` — 데모·테스트용 합성 16-bit 겔 |

### src/engine — 처리 엔진
| 파일 | 역할 |
|---|---|
| `engine.ts` | `engine`(겔별 처리 상태·캐시, `ensure`, `whenReady`, `processingKey` = 이미지+페이지+전처리+2D배경+(감마를 정량에 적용할 때만 표시 설정)), 워커 오류 시 오류 상태로 전환. `analyzeLane`(레인 분석 메모이즈, **tilt별 variant 프로파일·베이스라인**), `variantFor`, `effectiveBaseline` |
| `processor.worker.ts` | 워커: 회색→기하→(옵션)표시변환→극성→2D배경 제거. `raw`(원본 값, 표시·포화 판정용)와 `signal`(정량용)을 돌려줌 |
| `createWorker.ts` | 웹 배포용 모듈 워커 생성 |
| `createWorker.inline.ts` | 단독 실행판용(`?worker&inline`). standalone 빌드에서 alias로 바꿔 끼움 |
| `hooks.ts` | `useGelStatus`, `useAllProcessed`, `buildBandRows`(결과 행), `useBandRows`, `evaluateCalibration` |
| `imageStore.ts` | 원본 이미지 바이트를 IndexedDB(`img:<key>`)와 메모리에 보관 |

### src/state — 상태·저장
| 파일 | 역할 |
|---|---|
| `store.ts` | zustand `useApp`: `project`(저장 대상)·`ui`·실행취소(150단계, 같은 키 1.2초 내 연속 변경은 한 단계로)·토스트. `setTool`(도구 변경 시 `SECTIONS_FOR_TOOL`로 오른쪽 패널 자동 펼침: select→이미지, lane→배경제거+레인, band→밴드·타깃, baseline→베이스라인) |
| `project.ts` | 기본값 팩토리 `newProject/newGel/newLane/newBand/newTarget/newCalibration`, `migrateProject`(구버전 필드 보정) |
| `actions.ts` | `addImageFiles`, `nameClipboardFiles`, `pasteFromClipboard`(붙여넣기 버튼), `removeGel`, `autoDetectLanes`, `detectBandsForLane`/`detectBandsAction`, `analyzeAllGels`, `copyLanesToGel`, `copySettingsToAll`, `createDemoProject`(합성 겔 3장 + 숨겨진 표준곡선 1개) |
| `persist.ts` | IndexedDB 자동 저장(700ms 디바운스; 키 `projects:index`, `projects:current`, `project:<id>`), `.densi` 파일(zip: `project.json` + `images/<imageKey>`) 내보내기/가져오기 |

### src/ui — 화면
| 파일 | 역할 |
|---|---|
| `App.tsx` | 헤더(탭: 분석/결과 — 표준곡선 탭 제거), 프로젝트 메뉴, 도움말 모달, 첫 화면(EmptyState: 끌어놓기·클릭·**Ctrl+V 붙여넣기 + 붙여넣기 버튼 + 사용법**), 전역 드래그앤드롭·**paste 이벤트**, 단축키 |
| `analyze/AnalyzeView.tsx` | **맨 위 가로 이미지 띠**(썸네일+이름+레인/밴드 수, ⋯ 메뉴), 도구막대(하위 버튼 "그리기/검출 (Auto)"; ① 이미지 준비 단계에서는 도구막대를 숨김), 한 장/전체 보기 전환 버튼은 이미지 띠 머리로 이동. ① 이미지 준비일 때 가운데에 `PrepareView`, ②·③일 때 `ImageView`+`ProfilePanel` |
| `analyze/Stepper.tsx` | 작업 순서 스텝바(4단계 버튼, 지금 할 일, 이전/다음). 4단계 결과는 `tab: 'results'`로 이동 |
| `analyze/PrepareView.tsx` | ① 이미지 준비 화면: 원본과 보정 후 이미지(= 측정에 쓰이는 이미지, 원본과 같은 모습으로 다시 뒤집어 표시)를 캔버스 두 개로 나란히 표시 |
| `analyze/ImageView.tsx` | 이미지 캔버스 + SVG 오버레이(레인·밴드·기울기 손잡이), 줌/팬, 모든 드래그 상호작용, "원본 이미지 보기" 토글(O 키), 도구 안내창(왼쪽 위) |
| `analyze/ProfilePanel.tsx` | 레인 띠 이미지 + 프로파일 그래프(기울어진 밴드 구간은 기울인 프로파일로 그림), 밴드 시작·끝점 동그라미(수동 모드에서 드래그), 전체 레인 비교, "수동으로 다듬기" |
| `analyze/Inspector.tsx` | **왼쪽 패널**: 묶음 1.선택(①이미지) / 2.레인(②배경 제거, ③레인) / 3.밴드(④베이스라인, ⑤밴드·타깃). 밴드 표(#, 기울기, 면적, %), 표 복사/겔 전체 복사, 타깃 칩(밴드 고른 뒤 누르면 같은 높이 밴드에 일괄 지정) |
| `results/ResultsView.tsx` | 결과 탭(단순화): 전체 밴드 표, 타깃 지정 시에만 샘플별 요약+막대그래프, 엑셀/CSV/표 복사 |
| `results/export.ts` | xlsx(시트: 샘플별 요약, 밴드, 설정), CSV(BOM), TSV. 동적 import로 지연 로딩 |
| `calibration/CalibrationView.tsx` | 표준곡선 화면 — **어디에서도 렌더링하지 않음(숨김)** |
| `common.tsx` | `Icon`, `NumberSlider`(`help`·`extra` 슬롯), **`Help`(라벨 옆 ? 아이콘, 누르면 설명 팝업, fixed 위치)**, `Menu`(fixed 위치라 가로 스크롤 영역에서도 안 잘림), `Seg`, `Menu`, `Modal`, `useElementSize`, `copyText`(HTTP에서도 되는 클립보드 복사), `pickFiles` |
| `render.ts` | LUT 렌더(`renderToImageData`, `sourceFor` — 화면용 블러는 여기서 캐시해 적용), 썸네일, 숫자 포맷 |
| `colors.ts` | 오버레이 색(선택 레인 파랑 `#0a7cff`, 레인 자홍 `#e5007d`, 밴드 주황 `#ff8a00`) |
| `styles.css` | 전체 스타일(라이트/다크 CSS 변수) |

### tests/
| 파일 | 내용 |
|---|---|
| `core.test.ts` | 34개(+화면용 가우시안 블러 3개): Whittaker 솔버, 베이스라인 면적 회수, 2D 배경, 합성 겔(극성·레인·선형성), 16-bit TIFF, 실제 겔(레인 7개), 밴드 기울기, 수동 바닥선, SHA-256, 표준곡선, 정규화 |
| `fixtures/gel16.tif` | 합성 16-bit TIFF (저장소 포함) |
| `fixtures/real-gel.png` | **사용자가 대화에 첨부한 실제 SDS-PAGE 사진**(사다리 + 시료 6레인). gitignore. 없으면 해당 테스트 skip |

---

## 3. 실행 방법

```bash
npm ci
```

```bash
npm run dev
```
- 기본 포트는 Vite 기본값 **5173**. (`index.html`을 파일로 열면 개발 서버가 아니라 `Densi-assist.html`로 이동함)

```bash
npm run check
```
- 타입 검사 + 테스트 + 빌드(`dist/` 생성 + `Densi-assist.html` 갱신). `dist/`는 gitignore.

| 명령 | 결과 |
|---|---|
| `npm test` | Vitest 34개 (real-gel.png 없으면 33 통과 + 1 skip) |
| `npm run build` | `dist/`(웹 배포용, 상대 경로) + `Densi-assist.html`(루트와 `dist/` 양쪽) |
| `npm run build:standalone` | `Densi-assist.html`만 |
| `npm run preview` | `dist/` 미리보기 |
| `BASE_PATH=/경로/ npm run build` | 특정 하위 경로로 고정 빌드 (PowerShell: `$env:BASE_PATH="/경로/"; npm run build`) |

### `.claude/launch.json` (Claude 데스크톱 앱의 미리보기 패널용)
gitignore 대상이라 새 컴퓨터에는 없다. 필요하면 아래 내용으로 다시 만든다.
```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "densi-dev", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev", "--", "--port", "5178", "--strictPort"], "port": 5178 },
    { "name": "densi-preview-subpath", "runtimeExecutable": "npm", "runtimeArgs": ["run", "preview", "--", "--port", "5179", "--strictPort", "--base", "/tools/densi-assist/"], "port": 5179 }
  ]
}
```
- `densi-dev`: 개발 서버를 **5178**로 고정 실행
- `densi-preview-subpath`: 빌드된 `dist/`를 `/tools/densi-assist/` 하위 경로로 띄워 홈페이지 하위 경로 탑재를 흉내 냄(먼저 `npm run build` 필요). 이 방식으로 워커 로드와 데모 분석이 되는 것을 확인함

---

## 4. 현재 구현 상태

### 작동 확인된 기능 (브라우저에서 직접 확인 또는 테스트)
- 이미지 올리기(드래그앤드롭/버튼, 여러 장): TIFF 8/16/32-bit·멀티페이지·WhiteIsZero·팔레트, PNG 16-bit, JPG/BMP. 극성 자동 추천
- 레인 자동 검출: 합성 겔(5레인, 중심 ±3px), 16-bit TIFF(6레인), 사용자 실제 겔(사다리 포함 7레인, 간격 균일)
- 레인 그리기/클릭 추가, **도구 전환 없이 바로 끌어 이동, 테두리로 상하좌우 크기 조절**(끄는 쪽만 이동, "모든 레인 크기를 같게"면 폭 동기화)
- 밴드 자동 검출, 그리기(이미지 위아래 / 그래프 좌우), 끌어서 이동, 테두리 조절, Delete 삭제
- **밴드 기울기**: 양 끝 동그라미 드래그(좌·우 모두) 또는 숫자 입력 → 기울인 프로파일로 면적 재계산, 그래프 검은 선도 변경
- 베이스라인 7종 선택(겔 전체/레인별), **수동(밴드 시작·끝점)**: 그래프 동그라미 드래그(가로=위치, 세로=높이), 오른쪽 클릭=자동 높이로. "수동으로 다듬기"
- 2D 배경 제거(rolling ball / paraboloid), 이미지 보정(감마·부드럽게: 슬라이더 옆 "측정에도 적용" 체크, 기본 켜짐. 감마가 1이 아니면 결과·엑셀에 비선형 표시), 이미지 붙여넣기(Ctrl+V·버튼), 화면 구조(이미지 띠 위·패널 왼쪽)·? 도움말
- 원본 이미지 보기(체크/O 키), 확대·축소·맞춤·1:1
- 결과 탭: 전체 밴드 표, 샘플별 요약(타깃 지정 시), 기준 샘플 상대값, 막대그래프, 엑셀/CSV/표 복사
- 합성 데모의 정량 정확도: 정답 상대값 1/1.44/2.93/3.77 → 측정 1/1.45/2.96/3.84 (v0.1 시점 확인)
- 자동 저장(IndexedDB)·재시작 후 복원, `.densi` 프로젝트 파일 저장/열기, 실행취소/다시실행
- 웹 빌드를 하위 경로(`/tools/densi-assist/`)에서 실행 — 워커 로드·데모 분석 확인
- **단독 실행판**: Edge·Chrome headless로 `file:///…/index.html` 열기 → `Densi-assist.html` 이동 → TIFF 추가 → 레인 6·밴드 12 검출 → 결과 12행 → `.densi` 저장·다시 열기 → 재시작 후 복원. `Densi-assist.html`에서는 콘솔 오류 없음(2026-09-27 새 PC에서 재확인)
- 깨끗한 복사본(저장소에 들어갈 53개 파일만)에서 `npm ci && npm run check` 통과

### 불완전한 기능
- **표준곡선**: 코드(`core/calibration.ts`, `ui/calibration/CalibrationView.tsx`, `hooks.ts`의 `evaluateCalibration`)는 동작하지만 화면에서 숨김(사용자 요청 "일단 없애자"). 데모 프로젝트는 여전히 숨겨진 표준곡선을 만든다
- **로딩 컨트롤 정규화**: `summarize`는 지원하지만 결과 화면이 `null`을 넘겨 사용 안 함 [Claude 판단: "결과 탭 더 간단하게" 요청에 맞춰 제거]. 데이터 모델의 `isLoadingControl`, `settings.loadingControlId`는 남아 있음
- 숨긴 베이스라인 9종(valley, minimum, lane-edge, AsLS, airPLS, arPLS, psalsa, ModPoly, IModPoly): 코드·테스트는 있고 화면 목록에서만 빠짐. 예전 프로젝트가 쓰던 방법이면 목록에 함께 보임
- `preprocess.rotate90`, `flipH`: 데이터 모델에 있으나 **UI 제거됨**(사용자 요청). 가로 레인 이미지는 올리기 전에 회전해야 함
- 사용자 매뉴얼에 스크린샷 없음

### 알려진 버그·한계
- 2D paraboloid의 ImageJ `correctCorners`(모서리 보정) 미포팅 → 모서리 값이 ImageJ와 다를 수 있음
- Top-hat, 이동 중앙값 베이스라인은 배경 기울기가 급하면 면적을 과소평가(테스트로 확인, 설명 카드에 명시)
- 수동 베이스라인은 직선 → Rolling ball에서 "수동으로 다듬기"로 바꾸면 면적이 약 5% 달라질 수 있음(실제 겔 레인 4 밴드 2: 4,507 → 4,751)
- 레인은 세로 직사각형만(곡선 레인 없음). 미세 회전(±10°)만 가능
- 실제 이미지로 **ImageJ와 수치 대조는 아직 안 함**
- 용어 혼용: 일부 UI에 "겔"이 남아 있음(예: "겔 전체 복사" 버튼, 그리드의 "모든 겔 자동 분석"). 사용자는 왼쪽 목록을 "이미지"로 바꾸라고만 요청함
- `docs/DESIGN.md` 일부가 현재 화면과 다름(2장 참고)
- 대형 이미지(6000×4000 이상) 성능 미검증
- `file://`에서 IndexedDB 자동 저장은 Edge·Chrome에서 확인. 다른 브라우저나 파일 경로를 옮겼을 때 저장 내용이 유지되는지는 **확실하지 않음**
- 포화 표시: 빨간 표시·체크박스는 제거했으나 "포화" 배지와 경고 문구는 남아 있음(7장 미결)
- `index.html`을 파일로 열면 `Densi-assist.html`로 이동하기 직전에 `/src/main.tsx` 로드 실패 콘솔 오류 2건이 찍힘(동작 영향 없음, 2026-09-27 발견, 미수정)
- 화면 문구에 숨긴 기능·외부 제품명이 일부 남아 있음: 첫 화면·도움말의 "로딩 컨트롤", 데모 알림의 "표준 5점", 베이스라인 설명의 "Bio-Rad Image Lab"(2026-09-27 발견, 미수정)

- 이미지 붙여넣기: Chromium에서 클립보드 이벤트를 흉내 낸 시험만 함. **실제 Ctrl+V, 붙여넣기 버튼의 권한 팝업, Firefox·Safari 동작은 미확인**. `file://`로 연 단독 실행판에서는 버튼이 보안 규칙상 막힐 수 있고 그 경우 Ctrl+V 안내 토스트가 뜸
- 부드럽게를 측정에 적용하면 좁은 밴드 면적이 줄어듦(사다리 밴드 예: 1.5px에서 −3~6%). 넓은 밴드는 ~1.5%
- 4-bit 디더링 같은 열화 이미지는 블러로 보기만 좋아질 뿐 정량 정확도는 원본 TIFF에 못 미침

### 개발 중 겪은 함정 (다시 밟지 말 것)
- **immer draft는 `structuredClone` 불가**(DataCloneError로 변경 전체가 조용히 무시됨) → `cloneSpec` 사용. 이 버그로 "베이스라인 방법이 안 바뀌는" 문제가 있었음
- **뷰포트 `setPointerCapture`가 위에 뜬 버튼 클릭을 삼킴** → `ImageView.onPointerDown`에서 `.banner, .hud, .view-controls, .orig-toggle` 대상은 제외
- **SVG 그리는 순서**: 레인 사각형을 먼저, 밴드를 위에, 기울기 손잡이는 모든 레인 뒤(맨 위)에 그려야 클릭됨
- `newBand(start, end, { id: undefined })`가 id를 지워버리던 버그 → 필드별 `??` 기본값으로 수정됨
- **`file://`에서는 모듈 워커(type: module)가 막힘**(Edge·Chrome 확인) → 단독 실행판은 `worker.format: 'iife'` + inline
- 단독 실행판 합치기를 `generateBundle`에서 하면 `__VITE_PRELOAD__ is not defined` 오류 → `closeBundle`에서 디스크 파일로 합침
- HTTP(비보안) 페이지에서는 `crypto.subtle`, `navigator.clipboard`가 없음 → 대체 코드 있음
- 브라우저 콘솔에서 `import('/src/...')`로 모듈을 불러 테스트하면, HMR 이후 **앱과 다른 모듈 인스턴스(다른 store)** 를 잡을 수 있음 → 페이지 새로고침 후 테스트하거나, `window`에 `drop` 이벤트를 보내는 등 실제 UI 경로로 테스트
- **클라우드 세션에서 `npm ci`가 403**이면 환경 네트워크 허용 목록에 `cdn.sheetjs.com`(xlsx 설치 주소)이 없는 것. 환경 설정에서 추가해야 함
- **`main` 직접 푸시 불가**: 브랜치 → PR → squash 병합. squash 병합 후에는 같은 브랜치 이름을 재사용하지 말고 `origin/main`에서 새 브랜치를 땀(강제 푸시는 차단됨)
- 보안: 저장소가 공개이므로 사용자 실험 이미지(`real-gel.png`, 붙여넣은 이미지 등)를 커밋하지 말 것. 문서용 그림은 합성 이미지로 만든다
- Windows PowerShell 5.1의 `Get-Content`/`Set-Content`는 기본 인코딩이 ANSI라 **한글 주석이 깨짐** → 파일 수정은 편집 도구로, 부득이하면 `[System.IO.File]::WriteAllText(path, text, New-Object System.Text.UTF8Encoding $false)`

---

## 5. 확정된 설계 결정과 근거

| 결정 | 근거 | 출처 |
|---|---|---|
| React + TypeScript + Vite | 사용자가 선택지 중 선택 | 사용자 |
| 모든 이미지 형식 지원 | 사용자가 "모든 이미지" 선택 | 사용자 |
| 구현 전 조사 → `docs/RESEARCH.md` | 사용자 요구 | 사용자 |
| 여러 이미지를 한 프로젝트·한 창에서 | 사용자 요구 | 사용자 |
| 이름 Densi-assist | 사용자 요구 | 사용자 |
| 도구 순서 ① 선택 › ② 레인 › ③ 밴드, Auto는 각 도구의 하위 버튼 | 사용자 요구 | 사용자 |
| 도구 선택 시 오른쪽 패널 해당 항목만 펼침, 처음엔 모두 접힘 | 사용자 요구 | 사용자 |
| 레인·밴드를 그린 도구 그대로 바로 이동·크기 조절 | 사용자 요구 | 사용자 |
| 밴드별 기울기, 기울기에 따라 그래프 선 변경 | 사용자 요구 | 사용자 |
| 수동 베이스라인 = 밴드별 시작·끝점 동그라미 | 사용자 요구 | 사용자 |
| 베이스라인 화면 목록 7종(없음, 수동, 롤링볼 계열 3, 평활 2) | 사용자 요구 | 사용자 |
| 방향(90° 회전·좌우 반전) UI 제거 | 사용자 요구 | 사용자 |
| 로딩 컨트롤을 밴드·타깃 패널에서 제거 | 사용자 요구 | 사용자 |
| 밴드 표에서 타깃 칸·⋯ 메뉴 제거, 표 복사 추가 | 사용자 요구 | 사용자 |
| 포화 빨간 표시·체크박스 제거 | 사용자 요구 | 사용자 |
| 원본 이미지 보기 체크 | 사용자 요구 | 사용자 |
| 왼쪽 목록 "이미지 N" | 사용자 요구 | 사용자 |
| 표준곡선 화면 제거(일단) | 사용자 요구 | 사용자 |
| index.html 더블클릭으로 실행 | 사용자 요구 | 사용자 |
| 이름 통일(2026-09-27): 폴더 `Densi-assist`, 프로젝트 파일 확장자 `.densi`, 형식 ID `densi-project/1`. **옛 `.densito` 파일과 옛 형식 ID의 브라우저 자동 저장본은 열지 않음**(호환 없이 완전 교체) | 사용자가 "완전 교체"를 선택 | 사용자 |
| **감마·부드럽게는 슬라이더 옆 "측정에도 적용" 체크로 정량 반영, 기본 모두 켜짐**(2026-11-27 변경: 이전에는 표시 전용이 기본이었음). 감마 적용은 **감마만** 0~최대값 기준으로 변환하고(감마 1이면 무변환), 감마가 1이 아닐 때만 결과·엑셀에 비선형 표시. 부드럽게는 측정 신호용 이미지에만 블러(포화 판정·표시용 `raw`는 원본) | 사용자: "부드럽게 된 이미지를 실제로 읽어야 한다", "기본은 다 체크". 단 감마는 비선형이라 비율을 왜곡하므로 표시를 남김 | 사용자 |
| **"화면 밝기"(히스토그램·표시 범위 세로선·자동 대비·초기화) 제거** — 표시 범위는 이미지 추가 시 자동 계산값을 화면 전용으로만 사용 | 사용자: "감마로 충분히 대체 가능" | 사용자 |
| 화면 구조: 이미지 목록 = 맨 위 가로 띠(작게), 설정 패널 = 왼쪽, 가운데 = 이미지·그래프 | 사용자 요구(2026-11-27) | 사용자 |
| **작업 순서 스텝바**: ① 이미지 준비 › ② 레인 › ③ 밴드 › ④ 결과를 큰 버튼(번호 원+이름+한 줄 설명, 끝낸 단계는 초록 ✓, 현재는 파란 채움)으로 이미지 띠 아래 전체 폭에 표시. 오른쪽에 "지금 할 일" 한 줄과 파란 **다음** 버튼·← 이전. "선택" 도구 이름 폐지(내부 `tool: 'select'`는 ① 이미지 준비와 동일) | 사용자 승인(목업) + "직관적으로 눌러야 하는 줄 알게" | 사용자 |
| ① 이미지 준비 화면(밝은 배경·흰 카드, 이미지 칸은 가득 채움; 파일 정보는 아래 한 줄로만, "배경 제거된 이미지로 보기" 체크는 배경 제거 항목 안으로 이동, 초기에는 ① 이미지만 펼침) = 원본(`raw`)과 "보정 후"(`signal`에 감마·부드럽게·배경 제거 반영, **표시는 원본과 같은 모습으로 다시 뒤집음** — 사용자가 "반전해서 보이면 헷갈린다"고 해서 2026-11-27 변경. 밴드 색은 계산에만 쓰이고 이 화면에서는 눈에 안 보임) 나란히. 초기에 ① 이미지 항목만 펼침(`openSections: ['image']`) | 설정 효과가 안 보인다는 지적 | 사용자 승인(목업) |
| 설정 패널의 긴 설명 글은 라벨 옆 **? 아이콘 팝업**으로 | 사용자 요구: 화면 간소화 | 사용자 |
| 라벨: "부드럽게 (노이즈 제거)", "감마 (밝기 조절)" | 사용자 요청(부드럽게). 감마 쪽은 밝기 UI를 없애서 | 사용자 / 감마 라벨은 [Claude 판단] |
| 이미지 붙여넣기(Ctrl+V, 붙여넣기 버튼). 글자 붙여넣기는 가로채지 않음. 클립보드 이름 `image.png`는 `붙여넣은 이미지 YYYYMMDD-HHMMSS`로 변경 | 사용자 요청 | 사용자 |
| 저장소 공개 + GitHub Pages 배포(`https://rundope.github.io/Densi-assist/`, 대소문자 구분) | 사용자가 URL로 바로 쓰기를 원함. 비공개는 무료 요금제에서 Pages 불가 | 사용자 |
| 이미지는 서버로 보내지 않음(전부 브라우저) | 연구 데이터 보안, 정적 호스팅 가능 | [Claude 판단] |
| 레인 창 크기 등 % 레인 길이 단위, Whittaker λ 1000점 기준 환산 | 해상도가 달라도 같은 설정이 비슷하게 동작 | [Claude 판단] |
| 면적 = Σ(profile − baseline), 음수는 기본 0으로 | GelAnalyzer raw volume 방식, ImageJ의 래스터 면적보다 정밀 | [Claude 판단] |
| 타깃 지정 = 밴드 선택 후 타깃 칩 클릭(같은 높이 밴드 일괄) | 표에서 타깃 칸을 빼라는 요청과 결과 요약 기능을 양립 | [Claude 판단] |
| 결과 탭에서 로딩 컨트롤 정규화·값 종류 선택 제거 | "결과 탭 더 간단하게" 요청 해석 | [Claude 판단] |
| 레인·밴드 색(파랑/자홍/주황 + 그림자) | "흰 배경에서 잘 보이게" 요청의 구체화 | [Claude 판단] |
| 1:1 버튼, O 단축키, Delete 삭제, 실행취소 | 편의 | [Claude 판단] |
| 실험 이미지 `real-gel.png`는 gitignore | 회사 보안 발언에 따른 기본값 | [Claude 판단] |
| `license: UNLICENSED` | 사내 전용 기본값 | [Claude 판단] |
| `Densi-assist.html`을 저장소에 포함 | 받은 저장소를 바로 더블클릭 실행 가능하게 | [Claude 판단] |
| 상대 경로 빌드(`base: './'`) | 홈페이지 어느 하위 경로에도 탑재 가능 | [Claude 판단] |
| HTTP 대체 코드(SHA-256, 클립보드) | 사내 홈페이지가 HTTP일 가능성 | [Claude 판단] |
| xlsx를 SheetJS CDN tarball에서 설치 | npm의 구버전(0.18.5)에 보안 공지가 있어서 | [Claude 판단] |

---

## 6. 사용자가 요구했지만 아직 안 된 것

- **GitHub 업로드**: 완료(2026-11-27 기준 저장소 `rundope/Densi-assist`에 `main` 존재, CI 통과). Pages는 비공개 저장소 제약으로 보류(위 0장). 공개 전환 여부는 7장 5번과 묶인 미결. 이전 기록: 새 PC(2026-09-27)에서 `git init`까지 했고 사용자는 Claude 앱 내장 브라우저에 GitHub 계정(rundope)으로 로그인해 둠(방법은 `docs/DEPLOY.md`)
- **홈페이지 탑재**: 빌드·가이드(iframe 예시 포함)만 준비. 실제 탑재 안 함. 홈페이지 주소·경로·HTTPS 여부 모름
- 사용자가 "매뉴얼 작성할 때 … 순서로 처리한다는 것을 알려주면 좋겠다"고 한 것은 `docs/USER_MANUAL.ko.md`(및 영어·일본어·중국어 간체판)에 반영했으나, **스크린샷은 없음**
- 그 밖에 사용자가 명시적으로 요구했는데 누락된 기능은 확인되지 않음(확실하지 않은 부분은 7장)

---

## 7. 미결 쟁점 (사용자가 결정해야 함)

1. **포화 표시 완전 제거 여부**: 사용자 말 "포화픽셀은 … 빨간색으로 안 나오게, 이걸 체크하는 것도 없애줘"를 "빨간 표시 + 체크박스 제거"로 해석함. 밴드 옆 "포화" 배지와 경고 한 줄은 남겨 둠. 이것도 뺄지 두 번 물었으나 답 없음
2. **결과 탭 로딩 컨트롤 정규화**: 이전 Claude가 간소화하면서 제거함. 다시 필요한지
3. **타깃 지정 방식**(밴드 선택 후 칩 클릭): 사용자 확인 받지 않음
4. **표준곡선 재도입 시점**
5. **라이선스**(현재 UNLICENSED)와 **저장소 공개/비공개**
6. **`Densi-assist.html`을 저장소에 넣을지**(빌드 산출물이라 코드와 어긋날 수 있음 — 수정 후 `npm run build` 필요)
7. **홈페이지 탑재 방식**: 웹서버 하위 경로 / iframe / GitHub Pages / 단독 파일 배포 중 무엇으로 할지, 서버 HTTPS 여부
8. **회사 방화벽**: `cdn.sheetjs.com` 차단 시 `npm ci` 실패 → 허용 요청 또는 다른 엑셀 라이브러리로 교체 필요
9. UI 용어 "겔" vs "이미지" 통일 범위
10. ~~단계 이름·구조 개편~~ → 2026-11-27 구현 완료(스텝바 + 이미지 준비 화면). 남은 점: 위쪽 분석/결과 탭과 4단계 "결과"가 중복됨(탭 유지 가정), 슬라이더 겹쳐 보기는 제외, 배경 제거는 ① 이미지 준비 묶음 안으로 옮김(번호 ②는 그대로)
11. **밝기 단계 수 경고**: 업로드 이미지의 고유 회색 단계 수가 적으면(예: 파워포인트 복사로 4-bit 디더링) 경고. 승인 대기
12. **검색 노출**: `index.html`에 meta description/Open Graph를 넣을지, `noindex`로 막을지(회사 보안과 연동). 나중에 하기로 함
13. **git 이력의 옛 PC 경로**: 현재 파일에서는 일반 표기로 바꿨으나 첫 커밋 이력에는 남아 있음(저위험, 지우려면 이력 재작성 필요)

---

## 8. 미승인 제안 (이전 Claude가 제안했으나 사용자가 승인하지 않음 — 결정 사항 아님)

- 실제 블롯 원본 TIFF로 **ImageJ Gel Analyzer / Subtract Background와 수치 대조** (여러 번 제안, 사용자가 TIFF 제공 안 함)
- **분자량(MW) 보정**(마커 레인 Rf → MW 곡선)
- 매뉴얼을 링크로 공유할 수 있는 **웹 페이지 버전**으로 게시
- 더블클릭 실행용 `.bat` 파일 — 단독 실행판(`Densi-assist.html`)으로 대체되어 사실상 불필요
- `docs/DESIGN.md` §9의 항목: 곡선/기울어진 레인, paraboloid `correctCorners` 포팅, 대형 이미지용 WebGL·다운샘플, 서버 저장·팀 공유
- 아래 9장의 headless `file://` 검증 스크립트를 저장소에 테스트로 추가 (이번 문서 작성 중 생각한 것)
- 매뉴얼 스크린샷 추가(`docs/images/`)

---

## 9. 환경 의존성 (이 컴퓨터에만 있거나 다른 컴퓨터에서 깨질 수 있는 것)

| 항목 | 이 컴퓨터 값 | 다른 컴퓨터에서 |
|---|---|---|
| 프로젝트 경로 | `<이전 PC 경로>/Densito-assist` (폴더명은 옛 이름 "Densito", 앱 이름은 "Densi-assist"). 새 PC에서는 `<새 PC>/Densi-assist`로 폴더 이름도 바꿈(2026-09-27) | 코드에는 절대 경로 없음. `docs/DEPLOY.md`의 zip 경로는 새 PC 기준(`<새 PC 작업 폴더>\…`)으로 고침 |
| OS / 셸 | Windows 11, PowerShell 5.1 | 한글 인코딩 함정 주의(4장) |
| Node / npm | v24.15.0 / 11.12.1 (새 PC: v24.21.0 / 11.19.0) | `.nvmrc`는 22, `engines`는 ≥20.19. Vite 8은 Node 20.19+ 필요. 새 PC에서는 Claude 앱을 켠 뒤 Node를 설치해서 앱을 다시 시작해야 미리보기(`launch.json`)가 `npm`을 찾음 |
| TypeScript / Vite / Vitest | 7.0.2(네이티브) / 8.3 / 5.0 — 매우 최신 | `tsc -b` 대신 `tsc --noEmit -p .` 사용(스크립트에 반영됨) |
| Git | **설치 안 됨** (새 PC: Git 2.55 설치됨, `git init -b main` 완료, 커밋 없음) | Claude Code의 Bash 도구는 Git Bash로 동작 |
| xlsx 설치 주소 | `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` | 방화벽에 막히면 `npm ci` 실패 |
| `.claude/launch.json` | 있음 | gitignore → 새로 만들어야 함(3장에 내용) |
| `tests/fixtures/real-gel.png` | 있음(사용자 첨부 실제 이미지) | gitignore·zip 제외 → 없으면 테스트 1개 skip. 원본은 이전 대화 첨부 파일 `<이전 PC 임시 폴더>/images/1.png` (임시 폴더라 사라질 수 있음). 회사 실험 데이터이므로 외부 저장소에 올리지 말 것 |
| 옮기기용 zip | `<이전 PC>/densi-assist-source-0.3.0.zip` (새 PC: `<새 PC>/Densi-assist.zip`, 2026-09-27 다시 만듦. 같은 폴더의 `Densito-assist.zip`은 사용자가 옮겨 올 때 만든 옛 전체 압축본). 프로젝트 **바깥**에 둠(`*.zip`은 gitignore). 내용 = Git에 올라갈 파일과 같음(`HANDOFF.md`, `CLAUDE.md` 포함). `node_modules`, `dist`, `.claude/`, `real-gel.png`는 제외 | 압축을 풀면 `Densi-assist/` 폴더가 생김 → 그 안에서 `npm ci`. 이후 코드를 고치면 zip은 낡으므로 폴더를 옮기거나 다시 만들 것 |
| headless 검증 스크립트 | `<이전 PC 임시 폴더>/scratchpad/filetest.mjs` (임시 폴더, **이관 안 됨**) | 방법: `msedge.exe`/`chrome.exe`를 `--headless=new --remote-debugging-port=<포트> --user-data-dir=<임시>`로 `file:///…/index.html`을 열고, Node 내장 `WebSocket`으로 CDP(`Runtime.evaluate`)에 접속해 `window`에 `DragEvent('drop')`로 `gel16.tif`를 넣은 뒤 `.step-tool`/`.subtools` 버튼 클릭 → `.gel-item .meta`가 "6 레인 12 밴드", 결과 표 12행인지 확인 |
| 브라우저 경로(이 PC) | Edge `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe` (새 PC: Edge만 있음, Chrome 없음) | 다름 |
| auto memory | `<이전 PC>/.claude/projects/<프로젝트>/memory/` (새 PC: `<새 PC>/.claude/projects/<프로젝트>/memory/`, 아직 비어 있음) | 폴더를 옮기면 사라짐 → 10장 |
| Claude 데스크톱 앱 전용 도구 | 미리보기 브라우저 패널(`preview_start` 등) 사용 | 다른 환경에서는 없을 수 있음. 브라우저 패널은 `file://`을 정적 스냅샷으로만 보여 줘서 단독 실행판 검증에 못 씀 → headless 방식 사용 |
| IndexedDB 자동 저장 데이터 | 이 PC 브라우저에 테스트 프로젝트("새 프로젝트", 실제 겔 1장)가 남아 있음 | 옮겨지지 않음(필요하면 앱에서 `.densi`로 저장해 옮김) |

---

## 10. auto memory 이관 (이전 세션이 저장한 메모리 전체)

위치: `<이전 PC>/.claude/projects/<프로젝트>/memory/` — 파일 2개.

**`MEMORY.md`**
```
- [Densito project goals](densito-project-goals.md) — web densitometry app: research-first, multi-gel, calibration, unobtrusive UX
```

**`densito-project-goals.md`** (2026-09-17 저장, 원문 그대로)
```
---
name: densito-project-goals
description: "Densito Assist product goals and user's working preferences (research-first, multi-gel, calibration, friendly UX)"
metadata:
  node_type: memory
  type: project
  originSessionId: 3c01a325-6a5f-4ad0-8772-0577523ce83c
  modified: 2026-09-17T08:51:26.930Z
---

Densito Assist (<이전 PC 경로>/Densito-assist) is a browser-based gel/western blot densitometry web app (ImageJ Gel Analyzer alternative), Korean UI. v0.1 built 2026-09-17: React+TS+Vite, 16 baseline methods, ImageJ rolling-ball port, multi-gel projects, calibration curves, xlsx export.

**Why:** The user wants consistent, user-controllable quantification (baseline choice, gamma/background control) and to measure many gels from one project in one window, plus optional calibration curves from concentration series — without these extras getting in the way of measuring.

**How to apply:** The user asked to research existing software/algorithms (ImageJ etc.) before building; keep doing research-first for new algorithm features and record sources in docs/RESEARCH.md. Keep secondary features (results, calibration) in separate tabs; keep display adjustments (gamma) out of quantification. See docs/DESIGN.md §9 for open items.
```

> 주의: 이 메모리는 v0.1 시점이라 일부가 오래됨 — 이름은 이제 **Densi-assist**, 화면의 베이스라인은 **7종**, 표준곡선은 **숨김**. 새 컴퓨터에서 메모리를 다시 만들 때는 이 문서(HANDOFF.md) 기준으로 갱신할 것.

### 이전 대화에서 확인된 사용자 작업 방식 (메모리에는 없지만 대화에서 확인됨)
- 요청을 여러 개 한꺼번에 길게 보내고, 결과를 직접 써 보며 불편한 점을 구체적으로 지적하는 방식으로 진행함
- 화면이 "정신없는" 것을 싫어하고 **단순화·영역 구분·순서가 보이는 UI**를 원함
- 설명은 쉽게, ImageJ 같은 외부 제품 언급은 UI 문구에서 빼기를 원함
- 버튼이 "눌러도 아무 반응이 없다"를 여러 번 지적함 → **UI 변경 후에는 실제 클릭으로 검증**할 것
- 회사 보안을 신경 씀(GitHub 연동 불가, 실험 이미지)

---

## 11. 게시된 아티팩트 URL

없음. 이전 세션에서 Artifact(claude.ai 페이지)를 게시한 적이 없다.

---

## 부록 A. 작업 이력 (이전 대화의 흐름)

| 날짜 | 단계 | 사용자 요청 → 결과 |
|---|---|---|
| 09-17 | 설계 | 첫 요청(ImageJ 같은 덴시토메트리, 감마·롤링볼·자유 베이스라인, 일관성) → 사용자가 "설계 문서만", React+TS+Vite, 모든 이미지 형식 선택 → `docs/DESIGN.md` 초안 |
| 09-17 | v0.1 | "조사 먼저, 베이스라인 여러 개 선택, 여러 겔 한 창, 표준곡선(엑셀식 입력), 방해 안 되게, 최대한 완성도" → `docs/RESEARCH.md`, 전체 앱 구현(베이스라인 16종, 결과·표준곡선 탭, 데모) |
| 09-21 | 문의 | "index.html 열면 빈 화면" → 개발 서버 필요 설명 |
| 09-21 | v0.2 | 이름 변경, 버튼 무반응(포인터 캡처 버그) 수정, 도구 1·2·3 번호, 안내창 왼쪽 위, 색 변경, 패널 접힘, 감마 옵션, 포화 표시 제거, **밴드 기울기**. 실제 겔 사진으로 레인 검출 재작성, 밴드 id 버그 수정 |
| 09-21 | v0.3-a | Auto를 레인/밴드 하위 버튼으로, 그린 뒤 바로 이동·크기 조절, 도구↔패널 연동, 패널 단순화, 베이스라인 7종만 표시, **베이스라인 방법 변경 안 되던 버그(structuredClone) 수정**, 로딩 컨트롤 제거, 밴드 표 단순화·표 복사 |
| 09-21 | v0.3-b | 단계 버튼 강조, 드래그 시 글자 선택 방지, 오른쪽 기울기 손잡이 수정, **수동 베이스라인 = 밴드 시작·끝점**, 기울기에 따라 그래프 선 변경 |
| 09-21 | v0.3-c | 원본 이미지 보기, "이미지" 명칭, 결과 탭 단순화, 표준곡선 숨김 |
| 09-21 | 배포 준비 | GitHub 준비(CI·Pages·gitignore·zip), `docs/USER_MANUAL.md`, `docs/DEPLOY.md`, HTTP 대체 코드 |
| 09-21 | 단독 실행판 | "index.html 열면 쓸 수 있게" → `Densi-assist.html`(file://에서 모듈 워커 차단 문제 해결), Edge·Chrome headless 검증 |
| 09-21 | 정리 | 폴더 정리(dist·중간 산출물 삭제, 설정 파일 통합, `.editorconfig` 삭제, zip을 프로젝트 밖으로) |
| 09-26 | 인수인계 | 이 문서와 `CLAUDE.md` 작성 |
| 09-26~27 | 새 PC 이관 | 새 PC(`<새 PC 작업 폴더>`)에서 환경 점검 → Node 설치 → 테스트·개발 서버·단독 실행판·하위 경로 재확인. 폴더를 `Densi-assist`로 바꾸고 이름 통일(`.densi`, `densi-project/1`, 옛 형식 호환 없음) |
| 09-27 | 배포 준비 2 | 매뉴얼 4개 언어(ko/en/ja/zh-CN), zip 재생성(프로젝트 바깥), `.gitignore`에 `*.zip`, `git init`, 불필요 파일(`dist/`, 프로젝트 안 옛 zip) 삭제 |
| 11-27 | 클라우드 세션 | `cdn.sheetjs.com` 허용 후 검증 → 저장소 공개 + GitHub Pages 배포(`main` push 자동) → README 주소 → **이미지 붙여넣기**(Ctrl+V·버튼) → **화면 구조 변경**(이미지 띠 위, 패널 왼쪽) → **부드럽게(노이즈 제거)** 추가 → 부드럽게·감마 "측정에도 적용"(기본 켜짐) → ? 도움말 → "화면 밝기" 제거 → 이미지 메뉴 잘림 수정 → 매뉴얼 부드럽게 전/후 그림 |
| 11-27 | 구조 개편 | 목업 승인 → 스텝바(① 이미지 준비 › ② 레인 › ③ 밴드 › ④ 결과, 크고 눈에 띄게, 지금 할 일·다음 버튼) + ① 이미지 준비 화면(원본 vs 측정에 쓰이는 이미지) 구현, 매뉴얼 4개 언어 갱신 |

---

## 12. 새 세션의 첫 체크리스트

1. **설치와 검사**: `npm ci` → `npm run check`. 기대값: 타입 오류 0, 테스트 34개 중 33개 통과(`real-gel.png`가 없으면 1개 skip), 빌드 후 `Densi-assist.html` 갱신 로그. `npm ci`가 실패하면 먼저 `cdn.sheetjs.com` 접근 가능 여부 확인
2. **개발 서버로 화면 확인**: `npm run dev` → 첫 화면에서 "데모 프로젝트로 둘러보기" → 이미지 3장, 레인·밴드 표시, ① ② ③ 도구 버튼, 결과 탭이 나오는지. (Claude 데스크톱 앱을 쓰면 3장의 `.claude/launch.json`을 다시 만든다)
3. **단독 실행판 확인**: 탐색기에서 `index.html` 또는 `Densi-assist.html`을 더블클릭(Chrome/Edge) → 이미지 추가 → 레인 검출 (Auto) → 밴드 검출 (Auto)가 되는지
4. **Git 상태 확인**: 새 컴퓨터에서 저장소로 받았는지(`git status`), 아니면 폴더 복사인지. 이 PC에서는 Git 커밋이 한 번도 없었음. GitHub에 올렸다면 Actions의 CI 통과 여부
5. **사용자에게 7장 미결 쟁점부터 확인**한 뒤 새 작업 시작. 8장 제안은 승인 없이 진행하지 말 것. 새 알고리즘 기능은 사용자 선호대로 **조사 먼저**(`docs/RESEARCH.md`에 출처 기록)
