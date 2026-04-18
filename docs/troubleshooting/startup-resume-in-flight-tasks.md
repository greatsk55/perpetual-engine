# 기동 시 `in_progress` 태스크 자동 재개

## 배경
`perpetual-engine start` 의 초기 스캔([`processNewTasks`](../../src/core/workflow/orchestrator.ts))은 `backlog`/`todo` 만 픽업했다. 이 때문에 다음 상황에서 태스크가 방치됐다:

- 이전 실행이 Ctrl+C/크래시로 비정상 종료 → `in_progress` 로 남음
- 옛 false-success 버그([workflow-retry-exhaustion-false-success.md](./workflow-retry-exhaustion-false-success.md))로 실패 태스크가 `done` 으로 넘어갔더라도, 동시에 `in_progress` 상태로 멈춘 다른 태스크들은 재기동 후에도 움직이지 않음
- 대시보드에는 `in_progress` 로 떠 있지만 실제로는 tmux 세션이 하나도 없는 "좀비" 상태

## 해결
`Orchestrator.resumeInFlightTasks()` 를 신설하고 `start()` 에서 `processNewTasks()` 직전에 1회 호출.

- **재개 대상**: `in_progress` / `testing` / `review` + `assignee` 있음
- **안전장치**: `sessionManager.isAgentRunning(role)` 이 true 면 skip — 이미 다른 경로가 붙어 있다는 뜻이므로 중복 디스패치 금지
- **재개 지점**: `WorkflowEngine.runWorkflow` 가 이미 `task.phase ?? 'planning'` 으로 시작 페이즈를 결정 → 별도 로직 불필요. kanban 에 저장된 `task.phase` 를 그대로 재실행
- **락**: 같은 역할 락(`processingRoles`) 은 `processNewTasks` 와 동일하게 사용. `dispatchWorkflow()` helper 로 두 경로가 공통 디스패치 코드를 공유

## 재발 방지
- **새 상태를 도입할 때 재개 대상 재검토**: 새 `TaskStatus` 나 새 phase 를 추가하면 `resumeInFlightTasks` 의 `resumeStatuses` 셋을 업데이트해야 할 가능성이 크다
- **런타임 디스패치와 기동 재개 경로 분리 유지**: `processNewTasks` 는 `backlog`/`todo` 만. 기동 전용 고아 재개는 `resumeInFlightTasks` 에서만. 이 경계를 섞으면 런타임에 과한 재디스패치가 생길 수 있음
- **디스패치는 반드시 `dispatchWorkflow()` 를 거친다**: 새 경로 추가 시 `processingTasks`/`processingRoles`/`workflowAborters`/release 패턴을 복제하지 말고 helper 재사용
