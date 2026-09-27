# GitHub 업로드와 홈페이지 탑재 가이드

## 1. 저장소에 들어가는 것 / 빠지는 것

| 들어감 | 빠짐 (`.gitignore`) |
|---|---|
| `src/` 소스, `tests/` 테스트, `docs/` 문서(매뉴얼 4개 언어) | `node_modules/` (설치 시 다시 생김) |
| `README.md`, `HANDOFF.md`·`CLAUDE.md` (개발 인수인계) | `*.zip` (옮기기용 압축 파일) |
| `package.json`, `package-lock.json` | `dist/` (빌드 결과) |
| `index.html`, `vite.config.ts`, `tsconfig.json` | `.claude/` (로컬 개발 도구 설정) |
| `.github/workflows/` (자동 검사·배포), `Densi-assist.html` (더블클릭용 단독 실행판) | |
| `tests/fixtures/gel16.tif` (합성 테스트 이미지) | **`tests/fixtures/real-gel.png` (실제 실험 이미지 — 회사 보안)** |

실제 실험 이미지가 없으면 그 테스트 하나만 자동으로 건너뛰고, 나머지 테스트는 그대로 돕니다.

---

## 2. GitHub에 올리기

아래 중 편한 방법을 쓰세요. 이 폴더는 이미 `git init`과 `.gitignore` 확인까지 되어 있으므로, 방법 B에서는 커밋부터 하면 됩니다.

### 방법 A. GitHub Desktop (가장 쉬움, 권장)

