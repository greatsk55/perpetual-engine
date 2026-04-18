# Perpetual Engine

AI 에이전트 스타트업 프레임워크 - 토큰만 투자하면 AI가 사업을 만든다.

## 프로젝트 개요
- npm으로 설치 가능한 CLI 프레임워크
- CEO, CTO, PO, Designer, QA, Marketer 에이전트 팀이 자율적으로 스타트업 운영
- tmux 기반 멀티 에이전트 병렬 실행
- 로컬 대시보드(http://localhost:3000)로 실시간 모니터링 (칸반보드, 에이전트 상태)
- 모든 동작은 CLI와 GUI(대시보드) 양쪽에서 가능

## 기술 스택
- CLI: Node.js + TypeScript + Commander.js
- Dashboard: Express + WebSocket + 인라인 React (Tailwind CDN)
- State: File-based JSON (kanban.json, sprints.json)
- Agent Runtime: tmux + Claude Code CLI
- 문서 관리: Markdown + Git

## 프로젝트 구조
```
src/
├── cli/           # CLI 명령어 (Commander.js)
├── core/          # 핵심 비즈니스 로직 (CLI/대시보드 공유)
│   ├── project/   # 프로젝트 초기화, 설정 관리
│   ├── agent/     # 에이전트 정의, 레지스트리, 프롬프트 빌더, 스킬 매핑
│   ├── session/   # tmux 세션 관리
│   ├── state/     # kanban/sprint CRUD (file-store 기반)
│   ├── workflow/  # 워크플로우 엔진, 오케스트레이터
│   ├── metrics/   # 메트릭스 기반 기획 평가 시스템
│   ├── context/   # 문서 기반 컨텍스트 관리
│   └── messaging/ # 메시지 큐, 회의 시스템
├── dashboard/     # Express API + WebSocket + HTML 클라이언트
└── utils/         # 로거, YAML, 경로, 에러
```

## 주요 명령어
```bash
perpetual-engine init <name>           # 프로젝트 생성
perpetual-engine setup                 # 대화형 설정 (작업 언어/회사/프로덕트 등)
perpetual-engine start                 # 에이전트 + 대시보드 시작 (기본: 빈 프로젝트에만 CEO 자동 기동)
perpetual-engine start --no-ceo        # CEO 자동 기동 건너뛰기 (워처만 가동)
perpetual-engine start --force-ceo     # 기존 스프린트가 있어도 CEO 재계획 강제
perpetual-engine stop                  # 모든 에이전트 종료
perpetual-engine team                  # 팀 목록
perpetual-engine status                # 상태 요약
perpetual-engine board                 # 터미널 칸반보드
perpetual-engine message <msg>         # 팀에게 메시지
perpetual-engine task run <id>         # 태스크 강제 실행 (의존성/상태 무시)
perpetual-engine task suspend <id>     # 태스크 일시 중단
perpetual-engine task resume <id>      # 중단된 태스크 재개
perpetual-engine task list [-s status] # 태스크 목록 (상태 필터 가능)
```

## 아키텍처 원칙
- **SSOT**: kanban.json이 태스크 상태의 유일한 소스, metrics.json이 메트릭스의 유일한 소스, `docs/development/feature-<slug>/components.json` 이 컴포넌트 분해의 유일한 소스
- **CLI/Core 분리**: CLI와 대시보드 모두 같은 core 모듈 사용
- **파일 기반 통신**: 에이전트 간 통신은 파일 시스템(messages/, docs/) 기반
- **세션 독립성**: 각 워크플로우 페이즈는 새 Claude Code 세션에서 실행
- **메트릭스 기반 의사결정**: 모든 기획에 측정 지표/기간을 설계하고, 달성도로 다음 행동(확대/유지/반복개선/방향전환/폐기) 결정
- **작업 언어 일원화**: setup 시 선택한 언어(`config.localization`)를 PromptBuilder가 모든 에이전트 시스템 프롬프트 최상단에 주입 — 대화·문서·칸반·커밋·자문 요청 모두 동일 언어. 코드 식별자/외부 API/URL은 원문 유지.
- **한 역할당 동시 세션 1개**: tmux 세션명이 역할 단위(`ip-<role>`)라 같은 역할로 세션을 동시에 2개 이상 띄울 수 없다. 새 태스크 디스패치 경로를 추가할 때는 `Orchestrator.processingRoles` 락을 반드시 거치고, 세션명을 `role` 이 아닌 다른 키로 쓸 거면 SessionManager 의 activeSessions 키 전체를 함께 바꿔야 한다.
- **컴포넌트 단위 개발 + 5종 테스트 강제**: development 페이즈는 `development-plan` → `development-component`(컴포넌트마다 반복) → `development-integrate` 3단으로 쪼갠다. 한 컴포넌트는 한 세션에서 5–15분 안에 끝나야 하고, 모든 컴포넌트는 unit/UI/snapshot/integration/E2E **5종 테스트를 전부** 작성해야 완료된다. 테스트 도구는 CTO 가 `tech-stack.md` 의 `test_runners` 에서 자유 선택(자동 강제는 도구가 아니라 5종 종류).
- **페이즈별 타임아웃**: `Phase.timeoutMs` 로 페이즈마다 따로 지정. 미설정 시 `DEFAULT_PHASE_TIMEOUT_MS`(10분). 새 페이즈 추가 시 반드시 명시.

## 에이전트 스킬 시스템
각 에이전트는 역할에 맞는 전용 스킬(Claude Code slash command)을 보유합니다:
- **CEO**: /launch-strategy, /marketing-psychology, /seo-audit
- **CTO**: /security-review, /claude-api, /vercel-react-best-practices, /simplify
- **PO**: /copywriting, /marketing-psychology, /web-design-guidelines
- **Designer**: /frontend-design, /web-design-guidelines
- **QA**: /security-review, /audit-website
- **Marketer**: /paid-ads, /seo-audit, /copywriting, /launch-strategy, /marketing-psychology, /google-ads-manager

스킬 정의: `src/core/agent/agent-skills.ts`
스킬은 프롬프트 빌더를 통해 에이전트의 시스템 프롬프트에 자동 주입됩니다.

## 메트릭스 기반 기획 평가
모든 아이디에이션/기획은 반드시 측정 가능한 지표를 포함해야 합니다:
1. **기획 시**: 가설 + KPI(baseline/target) + 측정 기간 + 체크포인트 설정
2. **중간 체크**: 각 체크포인트에서 달성도 평가 (중간에는 관대하게)
3. **최종 평가**: 달성률에 따른 자동 판정
   - >=120%: **확대(scale_up)** - >=100%: **유지(maintain)** - >=60%: **반복개선(iterate)** - >=30%: **방향전환(pivot)** - <30%: **폐기(kill)**

관련 파일:
- 타입: `src/core/metrics/types.ts`
- 저장소: `src/core/metrics/metrics-store.ts` (metrics.json 기반)
- 평가기: `src/core/metrics/metrics-evaluator.ts`
- 프롬프트 룰: `src/core/agent/prompt-builder.ts`의 `buildMetricsRules()`

## 다중 참여자 회의 시스템
이슈 논의 시 유관 에이전트를 여러 명 초대하여 회의를 진행할 수 있습니다:
- **issue_discussion**: 이슈/버그/장애에 대해 관련 에이전트들이 협의
- **consultation**: 자문 전문가를 초대한 회의
- 회의 참여자는 meeting_invite 메시지의 participantRoles 배열로 지정
- 관련 태스크는 relatedTaskIds로 연결하여 컨텍스트 공유

관련 파일:
- 회의 시스템: `src/core/messaging/meeting.ts`
- 세션 관리: `src/core/session/session-manager.ts`의 `startMeetingSession()`
- 오케스트레이터: `src/core/workflow/orchestrator.ts`의 `startMultiAgentMeeting()`

## 디자인 스택 (HTML + CSS [+ JS for slides])
Designer 의 산출물은 HTML 목업이며 외부 디자인 툴(Pencil/Figma/Keynote/PPT) 은 사용하지 않습니다. CTO 도 동일한 HTML 을 구현 레퍼런스로 사용합니다.
프로덕트 UI 는 HTML + CSS 로만, **피치덱/세일즈덱/프레젠테이션 슬라이드** 는 동일한 디자인 시스템 위에서 HTML + CSS + vanilla JS 로 제작합니다 (빌드 툴 금지, CDN `<script>` 허용). 슬라이드 JS 는 시연용이며 프로덕트 코드에 재사용되지 않습니다.

구조:
- `docs/design/system/tokens.css` — CSS 변수 토큰 SSOT (색/간격/반경/타이포/그림자 + 슬라이드 래퍼 치수)
- `docs/design/system/components.css` — `.device-mobile`, `.device-desktop`, `.device-slide-16x9` 등 래퍼 + `.ip-*` / `.slide-*` 재사용 클래스
- `docs/design/system/design-system.md` — 명세 + CHANGELOG
- `docs/design/mockups/<feature>/<screen>.html` + `meta.json` — 피처 목업 (리터럴 값 금지, `var(--…)` 와 `.ip-*` 만 사용)
- `docs/design/mockups/<deck>/slide-*.html` + `meta.json` (device:"slide") — 피치덱·프레젠테이션 슬라이드 템플릿

Design Canvas (`http://localhost:3000/design`):
- `GET /api/design/mockups` → `meta.json` 스캔 결과 ([mockup-scanner.ts](src/core/design/mockup-scanner.ts))
- `GET /design-assets/*` → `docs/design/` 정적 서빙
- 기능: 다중 아트보드 병치, 줌/팬(마우스+핀치), 디바이스 필터, PNG 추출(아트보드별/전체)
- 클라이언트: [src/dashboard/design/canvas.html](src/dashboard/design/canvas.html) (panzoom + html-to-image CDN)

CTO/Dev 컨텍스트 (`src/core/context/context-manager.ts`) 는 development 페이즈에서 `tokens.css` / `components.css` / 해당 feature 의 `*.html` 을 자동으로 포함합니다.

## 자문 전문가 에이전트 (Ephemeral Agent)
전문 지식이 필요할 때, **어떤 분야든** 즉석으로 전문가 에이전트를 생성하여 조언을 받을 수 있습니다:
- 미리 정해진 도메인 목록 없음 — `expertise` 필드에 자유 서술하면 그 전문가가 즉석 생성됨
- 예: "GDPR 전문 변호사", "핀테크 결제 아키텍트", "시리즈A 재무 전문가" 등 무엇이든 가능
- 에이전트 생성 → 자문 제공 → 목적 완수 후 자동 소멸 (5분 타임아웃)
- 회의에 자문 전문가를 초대하여 함께 논의 가능

관련 파일:
- 팩토리: `src/core/agent/consultant-factory.ts` (expertise 기반 즉석 생성)
- 레지스트리: `src/core/agent/agent-registry.ts` (에페메럴 등록/해제)
- 생명주기: `src/core/workflow/orchestrator.ts`의 `spawnConsultant()` / `disposeConsultant()`

## 문서
- [PRD](docs/PRD.md) - 전체 제품 요구사항 문서

## 해결 기록
문제 해결 과정은 `docs/troubleshooting/` 디렉토리에 기록하고 여기서 참조합니다.
- [Zod 스키마 기본값 문제](docs/troubleshooting/zod-default-schema.md) - nested object에 .default({}) 필요
- [회의 초대 파싱 실패](docs/troubleshooting/meeting-invite-parse-failure.md) - 에이전트가 content에 객체를 저장하여 JSON.parse 실패 / from 필드 누락 시 폴백 추론
- [E2E 테스트 인프라 구축](docs/troubleshooting/e2e-test-infrastructure.md) - tmux/Claude CLI 의존성 격리, MockTmuxAdapter, WorkflowEngine 폴링 race 방지
- [에이전트 진실성 강제](docs/troubleshooting/agent-truthfulness.md) - hallucination 방지 룰을 시스템 프롬프트 최상단에 주입 (PromptBuilder + ConsultantFactory)
- [kanban.json 동시 쓰기 race](docs/troubleshooting/kanban-concurrent-write-race.md) - FileStore 잠금 TOCTOU + 공유 tmp 경로 + 백그라운드 워크플로우 취소(AbortSignal)
- [tmux "command too long"](docs/troubleshooting/tmux-command-too-long.md) - tmux `new-session` 의 ~16KB 인자 한도. 긴 명령은 셸 스크립트 파일로 분리하여 `bash /path` 로 실행
- [에이전트 작업 언어 설정](docs/troubleshooting/agent-language-setup.md) - setup에서 선택한 언어를 config.localization 에 저장하고 PromptBuilder가 시스템 프롬프트 최상단에 주입
- [디자이너 디자인 시스템 생명주기](docs/troubleshooting/designer-design-system-lifecycle.md) - Designer 3단계 생명주기(부트스트랩/기반 디자인/최신화) 개념 — v0(Pencil) 기록용. 산출물 형식은 아래 HTML 스택 문서가 우선
- [Pencil → HTML+CSS 디자인 스택 전환](docs/troubleshooting/design-html-stack-migration.md) - Designer 산출물이 HTML 목업(토큰 기반) + Design Canvas(/design)로 통일. CTO 도 HTML 시안으로 개발. tokens.css/components.css/meta.json 규약 + mockup-scanner + 대시보드 라우트 구성
- [대시보드 UI 리뉴얼](docs/troubleshooting/dashboard-ui-redesign.md) - Claude 디자인 토큰(coral/moss/amber + serif display) 도입, 모바일 우선 반응형(bottom sheet 모달, 가로 스크롤 네비/칸반/카테고리), API·상태 구조는 불변 유지
- [대시보드 Design 탭 누락](docs/troubleshooting/dashboard-design-tab-missing.md) - `/design` 라우트·canvas.html 은 구현됐지만 SPA 상단 네비 탭 배열에 항목이 없어 진입 불가. `renderNav` 탭 + `renderDesign()` iframe 임베드로 해결. 백엔드 라우트 추가 시 SPA 네비 갱신 확인 규칙화
- [세션 시작 맥락 로딩 강제](docs/troubleshooting/session-context-bootstrap.md) - 각 새 세션이 본인 역할 관련 파일(kanban/sprints/decisions/meetings/metrics)을 첫 행동으로 읽게 하고 완료 신호를 강제
- [tmux 자동 설치](docs/troubleshooting/tmux-auto-install.md) - npm postinstall + start 시점 두 단계 폴백. macOS+brew 는 자동 실행, Linux 는 sudo 명령어 안내만
- [같은 역할 동시 디스패치 → duplicate session](docs/troubleshooting/duplicate-tmux-session-same-role.md) - tmux 세션명이 `ip-<role>` 이라 같은 역할에 할당된 태스크 2개 이상이 병렬로 워크플로우에 진입하면 충돌. Orchestrator 에 `processingRoles` 락을 추가해 역할 단위로 직렬화. 새 dispatch 경로 추가 시 이 락 유지 필수. MockTmuxAdapter 도 duplicate 이름을 throw 하도록 변경됨
- [재시도 소진이 거짓 성공으로](docs/troubleshooting/workflow-retry-exhaustion-false-success.md) - `WorkflowEngine.runWorkflow` 가 `workflowSucceeded = !aborted()` 로만 판정해서 재시도 소진(break)도 성공 처리. `nextPhase === null` 에 도달한 성공 경로에서만 `workflowSucceeded = true` 로 set 하도록 변경. **규칙: 복수 종료 경로 루프에서 "성공"은 반드시 성공 조건 성립 지점에서만 true 로 표시하고, 루프 바깥에서 역추론하지 말 것.**
- [metrics.json 스키마 드리프트](docs/troubleshooting/metrics-store-schema-drift.md) - 에이전트가 자유 형식으로 `metrics.json` 을 덮어쓰면 `MetricsManager` 평가 루틴이 `undefined.some(...)` 로 크래시. `isTaskMetrics` 타입가드 도입, `getTasksNeedingEvaluation`/`getTaskMetrics` 가 불일치 엔트리는 건너뛰거나 null 반환. **규칙: 에이전트가 쓰는 파일(JSON/MD)을 소비하는 쪽은 반드시 타입가드로 좁힐 것. `FileStore.read()` 결과는 unknown 취급.**
- [기동 시 in_progress 고아 재개](docs/troubleshooting/startup-resume-in-flight-tasks.md) - `processNewTasks` 는 `backlog`/`todo` 만 픽업하므로 비정상 종료 후 남은 `in_progress`/`testing`/`review` 태스크가 방치됨. `Orchestrator.resumeInFlightTasks()` 를 신설해 `start()` 1회 호출. `task.phase` 부터 재개, `isAgentRunning` 으로 실제 세션 중복 체크. 공통 디스패치는 `dispatchWorkflow()` helper 로 통합. **규칙: 새 `TaskStatus`/phase 를 추가하면 `resumeStatuses` 셋을 같이 갱신. 런타임 디스패치(`processNewTasks`)와 기동 재개(`resumeInFlightTasks`) 경계는 섞지 말 것.**
- [페이즈 산출물 파일명 불일치 → 재시도 루프](docs/troubleshooting/planning-output-filename-mismatch.md) - 에이전트가 의미 기반 파일명(`mvp-core-features.md`)으로 기획 문서를 저장하는데 워크플로우는 `feature-<slug>.md` 를 기대 → 실패 재시도. `startAgent` 에 `expectedOutputs`/`completionCriteria` 를 전달해 태스크 지시에 필수 산출물 경로를 명시. **규칙: 페이즈 추가 시 기대 산출물 경로를 반드시 지시에 주입. 시스템 프롬프트는 역할 불변, 경로/파일명은 태스크별 지시.**
- [development 페이즈 컴포넌트 단위 분할 + 5종 테스트 강제](docs/troubleshooting/development-component-split.md) - CTO development 가 600초 단일 타임아웃에 자주 걸리고, 한 세션에 너무 많은 컴포넌트를 우겨넣어 막힘. `development` → `development-plan` / `development-component`(컴포넌트마다 인스턴스) / `development-integrate` 로 분할. `Phase.timeoutMs` 도입(페이즈별 타임아웃). `components.json` 매니페스트 SSOT 신설(`isComponentManifest` 가드). 컴포넌트마다 unit/UI/snapshot/integration/E2E 5종 테스트 산출 강제. PromptBuilder 가 `phaseName`+`componentSpec` 받아 페이즈별 룰 주입. 옛 `development` phase 는 `resolvePhaseAlias` 로 자동 마이그레이션. **규칙: 새 페이즈 추가 시 (1) `WorkflowPhase` 타입 갱신, (2) `phases.ts` 빌더에 위치+`timeoutMs` 명시, (3) 폐기되는 옛 페이즈명은 `resolvePhaseAlias` 에 매핑 추가, (4) `resumeInFlightTasks` 의 `resumeStatuses` 일치 확인.**

## 테스트
- 단위 테스트: `npm run test:unit` — `tests/unit/`
- E2E 테스트: `npm run test:e2e` — `tests/e2e/` (~39 tests, ~5–7초)
- 전체: `npm test`

E2E 는 tmux/Claude CLI 를 MockTmuxAdapter 로 대체하되 파일시스템·chokidar·Express
는 실제 구현을 사용한다. 상세 구조와 주입 포인트는 위 troubleshooting 문서 참고.
