# Perpetual Engine Design System

UI의 **SSOT (Single Source of Truth)**. 모든 피처 시안(HTML 목업)은 이 시스템을 기반으로만 생성되어야 한다.

## 스택

- **형식**: HTML + CSS (JS 최소화, 필요 시 바닐라)
- **토큰**: [tokens.css](./tokens.css) — CSS custom properties
- **컴포넌트**: [components.css](./components.css) — 재사용 가능한 `.ip-*` 클래스
- **시각 프리뷰**: [mockups/system/preview.html](../mockups/system/preview.html)
- Pencil 사용 안 함. (과거에는 필수였으나 2026-04-17부터 HTML 시안으로 전환 — 이유는 [designer-design-system-lifecycle.md](../../troubleshooting/designer-design-system-lifecycle.md))

## 사용 원칙

1. **리터럴 값 금지**: 피처 목업에서 `#6366f1`, `16px`, `0.5em` 같은 리터럴을 직접 쓰지 말 것. 반드시 `var(--color-primary-500)`, `var(--space-4)` 형태로 참조.
2. **새 값이 필요하면 토큰부터 추가**: `tokens.css`에 먼저 변수를 정의한 뒤 사용. 추가/변경은 CHANGELOG에 기록.
3. **컴포넌트 재사용**: 버튼·카드·필드·KPI 등은 `.ip-btn`, `.ip-card`, `.ip-kpi` 등 기존 클래스를 조합.
4. **새 컴포넌트는 먼저 시스템에**: 피처에서만 쓰는 것처럼 보이는 패턴도 여러 곳에 등장할 가능성이 있으면 `components.css`에 먼저 등록.
5. **접근성**: 색상 대비는 WCAG AA 이상(본문 4.5:1). 토큰 변경 시 대비 재검증.

## 토큰 카탈로그

### 색상
| 토큰 | 값 | 용도 |
|------|----|----|
| `--color-bg-canvas` | `#0f172a` | Design Canvas 배경 |
| `--color-surface` | `#ffffff` | 카드/패널 기본 배경 |
| `--color-surface-muted` | `#f8fafc` | 앱 배경 |
| `--color-surface-inverse` | `#0f172a` | 다크 사이드바 |
| `--color-text` / `--color-text-muted` / `--color-text-subtle` | slate-900/500/400 | 텍스트 계층 |
| `--color-primary-500` | `#6366f1` | 주 브랜드 |
| `--color-accent-500` | `#ec4899` | 강조 |
| `--gradient-primary` | indigo→pink | CTA |
| `--gradient-hero` | indigo→violet→pink | 히어로 섹션 |
| `--color-success` / `--color-warning` / `--color-info` / `--color-danger` | — | 상태 표시 |

### 간격 (4px scale)
`--space-1`=4 · `--space-2`=8 · `--space-3`=12 · `--space-4`=16 · `--space-5`=20 · `--space-6`=24 · `--space-7`=28 · `--space-8`=32 · `--space-10`=40

### 반경
`--radius-xs` 4 · `--radius-sm` 6 · `--radius-md` 8 · `--radius-lg` 12 · `--radius-xl` 14 · `--radius-2xl` 20 · `--radius-3xl` 42 · `--radius-phone` 54 · `--radius-pill` 999

### 타이포그래피
- 스케일: xs(11) · sm(12) · md(13) · base(14) · lg(15) · xl(18) · 2xl(22) · 3xl(26) · 4xl(30)
- 굵기: regular(400) · semibold(600) · bold(700) · extrabold(800)
- 한 페이지에 동시에 3개 이상의 크기를 쓰지 말 것 (시각적 노이즈 방지)

### 그림자
- `--shadow-xs`: subtle outline용
- `--shadow-card`: 카드 기본
- `--shadow-float`: 디바이스 프레임·모달
- `--shadow-cta`: 강조 버튼

## 컴포넌트 카탈로그

| 클래스 | 용도 |
|-------|-----|
| `.device-mobile` · `.device-mobile__screen` · `.device-mobile__notch` | iPhone 프레임 |
| `.device-desktop` · `.device-desktop__chrome` · `.device-desktop__body` | 브라우저 프레임 |
| `.ip-btn` · `.ip-btn--primary` · `.ip-btn--ghost` | 버튼 |
| `.ip-card` · `.ip-field` | 컨테이너 |
| `.ip-switch` | 토글 |
| `.ip-badge--success/warning/info` | 상태 뱃지 |
| `.ip-kpi` · `.ip-kpi__value` · `.ip-kpi__delta--up/--down` | KPI 타일 |
| `.ip-table` | 데이터 테이블 |
| `.ip-sidebar` · `.ip-nav-item` · `.ip-nav-item--active` | 네비게이션 |
| `.ip-panel` · `.ip-panel__title` | 섹션 패널 |
| `.ip-hero` · `.ip-hero__title` · `.ip-hero__subtitle` | 그라디언트 히어로 |
| `.ip-h1/h2/h3` · `.ip-label` · `.ip-muted` | 타이포그래피 유틸 |

자세한 시각적 예시: [mockups/system/preview.html](../mockups/system/preview.html)

## 피처 목업 작성 규약

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>Feature: {피처명} · {화면}</title>
  <link rel="stylesheet" href="../../system/components.css">
</head>
<body>
  <div class="device-mobile">
    <div class="device-mobile__notch"></div>
    <div class="device-mobile__screen">
      <!-- 시스템 클래스와 토큰만 사용 -->
    </div>
  </div>
</body>
</html>
```

**필수 동반 파일**: 같은 폴더에 `meta.json`
```json
{
  "name": "feature-name",
  "screen": "screen-name",
  "device": "mobile" | "desktop",
  "flow": ["screen-a", "screen-b"],
  "tokensUsed": ["--color-primary-500", "--space-4", "..."],
  "componentsUsed": [".ip-btn--primary", ".ip-field"]
}
```

## CHANGELOG

### v0.1.0 — 2026-04-17
- 초기 디자인 시스템 부트스트랩
- 색상·간격·반경·타이포·그림자 토큰 확립
- 디바이스 프레임(.device-mobile / .device-desktop), 버튼, 필드, KPI, 뱃지, 네비게이션, 히어로, 패널 컴포넌트 등록
- Pencil → HTML+CSS 스택으로 전환
