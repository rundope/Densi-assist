# 사전 조사: 덴시토메트리 소프트웨어와 알고리즘

작성: 2026-09-17. 구현 전에 ImageJ 및 상용/무료 겔 분석 소프트웨어의 방식과 1D 베이스라인 보정 알고리즘을 조사한 결과.

---

## 1. ImageJ

### 1.1 Subtract Background (`ij/plugin/filter/BackgroundSubtracter.java`)

이미지를 "픽셀 값 = 높이"인 3D 표면으로 보고, 표면 **아래**에서 기하 도형을 굴려 닿는 궤적을 배경으로 본다.

**Rolling ball**
- 반경에 따라 이미지를 축소한 뒤 굴리고, 다시 bilinear 보간으로 확대 (속도 ∝ r²이므로)

  | radius | shrinkFactor | arcTrimPer |
  |---|---|---|
  | ≤ 10 | 1 | 24 |
  | ≤ 30 | 2 | 24 |
  | ≤ 100 | 4 | 32 |
  | > 100 | 8 | 40 |

- 축소 시 각 블록의 **최솟값**을 취함 (배경은 아래쪽 포락선이므로)
- 볼 구조요소: `r' = r/shrink`, `xtrim = arcTrimPer·r'/100`, `halfWidth = round(r' − xtrim)`, `z(x,y) = √(r'² − x² − y²)` (음수면 0)
- rollBall: 볼 중심 (x,y)마다 `z = min(pixel − ball)`, 그 다음 볼이 덮는 픽셀을 `max(pixel, z + ball)`로 올림 (= grayscale opening)
- 볼 높이는 **픽셀 값 단위 그대로** 사용 → 16-bit에서 볼은 사실상 평평한 원판(rolling disk)처럼 동작

**Sliding paraboloid**
- 각 1D 라인에서 포물선 `v = a + b·x − c·x²` (c = `0.5/radius`, 대각선은 `1/radius`)을 아래에서 밀어 올림
- 방향 순서: x → y → x → 대각선 4방향 → 대각선 재실행 (총 9 pass)
- 곡률 조건(`2·v[i-1] − v[i-2] − v[i] < 1.999·c`)으로 접촉 후보점만 추려 속도 확보
- 코너 보정(correctCorners): 코너를 지나는 6개 라인에서 6차 다항식으로 가장자리 값을 추정해 평균

**공통 옵션**
- Presmooth: 3×3 최댓값 필터 → 3×3 평균 필터 (어두운 노이즈 점이 배경을 끌어내리는 것 방지). 최댓값 필터로 올라간 평균량(shiftBy)을 결과에서 빼 줌
- Light background: 내부적으로 부호를 뒤집어 같은 알고리즘 사용
- Create background: 빼지 않고 배경 이미지 자체를 반환
- 정수형 결과: `value = pixel − bg + 0.5` 후 [0, max]로 클램프

### 1.2 Gel Analyzer (`ij/plugin/GelAnalyzer.java`)

- 첫 레인 사각형이 `width/height ≥ 2`이면 가로 레인, 아니면 세로 레인
- 이후 레인은 **첫 레인과 같은 크기**로 강제
- 프로파일 = `ProfilePlot` = 레인 폭 방향 **평균**
- Uncalibrated OD 옵션: `OD = 0.434294481·ln(255 / (255 − v))` (8-bit 전용)
- 사용자가 플롯 위에 **직선으로 베이스라인을 긋고**, wand로 닫힌 영역을 선택해 면적 측정
  - 면적 = 플롯 이미지의 픽셀 수 기반 (`pixelCount + perimeter/2`) → 플롯 해상도·스케일에 따라 값이 달라짐
- Label with percentages: `measured[i] / Σ measured × 100`

**한계 (개선 대상)**
- 베이스라인이 손으로 긋는 직선뿐이라 사람마다 결과가 달라짐
- 면적이 래스터 플롯 기준이라 수치 정밀도가 떨어짐
- 한 번에 이미지 1장, 설정이 저장되지 않음
- 16-bit OD 변환 없음, 포화 경고 없음

---

## 2. 다른 소프트웨어의 방식

| 소프트웨어 | 배경/베이스라인 방식 | 특징 |
|---|---|---|
| **Bio-Rad Image Lab** | 레인 프로파일 위 **rolling disk** (disk 크기 0.5–99.5 mm, 보통 < 10 mm) | 디스크가 작을수록 배경을 더 많이 뺌. 너무 크면 배경 제거 부족, 너무 작으면 밴드 신호까지 깎음 |
| **LI-COR Image Studio** | 밴드 사각형 **주변 테두리 픽셀**의 Average/Median (폭 1–5 px, 전체/좌우/상하 선택) | `Signal = Total − Bkgnd × Area`. 레인 프로파일 없이 사각형 단위로 정량 |
| **TotalLab Phoretix 1D** | Rolling ball(레인 길이 대비 %), **Lane edge**(레인 양 가장자리 값 중 작은 값), **Rubber band**, None, Constant, Image rectangle(빈 레인 평균), **Profile minimum** | 방법별 장단점 명시. Lane edge는 가까이 붙은 밴드에 강하지만 가장자리가 밴드를 지나면 과소평가 |
| **GelAnalyzer** | Rolling ball, **valley-to-valley**, 수동 베이스라인(점 연결) | 음수 허용/0 클립 선택. Raw volume = Σ(profile − background). 곡선 레인(path point). Quantity calibration: linear / quadratic / linear-log / exponential |
| **ImageQuant TL** | None, Rolling ball, Rubber band, Minimum profile, Manual 등 | Rolling ball radius 예: 200 |

