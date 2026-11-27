# Densi-assist

### 👉 [바로 사용하기: https://rundope.github.io/Densi-assist/](https://rundope.github.io/Densi-assist/)

겔·웨스턴 블롯 밴드의 진하기를 정량하는 웹 기반 densitometry 도구입니다.
**모든 처리는 브라우저 안에서 이루어지며, 이미지는 서버로 전송되지 않습니다.**

- **여러 이미지를 한 프로젝트에서**: 샘플 이름으로 이미지를 넘어 묶어 평균·표준편차와 상대값을 계산합니다.
- **레인·밴드 자동 검출**: 붙어 있는 레인과 사이즈 마커 레인도 찾고, 그린 뒤 바로 끌어서 조정합니다.
- **기울어진 밴드**: 밴드마다 기울기를 줘서 비스듬히 내려간 밴드를 따라 적분합니다.
- **베이스라인**: Rolling ball(기본), Top-hat, Rubber band, SNIP, 이동 중앙값, 수동(밴드별 시작·끝점).
- **이미지 전체 배경 제거**: rolling ball / sliding paraboloid (ImageJ Subtract Background와 같은 알고리즘).
- **원본 이미지 보기**: 레인·밴드 표시를 숨기고 원본과 번갈아 비교 (O 키).
- **재현성**: 모든 설정을 프로젝트 파일(.densi)에 저장하고, 엑셀 내보내기의 "설정" 시트에 기록합니다.
- 입력: TIFF (8/16/32-bit, 여러 페이지), PNG (16-bit 포함), JPG, BMP

## 바로 실행하기 (설치 없이)

폴더의 **`Densi-assist.html`** (또는 `index.html`)을 더블클릭하면 브라우저에서 바로 실행됩니다.
프로그램 전체가 이 HTML 파일 하나에 들어 있어서, 이 파일만 이메일·공유 폴더로 전달해도 됩니다.
Chrome 또는 Edge를 권장합니다.

> `Densi-assist.html`은 `npm run build`가 만드는 파일입니다. 코드를 고친 뒤에는 다시 빌드해야 반영됩니다.

## 사용 순서

```
이미지 올리기 → ① 선택 → ② 레인 → ③ 밴드 → 결과
```

| 단계 | 세부 동작 | 오른쪽 패널 |
|---|---|---|
| ① 선택 | 레인·밴드 고르기, 옮기기 | 이미지 (밴드 색, 화면 밝기) |
| ② 레인 | 레인 그리기 / 레인 검출 (Auto). 그린 레인은 바로 끌어서 이동, 테두리로 상하좌우 크기 조절 | 배경 제거, 레인 |
| ③ 밴드 | 밴드 그리기 / 밴드 검출 (Auto). 이미지는 위아래, 아래 그래프는 좌우로 드래그. 양 끝 동그라미로 기울기 | 베이스라인, 밴드·타깃 (표 복사) |

자세한 사용법은 **사용자 매뉴얼**을 보세요: [한국어](docs/USER_MANUAL.ko.md) · [English](docs/USER_MANUAL.en.md) · [日本語](docs/USER_MANUAL.ja.md) · [简体中文](docs/USER_MANUAL.zh-CN.md)
(앱 화면은 한국어입니다. 다른 언어판 매뉴얼은 화면 문구를 한국어 그대로 적고 번역을 함께 붙였습니다.)

## 개발

Node.js 22 이상 권장 (최소 20.19).

```bash
npm ci
```

```bash
npm run dev
```

브라우저에서 터미널에 표시된 주소(기본 http://localhost:5173)를 엽니다.
(`index.html`을 파일로 더블클릭하면 개발 서버 대신 단독 실행판 `Densi-assist.html`로 자동 이동합니다.)

| 명령 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm test` | 알고리즘 테스트 (Vitest) |
| `npm run typecheck` | 타입 검사 |
| `npm run build` | 배포용 빌드 → `dist/`, 그리고 단독 실행판 `Densi-assist.html` |
| `npm run build:standalone` | 단독 실행판만 다시 만들기 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run check` | 타입 검사 + 테스트 + 빌드 한 번에 |

처음 열면 "데모 프로젝트로 둘러보기"로 합성 겔 3장이 들어 있는 예제를 볼 수 있습니다.

## 바로 사용하기

### 방법 1. 웹 주소로 바로 열기 (권장)

**[https://rundope.github.io/Densi-assist/](https://rundope.github.io/Densi-assist/)** — 주소의 대소문자를 정확히 입력해야 합니다. `main`에 push되면 자동으로 갱신됩니다.

### 방법 2. 파일 하나 받아서 실행 (오프라인 가능)

1. 저장소 첫 화면에서 **[`Densi-assist.html`](Densi-assist.html)** 을 클릭
2. 파일 화면 오른쪽 위의 **다운로드 아이콘(Download raw file)** 클릭 (화면에서 바로 열면 코드 글자만 보이니 꼭 다운로드)
3. 받은 파일을 **더블클릭** → Chrome 또는 Edge에서 앱이 열림
4. 이미지를 끌어다 놓거나 "데모 프로젝트로 둘러보기"로 시작

새 버전이 나오면 같은 방법으로 다시 받으면 됩니다. 인터넷 연결 없이도 동작하며 이미지는 PC 밖으로 나가지 않습니다.

## 배포

빌드 결과는 서버 프로그램이 필요 없는 정적 파일이라 웹서버의 아무 하위 경로에 복사하면 됩니다.
GitHub 업로드, 홈페이지 탑재(iframe 포함), GitHub Pages는 **[배포 가이드](docs/DEPLOY.md)** 를 보세요.

## 폴더 구조

```
src/
  core/         정량 알고리즘 (React와 무관, 테스트 대상)
    io/           이미지 디코딩 (TIFF, PNG, JPG), SHA-256
    image/        회색 변환·회전·극성, 2D 배경 제거
    baseline/     베이스라인 알고리즘
    lanes.ts      레인 자동 검출
    bands.ts      밴드 검출과 면적
    profile.ts    레인 프로파일 (기울기 포함)
    results.ts    샘플별 요약
  engine/       Web Worker 이미지 처리, 캐시, 결과 계산
  state/        상태 관리(zustand), 저장·불러오기, 작업 동작
  ui/           화면 (analyze: 분석, results: 결과)
tests/          테스트와 테스트용 이미지
docs/           매뉴얼, 배포 가이드, 설계, 사전 조사
.github/        CI(검사·빌드), GitHub Pages 배포
```

## 문서

| 문서 | 내용 |
|---|---|
| [docs/USER_MANUAL.ko.md](docs/USER_MANUAL.ko.md) | 사용자 매뉴얼 (한국어) — [English](docs/USER_MANUAL.en.md), [日本語](docs/USER_MANUAL.ja.md), [简体中文](docs/USER_MANUAL.zh-CN.md) |
| [docs/DEPLOY.md](docs/DEPLOY.md) | GitHub 업로드와 홈페이지 탑재 |
| [docs/DESIGN.md](docs/DESIGN.md) | 설계, 구현 구조, 검증 결과 |
| [docs/RESEARCH.md](docs/RESEARCH.md) | ImageJ·상용 소프트웨어와 베이스라인 알고리즘 조사 |

## 라이선스

사내용 (UNLICENSED). 외부 공개 전 라이선스를 정하세요.
