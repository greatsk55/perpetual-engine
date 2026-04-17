# 대시보드 UI 리뉴얼 — Claude 디자인 시스템 + 모바일 최적화

## 문제

초기 대시보드(`src/dashboard/client/dist/index.html`)는 범용 Tailwind slate + indigo 팔레트 기반으로 구성되어 있었다. 주요 이슈:

1. **톤앤매너 불일치** — 프로젝트가 "Claude Code 에이전트 팀"을 운영하는 프레임워크임에도 불구하고 시각적으로 일반적인 SaaS 대시보드에 가까웠다 (slate-900 bg, indigo-500 accent).
2. **모바일 UX 부재** — `grid-cols-3`, `grid-cols-4` 등 고정 그리드, 네비게이션 수평 정렬 고정, 모달 `w-[800px]` 고정 너비. 375px 화면에서는 가로 스크롤과 잘림 발생.
3. **타이포그래피 위계 약함** — 모든 텍스트가 system sans, 크기 차이만으로 구분. 제품 브랜딩을 전달하지 못함.
4. **여백·테두리 무거움** — 불필요한 그림자와 진한 borders, 작은 radius(8px)가 반복되어 밀도 높은 느낌.

## 해결

### 1. 디자인 토큰 재정의 (CSS 변수)

Claude의 시각 언어를 반영한 팔레트로 교체:

| 토큰 | 값 | 용도 |
|---|---|---|
| `--canvas` | `#262624` | 최하위 배경 (Claude 다크 바탕) |
| `--surface` | `#2F2E2C` | 카드 배경 |
| `--elevated` | `#36352F` | hover/inset 표면 |
| `--ink` | `#E8E6E3` | 기본 텍스트 |
| `--ink-mute` | `#B4B1AB` | 본문 보조 |
| `--ink-subtle` | `#8A8780` | 레이블/메타 |
| `--coral` | `#D97757` | primary accent (Claude signature coral) |
| `--moss` | `#8FA96B` | success/working |
| `--amber` | `#D4A24A` | warning/paused |
| `--rust` | `#C4644E` | danger/critical |

배경-표면-강조 3단 계조를 좁혀서 절제된 위계를 유지한다.

### 2. 타이포그래피 이원화

- **Display**: `ui-serif, Georgia` — H1, 카드 제목, 숫자 통계값 (`.h-display`, `.stat-value`)
- **Body**: `ui-sans-serif, -apple-system` — 기본 UI 텍스트
- **Mono**: `ui-monospace, Menlo` — 태스크 ID, MCP 도구명, 스킬 태그, 로그

`.label` 클래스(11px uppercase letter-spacing 0.08em)로 메타 영역에서 위계를 만든다.

### 3. 모바일 우선 반응형 전략

| 영역 | 데스크톱 | 모바일 (<768px) |
|---|---|---|
| Navigation | 중앙 정렬 tabs | 가로 스크롤 탭 (`.nav-scroll`, scrollbar hidden) |
| Overview KPI | `grid-cols-4` | `grid-cols-2` |
| Agent team | `grid-cols-3` | `grid-cols-1` |
| Task distribution | `grid-cols-6` | `grid-cols-2` |
| Kanban | flex 6-col | flex + `flex: 0 0 280px` 가로 스크롤 + `-mx-4 px-4` bleed |
| Documents | 2-col split | 리스트 ↔ 본문 토글 (`.hidden lg:block` + Back 버튼) |
| Categories | flex-wrap | 가로 스크롤 chip |
| Org chart | 자연 배치 | `overflow-x-auto` + 노드 min-width 축소 |
| Modal | 중앙 정렬 max-w-760 | 하단 sheet 스타일 (`align-items: flex-end` + `border-radius: 16px 16px 0 0`) |

모달은 `@media (min-width: 640px)`에서만 중앙 정렬·풀 radius로 전환하도록 구성했다. 모바일에선 bottom sheet처럼 보이고, 헤더가 `sticky top-0`으로 고정되어 긴 내용에서도 닫기 버튼 접근성 확보.

### 4. 컴포넌트 정돈

- **버튼**: `btn-primary` (coral fill), `btn-secondary` (outline), `btn-ghost` (투명), `btn-danger` (outline + rust), `btn-icon` (정방형) — line-height: 1 로 정렬 일관성.
- **Pill**: status/priority/accent/neutral 4종 — `dot` 요소와 결합해 상태를 시각화.
- **Task card**: 왼쪽 3px 보더 스트립으로 priority 표시 (::before pseudo element, 기존의 `border-left` 방식 대체).
- **Org node**: hover 시 translate + coral border + shadow-md, `is-working` 상태는 moss color halo.

### 5. 기타 개선

- 스크롤바 얇게 (10px, transparent track, rounded thumb).
- 모달 열려 있을 때 `document.body.style.overflow = 'hidden'` 으로 body scroll lock.
- viewport meta `viewport-fit=cover` + `theme-color` 추가로 iOS 안전 영역/상태바 톤 매칭.
- 탭 진입점 `-webkit-tap-highlight-color: transparent`로 모바일 터치 flash 제거.
- WebSocket 핸드셰이크, refreshAll, API 경로 등 **비즈니스 로직과 상태 구조는 100% 유지** — UI 마크업/스타일만 교체.

## 적용 파일

- `src/dashboard/client/dist/index.html` — 전체 재작성 (1044 → 신규)

## 유지한 제약

- **의존성 무추가**: Tailwind CDN 하나로 유지. 추가 JS 번들러/빌드 단계 없음.
- **API 인터페이스 불변**: `/api/status`, `/api/kanban`, `/api/agents`, `/api/tasks/:id`, WebSocket 이벤트 (`kanban_updated`, `task_updated`, `new_message`) 그대로.
- **상태 머신 동일**: `state` 객체 키/값 구조 유지 — 서버 변경 불필요.

## 검증 체크리스트

- [ ] 375px (iPhone SE) 네비 가로 스크롤 동작, 모달 bottom sheet 표시
- [ ] 768px (iPad) 2-col 그리드 전환, 모달 중앙 정렬
- [ ] 1440px (데스크톱) 3-col 그리드, 2-col 문서 split
- [ ] 모든 탭(Overview/Kanban/Organization/Documents/Messages/Settings) 렌더링
- [ ] 태스크/에이전트/메시지 모달 열기·닫기·body scroll lock
- [ ] WebSocket 실시간 업데이트 (kanban_updated → 보드 반영)

## 참고 결정

- **다크 모드 고정**: Claude 제품 스크린샷과 IDE 컨텍스트(터미널·코드 편집기) 모두 다크 기반이라 현 단계에서는 단일 테마 유지. 라이트 모드는 토큰만 분리돼 있어 `@media (prefers-color-scheme: light)` 블록 추가만으로 향후 대응 가능.
- **serif 디스플레이 도입**: Claude 공식 마케팅 페이지와 일관된 느낌을 내기 위함. 시스템 serif(`ui-serif`)로 추가 폰트 로드 없음.