1. [GitHub Desktop](https://desktop.github.com/)을 설치하고 로그인합니다.
2. **File → Add local repository** → 이 폴더(`Densi-assist`)를 고릅니다.
3. "This directory does not appear to be a Git repository"가 나오면 **create a repository** 를 누릅니다.
   - Name: `densi-assist`
   - Git ignore / License: **None** (이미 준비되어 있음)
4. 왼쪽 변경 목록에 `node_modules`, `dist`, `real-gel.png`가 **없는지** 확인합니다.
5. Summary에 `Initial commit` 입력 → **Commit to main**.
6. **Publish repository** → 회사 저장소라면 **Keep this code private** 체크 → Publish.

### 방법 B. Git 명령어

[Git](https://git-scm.com/download/win) 설치 후, 이 폴더에서 차례로 실행합니다.

```bash
git init -b main
```

```bash
git add .
```

```bash
git status
```

(`node_modules`, `dist`, `real-gel.png`가 목록에 없는지 확인)

```bash
git commit -m "Initial commit: Densi-assist 0.3"
```

GitHub 웹에서 빈 저장소(`densi-assist`, README 없이)를 만든 뒤:

```bash
git remote add origin https://github.com/<조직또는계정>/densi-assist.git
```

```bash
git push -u origin main
```

### 방법 C. 인터넷이 되는 다른 PC로 옮겨서 올리기

프로젝트 폴더 바깥(`E:\Claude\Densi-assist.zip`)에 저장소에 들어갈 파일만 묶어 두었습니다. 이 파일을 옮겨 압축을 풀면 `Densi-assist/` 폴더가 생기고, 그 폴더를 방법 A나 B로 올리면 됩니다. (실험 이미지와 `node_modules`는 들어 있지 않습니다.)

> GitHub 웹의 "Add file → Upload files"로도 올릴 수 있지만, 폴더 구조와 `.github` 같은 숨김 폴더가 빠지기 쉬워 권장하지 않습니다.

### 올린 뒤 확인

- 저장소의 **Actions** 탭에서 **CI** 가 초록색(통과)인지 확인합니다. 푸시할 때마다 타입 검사 → 테스트 → 빌드를 자동으로 돌립니다.
- 빌드 결과(`dist`)는 CI 실행 화면의 Artifacts에서 `densi-assist-dist` 로 내려받을 수 있습니다.

---

## 3. 홈페이지에 탑재하기

빌드 결과(`dist/`)는 **서버 프로그램이 필요 없는 정적 파일**(HTML·JS·CSS)입니다. 웹서버의 아무 폴더에나 복사하면 됩니다.

### 3-1. 빌드

```bash
npm ci
```

```bash
npm run build
```

`dist/` 폴더가 만들어집니다. 모든 경로가 상대 경로라서 **어느 하위 경로에 올려도** 동작합니다 (예: `https://회사홈페이지/tools/densi-assist/`). 실제로 `/tools/densi-assist/` 경로로 띄워 이미지 처리까지 되는 것을 확인했습니다.

특정 경로로 고정해야 하는 서버라면:

```bash
BASE_PATH=/tools/densi-assist/ npm run build
```

(Windows PowerShell에서는 `$env:BASE_PATH="/tools/densi-assist/"; npm run build`)

### 3-2. 웹서버에 올리기

`dist/` 안의 파일 전체를 웹서버 폴더(예: `/var/www/html/tools/densi-assist/`)에 복사합니다.

웹서버 요구 사항:

| 항목 | 내용 |
|---|---|
| HTTPS | 권장. 사내 HTTP 서버에서도 동작하도록 파일 해시 계산과 표 복사에 대체 방식을 넣어 두었음 |
| MIME 타입 | `.js` → `text/javascript`, `.css` → `text/css` (대부분 기본값) |
| 서버 측 코드 | 필요 없음 (DB·API 없음) |
| 캐시 | `assets/` 안 파일은 이름에 해시가 붙어 있어 길게 캐시해도 됨. `index.html`은 짧게 |

### 3-3. 홈페이지 안에 넣기 (iframe)

홈페이지의 한 페이지 안에 넣으려면:

```html
<iframe
  src="/tools/densi-assist/"
  title="Densi-assist"
  style="width: 100%; height: 90vh; border: 0;"
  allow="clipboard-write">
</iframe>
```

- `allow="clipboard-write"`: 결과 "표 복사" 버튼이 동작하게 합니다.
- 같은 도메인에 올리는 것을 권장합니다. 다른 도메인이면 브라우저 설정에 따라 자동 저장(IndexedDB)이 막힐 수 있습니다.
- 화면이 넓을수록 편합니다 (권장 가로 1200px 이상). 가능하면 새 창 링크도 함께 두세요.

### 3-4. GitHub Pages로 바로 띄우기 (선택)

사내 테스트용으로 GitHub Pages를 쓸 수도 있습니다.

1. 저장소 **Settings → Pages → Source: GitHub Actions**
2. **Actions → Deploy to GitHub Pages → Run workflow**
3. 완료되면 `https://<조직또는계정>.github.io/densi-assist/` 에서 열립니다.

> 비공개 저장소의 Pages는 GitHub 유료 요금제가 필요하고, 조직 설정에 따라 막혀 있을 수 있습니다.

---

### 3-5. 파일 하나로 나눠 주기 (설치·서버 없이)

`npm run build`를 하면 `Densi-assist.html` (약 1MB)도 함께 만들어집니다. 코드·화면·이미지 처리 워커가 모두 이 파일 하나에 들어 있어, **이메일이나 공유 폴더로 이 파일만 전달하면** 받은 사람이 더블클릭해서 바로 쓸 수 있습니다.

- 확인한 브라우저: Chrome, Edge (파일로 열어 이미지 추가 → 레인·밴드 검출 → 결과 → 자동 저장·복원까지 확인)
- 파일로 열 때는 브라우저가 모듈 방식 워커를 막기 때문에, 단독 실행판은 워커를 일반 방식으로 내장하도록 따로 빌드합니다 (`vite.config.ts`의 `standalone` 모드).
- 저장소의 `index.html`은 개발용이지만, 파일로 더블클릭하면 같은 폴더의 `Densi-assist.html`로 자동 이동합니다.

## 4. 개발 환경

| 항목 | 버전 |
|---|---|
| Node.js | 22 이상 권장 (`.nvmrc`), 최소 20.19 |
| 패키지 설치 | `npm ci` |
| 개발 서버 | `npm run dev` → http://localhost:5173 |
| 전체 검사 | `npm run check` (타입 검사 + 테스트 + 빌드) |

> 의존성 중 `xlsx`(엑셀 내보내기)는 npm 대신 SheetJS 공식 CDN(`cdn.sheetjs.com`)에서 받도록 되어 있습니다 (npm의 구버전에 보안 공지가 있어서). 회사 방화벽이 이 주소를 막으면 `npm ci`가 실패하니, 그때는 이 주소를 허용 목록에 추가하세요.

---

## 5. 확인이 필요한 사항

- **라이선스**: `package.json`의 `license`를 `UNLICENSED`(사내 전용, 외부 사용 불가)로 두었습니다. 공개 저장소로 오픈소스로 배포하려면 라이선스를 정해 `LICENSE` 파일을 추가하세요.
- **공개 여부**: 저장소를 공개(public)로 만들면 소스 코드와 문서가 모두 공개됩니다. 실험 이미지는 `.gitignore`로 빠져 있지만, 올리기 전에 변경 목록을 한 번 더 확인하세요.