**설계에 반영할 점**
1. 방법마다 잘 맞는 상황이 달라서 **여러 방법 중 선택**하는 것이 업계 표준
2. Lane edge, 테두리 median(LI-COR)처럼 **2D 주변 정보**를 쓰는 방식도 1D 방식과 함께 제공할 가치가 있음
3. 롤링볼 크기는 px 외에 **레인 길이 대비 %**로도 지정할 수 있어야 해상도가 다른 이미지 간에 일관됨
4. 음수 처리(허용/클립)는 사용자 선택으로 두고 기록

### 2.1 2D 배경 제거 옵션 추가 (2026-11-27)

사용자가 "롤링볼·파라볼로이드가 배경을 너무 많이 제거하고, 약하게 쓰고 싶다"고 요청해 아래를 추가함.

| 옵션 | 근거 | 비고 |
|---|---|---|
| **강도(%)** | 사용자 요구. 추정 배경 중 일부만 빼는 가중 | 소프트웨어 조사에는 없음(자체 설계) |
| **상수 빼기** | TotalLab Phoretix 1D의 **Constant**(위 표)와 같은 개념. 기준 위치(%) = 신호 낮은 쪽 백분위 값을 배경으로 간주 | 0 아래로는 내리지 않음 |
| **얼룩만 고르게** | **조사 근거 없음, 자체 설계.** 롤링볼 배경을 축소→가우시안→확대로 매끈하게 한 뒤 평균을 빼서 변동분만 제거 | 전체 밝기 유지. 일반 flat-field(조명 불균일) 보정과 같은 발상이지만 특정 문헌·소프트웨어를 확인한 것은 아님 |

참고: 롤링볼은 반경 50이든 400이든 배경 값 전체를 0으로 내리는 효과가 거의 같음(사용자 사진: 배경 신호 약 40~50). 화면이 하얗게 되는 것은 표시 현상이며, 면적 측정에는 ③ 레인 베이스라인이 별도로 적용됨.

---

## 3. 1D 베이스라인 보정 알고리즘 목록

분광학(Raman, XRD, 크로마토그래피)에서 쓰는 알고리즘을 정리한 pybaselines 라이브러리 기준. 겔 프로파일도 "부드러운 배경 + 양의 피크" 구조라 그대로 적용된다.

### 3.1 Whittaker (penalized least squares)

공통 형태: `min Σ wᵢ(yᵢ − zᵢ)² + λ Σ (Δᵈ zᵢ)²` → `(W + λ DᵀD) z = W y`
(d = 2 기본. 행렬이 대칭 5중대각(banded)이라 O(n)으로 풀림)

| 방법 | 가중치 갱신 | 기본값 |
|---|---|---|
| **AsLS** | `w = p (y > z)`, `1 − p (그 외)` | λ = 1e6, p = 0.01, 최대 50회, tol 1e-3 |
| **airPLS** | `w = 0 (y ≥ z)`, `exp(t·|r| / ‖r⁻‖₁) (y < z)`, t = 반복 횟수 | λ = 1e6. `‖r⁻‖₁ < tol·‖y‖₁`이면 수렴 |
| **arPLS** | `w = 1 / (1 + exp(2(r − (−μ⁻ + 2σ⁻)) / σ⁻))`, μ⁻·σ⁻ = 음수 잔차의 평균·표준편차 | λ = 1e5 |
| **iarPLS** | `w = ½(1 − exp(t)(r − 2σ⁻)/σ⁻ / √(1 + (·)²))` | λ = 1e5 |
| **drPLS** | 피크 영역에서 평활 항을 약화: `(W + D₁ᵀD₁ + λ(I − ηW)DᵀD) z = W y` | λ = 1e5, η = 0.5 |
| **psalsa** | `w = p·exp(−r/k) (y > z)`, `1 − p (그 외)` | λ = 1e5, p = 0.5, k = std(y)/10 |

수렴 판정: `‖w_new − w_old‖ / ‖w_old‖ < tol`

### 3.2 Morphological

| 방법 | 원리 |
|---|---|
| **Rolling ball / disk** | 원(볼) 구조요소로 opening. 겔 분야 표준 |
| **Top-hat** | 평평한 구조요소로 opening (min 필터 → max 필터) |
| **Opening + 평활** (pybaselines rolling_ball) | opening 후 이동 평균 |
| **MOR / IMOR** | opening과 (erosion + dilation)/2 중 작은 값, 반복 |

