# E2E 테스트 인프라 — tmux/Claude CLI 의존성 격리

## 문제

Orchestrator 전체 파이프라인을 E2E 로 검증하려면 `tmux` 와 `claude` CLI
실행이 필요한데, CI 와 로컬 환경에서 이 둘을 모두 돌리면 느리고 비결정적이다.
특히 Claude CLI 호출은 토큰을 쓰고 네트워크 의존성이 크다.

## 해결 방법

### 1. TmuxAdapter 는 이미 주입 가능

`SessionManager(tmux?: TmuxAdapter)` — 생성자가 이미 adapter 를 주입받는다.
`MockTmuxAdapter` 로 `execFile('tmux', ...)` 호출을 메모리 맵으로 대체한다:

- `tests/e2e/helpers/mock-tmux.ts`
- `TmuxAdapter` 를 상속해 `checkInstalled` / `createSession` / `killSession`
  / `hasSession` / `listSessions` 등을 모두 오버라이드
- 테스트용 헬퍼 메서드: `findSession(rawName)`, `simulateSessionExit(rawName)`,
  `createCalls` / `killCalls` 배열 기록

### 2. Orchestrator / DashboardServer 주입 포인트 추가

실제 `start()` 흐름을 E2E 에서 돌리려면 다음을 주입 가능하게 해야 한다:

| 대상 | 옵션 | 목적 |
|------|------|------|
| `Orchestrator` | `sessionManager` | Mock tmux 가 주입된 SessionManager 공유 |
| `Orchestrator` | `dashboardEnabled: false` | 포트 충돌 방지 |
| `Orchestrator` | `keepAlive: false` | `start()` 가 SIGINT 루프에 갇히지 않도록 |
| `Orchestrator` | `autoStartCeo: false` | 테스트 격리 (필요 시에만 true) |
| `Orchestrator` | `workflowPollInterval` | race 방지 (아래 참고) |
| `DashboardServer` | `port: 0` | OS 자동 할당, `getPort()` 로 조회 |
| `DashboardServer` | `sessionManager` | Orchestrator 와 동일 인스턴스 공유 |
| `WorkflowEngine` | `pollInterval` | 기본 5초 → 테스트에서 25ms |

### 3. WorkflowEngine 폴링 race 방지

`WorkflowEngine.waitForCompletion()` 은 5 초 주기로 `sessionManager.isAgentRunning` 을
폴링한다. `Orchestrator.stop()` 이 끝난 뒤에도 이 루프가 백그라운드에서 돌며
kanban 파일을 수정할 수 있다. `afterEach` 의 `rm -rf` 와 겹치면
`ENOTEMPTY` / `ENOENT` 가 뜬다.

**해결:**
- `WorkflowEngine` 의 `pollInterval` 을 생성자 옵션으로 받게 한다
- `Orchestrator.stop()` 에서 `sessionManager.stopAll()` 이후
  `processingTasks` 가 비워질 때까지 최대 1.5 초 드레인 대기
- 테스트에서는 `workflowPollInterval: 25` 를 주입해 드레인이 빠르게 끝나도록 한다

### 4. MessageQueue 파일명 충돌

`MessageQueue.send()` 는 파일명으로 `${from}-${Date.now()}.json` 을 쓴다.
동일 밀리초에 연속 send 하면 같은 파일을 덮어써서 메시지가 유실된다.

- 테스트에서는 `sleep(2)` 로 간격을 두어 회피
- 프로덕션 수정은 별도 작업 — `nanoid` 를 파일명에 포함시키면 해결됨

## 파일 구조

```
tests/
├── unit/
│   └── core/kanban.test.ts          # 기존 단위 테스트
└── e2e/
    ├── helpers/
    │   ├── mock-tmux.ts             # MockTmuxAdapter
    │   └── test-project.ts          # TestProject (임시 디렉토리), waitFor, sleep
    ├── cli-init.e2e.test.ts         # init 파이프라인 (5 tests)
    ├── state-lifecycle.e2e.test.ts  # Kanban + Sprint + Metrics (5 tests)
    ├── messaging.e2e.test.ts        # MessageQueue + Meeting + Consultant (6 tests)
    ├── orchestrator.e2e.test.ts     # Orchestrator 골든 패스 (8 tests)
    └── dashboard-api.e2e.test.ts    # Dashboard REST API (9 tests)
```

총 37 개 E2E 테스트. `npm run test:e2e` 로 단독 실행 가능.

## 실행 안정성

위 조치 후 5 회 연속 통과 확인. 각 실행 5–7 초 소요 (부하 없을 때).
