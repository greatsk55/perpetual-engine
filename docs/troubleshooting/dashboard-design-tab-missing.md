# 대시보드 Design 탭 누락

## 증상
서버에 `/design` 라우트, `/api/design/mockups`, `/api/design/system/*`, `/design-assets/*` 정적 서빙, 그리고 [canvas.html](../../src/dashboard/design/canvas.html) 클라이언트까지 모두 구현되어 있었음에도, 대시보드 최상단 네비게이션에서 Design Canvas 로 진입할 방법이 없었다. 사용자는 "웹 대시보드 상단에 디자인 탭이 있어서 거기서 디자이너가 디자인한 시안들을 확인 가능하게 하랬는데 왜 안됐지?" 라고 문의.

## 원인
`src/dashboard/client/dist/index.html` 의 `renderNav()` 탭 배열에 `design` 항목이 누락. SPA 네비 탭과 서버 라우트가 **서로 다른 계층**이라 백엔드 구현만으로는 사용자가 접근할 방법이 없다. 또한 Documents 뷰 내부에 `{ id: 'design', label: 'Design' }` 카테고리가 존재하지만 이건 `docs/design/*.md` 마크다운용이라 Design Canvas(HTML 목업)와 무관하다 — 같은 라벨이라 더 헷갈린다.

## 해결
1. `renderNav()` 의 `tabs` 배열에 `{ id: 'design', label: 'Design' }` 추가 (Organization 과 Documents 사이).
2. `renderDesign()` 뷰 추가: [canvas.html](../../src/dashboard/design/canvas.html) 을 iframe 으로 임베드하여 SSOT 유지 (캔버스 로직을 SPA 에 복제하지 않음).
3. 헤더에 "새 탭에서 열기" 버튼 포함 — 전체 화면 편집 시 기존 `/design` 직접 접근 동선도 보존.
4. `render()` 의 `views` 맵에 `design: renderDesign` 등록.

## 재발 방지
- **규칙**: 서버에 사용자용 라우트/페이지를 추가하면, 반드시 대시보드 네비에서 진입 가능한지 확인한다. 백엔드만 구현하고 SPA 네비를 갱신하지 않으면 "구현은 됐는데 접근 불가" 상태가 된다.
- **규칙**: SPA 내부 카테고리 라벨과 별개 페이지 탭 라벨이 겹치면(e.g. Documents 의 "Design" vs 상단 "Design" 탭) 기능 존재 자체를 놓치기 쉽다. 라벨 설계 시 중복 피하기.
- Documents 내부 `design` 카테고리는 `docs/design/*.md` 전용, 상단 `design` 탭은 `docs/design/mockups/**` 의 HTML 시안 전용임을 문서화.

## 관련 파일
- `src/dashboard/server.ts` — `/design`, `/api/design/*`, `/design-assets/*` 라우트 (L374-407)
- `src/dashboard/design/canvas.html` — Design Canvas SSOT
- `src/dashboard/client/dist/index.html` — `renderNav()`, `renderDesign()`
- `src/core/design/mockup-scanner.ts` — meta.json 스캐너