### 3.3 Smoothing 기반

| 방법 | 원리 | 기본값 |
|---|---|---|
| **SNIP** | 창 크기 k = 1…K로 늘리며 `z[i] = min(z[i], (z[i−k] + z[i+k]) / 2)`. 선택적으로 LLS 변환 `log(log(√(y+1) + 1) + 1)` | K ≈ 가장 넓은 피크 폭의 절반. 필터 차수 2/4/6/8 |
| **Median + Gaussian** (noise_median) | 이동 median 후 Gaussian 평활 | |
| **SWiMA** | 이동 평균과의 최솟값을 창을 늘리며 반복 | |

### 3.4 Polynomial

| 방법 | 원리 |
|---|---|
| **ModPoly** | 다항식 적합 → `y ← min(y, fit)` 반복 |
| **IModPoly** | 잔차 표준편차를 더해 노이즈에 강하게: `y ← min(y, fit + σ)` |
| **Quantile regression** | 하위 분위수 회귀 |

### 3.5 기하학/수동

| 방법 | 원리 |
|---|---|
| **Rubber band** | 프로파일의 **아래쪽 볼록 껍질**(lower convex hull). 선택적으로 bend(굽힘) 보정 |
| **Valley-to-valley** | 각 밴드의 시작·끝 점을 직선으로 연결 (ImageJ 수동 직선과 같은 개념을 자동화) |
| **Profile minimum / constant** | 수평선 |
| **Manual points** | 사용자가 찍은 점을 직선 또는 단조 3차 보간(PCHIP)으로 연결 |

---

## 4. 정량 모범 사례

- **선형 범위**: 로딩량 대비 신호 표준 곡선을 그려 선형 범위를 확인하고, 그 가운데에 샘플이 오도록 로딩. 좋은 항체는 8배에서 두 자릿수(100배)까지 선형
- **정규화**: 하우스키핑 단백질(GAPDH, β-actin 등)이나 total protein(stain-free, Ponceau) 기준. Total protein이 기술 반복 간 분산이 가장 작다는 보고가 있음
- **정규화 공식**: `상대 발현 = (target / loading control) / (reference 샘플의 target / loading control)`
- **포화 금지**: 포화된 밴드는 선형 관계가 깨짐 → 포화 픽셀 경고 필요
- **감마·대비 조정은 표시에만**: 비선형 변환 후 정량하면 안 됨
- **보정 곡선 모델**: GelAnalyzer 기준 linear, quadratic, linear-log, exponential. 면역분석에서는 4PL(4-parameter logistic)이 표준

---

## 5. 설계 결정 요약

| 조사 결과 | 결정 |
|---|---|
| 방법마다 적합한 상황이 다름 | 베이스라인 15종 이상을 5개 그룹으로 제공. 방법마다 "언제 쓰나" 설명 표시 |
| ImageJ 면적이 플롯 래스터 기반 | 프로파일 수치를 직접 합산 (GelAnalyzer raw volume 방식) |
| 롤링볼 크기가 해상도에 의존 | px와 레인 길이 대비 % 둘 다 지원 |
| 대부분 1회 1이미지 | 프로젝트 안에 여러 겔. 레인에 샘플명, 밴드에 타깃을 지정해 **겔을 넘나드는 결과 표** 생성 |
| 결과 재현이 어려움 | 모든 설정을 프로젝트 파일에 저장, 설정을 다른 겔·레인에 일괄 적용 |
| 표준 곡선을 별도 도구에서 계산 | 앱 내 스프레드시트(엑셀 붙여넣기 지원) + 6종 모델 적합 + 미지 시료 역산 |

---

## 출처

- ImageJ BackgroundSubtracter 소스: https://github.com/imagej/ImageJ/blob/master/ij/plugin/filter/BackgroundSubtracter.java
- ImageJ GelAnalyzer 소스: https://github.com/imagej/ImageJ/blob/master/ij/plugin/GelAnalyzer.java
- pybaselines 알고리즘 문서: https://pybaselines.readthedocs.io/en/latest/algorithms/index.html
- pybaselines whittaker.py / smooth.py: https://github.com/derb12/pybaselines
- TotalLab, Background subtraction for 1D SDS-PAGE: https://totallab.com/resources/background-subtraction-1d-sds-page/
- GelAnalyzer Concepts: https://gelanalyzer.com/docs/concepts/
- LI-COR Image Studio, Western and Gel Background: https://www.licorbio.com/support/contents/software/image-studio/analysis/gel-and-blot-background.html
- Bio-Rad Image Lab User Guide 6.1: https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10000076953.pdf
- ImageQuant TL User Manual: https://nba.uth.tmc.edu/Assets/pdf/other/typhoon_supporting_files/IQTL_UserManual.pdf
- Scientific Reports (2022), quantitative western blot: https://www.nature.com/articles/s41598-022-22294-x
- Total protein as loading control (PMC3758299): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3758299/
