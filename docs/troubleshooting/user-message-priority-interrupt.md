# 사용자 메시지 우선순위 처리 + 진행 중 워크플로우 인터럽트

## 증상
사용자가 `perpetual-engine message "<지시>"` 로 보낸 directive 가 즉시 반영되지 않고
다른 백그라운드 메시지/워크플로우 뒤로 밀려서 처리됐다.

구체적으로:
1. `MessageQueue.getAll()` 이 `created_at` 만으로 정렬해 시스템 자동화 메시지가
   먼저 와 있으면 사용자 directive 가 그 뒤에 처리됐다.
2. 진행 중인 같은 역할의 워크플로우가 있으면 사용자 메시지가 도착해도
   `stopAgent()` 만 호출되고 워크플로우 `AbortController` 가 같이 트리거되지 않아
   세션이 중복 시도되거나 워크플로우가 늦게 fail 처리됐다.
3. 인터럽트 후 원래 진행하던 태스크가 재픽업되지 않고 표류했다.

## 원인
- **`Message` 에 `priority` 필드 없음** — 모든 메시지가 동등하게 created_at 순으로만 처리됨.
- **인터럽트 경로 부재** — `processNewMessages()` 가 `processingRoles` 락이나
  `workflowAborters` 와 연결되지 않아 진행 중 태스크를 우선순위로 깨울 방법이 없었다.
- **abort 후 태스크 복구 책임 불명확** — `WorkflowEngine.runWorkflow` 는 abort 시
  최종 상태 전환을 하지 않으므로, 외부에서 명시적으로 재픽업 가능한 상태로
  되돌려놓지 않으면 task 가 in_progress 그대로 남아 다음 칸반 이벤트에 픽업 안 됨.

## 해결
3-step 패턴: **priority 필드 + 정렬 + 인터럽트 + 자동 재개**.

### 1. `Message.priority` 도입 (SSOT)
[src/core/messaging/message-queue.ts](../../src/core/messaging/message-queue.ts)
- `priority?: 'urgent' | 'normal'` 추가 (기본 `'normal'`).
- `MessageQueue.send({ ..., priority })` 로 명시 가능.
- `getAll()` 정렬: `urgent` 가 항상 `normal` 앞, 같은 우선순위끼리는 `created_at` 오름차순.

이걸로 큐 단위에서 자동으로 사용자 메시지가 먼저 디스패치된다.

### 2. CLI 가 사용자 메시지에 `urgent` 자동 부여
[src/cli/commands/message.ts](../../src/cli/commands/message.ts)
- `perpetual-engine message <msg>` 가 기본 `priority='urgent'` 로 메시지 파일을 쓴다.
- 백그라운드 자동화 용도로 normal 로 보내고 싶으면 `--normal` 옵션.
- `--to <role>` 옵션도 함께 추가 (기존엔 항상 `to: 'all'` 이라 ceo 한정).

### 3. Orchestrator 인터럽트 + 자동 재개
[src/core/workflow/orchestrator.ts](../../src/core/workflow/orchestrator.ts)
- `processNewMessages()` 는 `getAll()` 정렬 결과를 그대로 순회하므로 별도 정렬 코드 불필요.
- urgent 이고 `directive`/`request` 타입이면 `interruptRoleForUrgentMessage(role, msg)` 호출.
- 인터럽트 절차:
  1. `findActiveTaskForRole(role)` 로 `processingRoles` 에서 같은 역할의 활성 태스크 id 조회.
  2. `workflowAborters.get(taskId).abort()` 로 진행 중 워크플로우에 중단 신호.
  3. **워크플로우의 `release()` 가 락을 정리할 때까지 최대 500ms 대기** — 락이 풀린 시점에 워크플로우의 마지막 kanban 쓰기/세션 정리도 끝나 있다. 이 짧은 대기를 빼먹으면 후속 `moveTask('todo')` 가 워크플로우의 비동기 후처리와 race 해서 cleanup 시 ENOENT 가 난다.
  4. 시간 초과 시 강제로 `processingTasks` / `processingRoles` 락 해제 (메시지 세션이 같은 역할의 tmux 세션을 시작해야 하므로 무한정 기다리진 않는다).
  5. `kanban.moveTask(taskId, 'todo')` — `task.phase` 는 그대로 보존. 메시지 세션이 끝나면 칸반 워처가 픽업해 저장된 phase 부터 자연스럽게 재개된다.

추가로 `Orchestrator.workflowPromises: Set<Promise<void>>` 를 두고 `dispatchWorkflow` / `forceRunTask` 가 디스패치한 워크플로우 promise 를 추적한다. `drainProcessingTasks()` 는 락뿐 아니라 이 promise 들이 모두 settle 될 때까지 기다려, 인터럽트 후에도 stop()/cleanup() 과의 race 가 생기지 않게 한다.

## 재발 방지

### 규칙
1. **새 메시지 `type` 을 추가할 때 — 인터럽트 대상인지 명시적으로 결정.**
   현재 `directive` / `request` 만 urgent 인터럽트를 받는다. `info`, `meeting_invite`,
   `consultation_request` 처럼 즉시성이 없거나 별도 세션을 새로 만드는 타입은 인터럽트 대상에서 제외.
2. **새 dispatch 경로(태스크 진입)를 추가하면 반드시 `processingRoles` 에 락을 건다.**
   인터럽트 로직이 `processingRoles` 를 역추적해 활성 태스크를 찾으므로,
   락 없이 디스패치하는 경로가 생기면 인터럽트가 그 태스크를 발견하지 못한다.
3. **워크플로우 abort 시 태스크의 최종 상태 전환은 abort 호출자가 책임진다.**
   `WorkflowEngine.runWorkflow` 는 `aborted()` 분기에서 의도적으로 상태 전환을 안 한다.
   suspend / 인터럽트 경로 모두 자기가 원하는 상태(suspended / todo 등)로 명시적으로 되돌려놓아야 함.
4. **메시지 큐 정렬을 `created_at` 단독으로 되돌리지 말 것.**
   priority → created_at 의 2단계 정렬을 `MessageQueue.getAll()` 이 책임진다. 호출 측에서
   별도 정렬을 하면 우선순위가 깨진다.
5. **인터럽트 후 즉시 task 상태를 변경하지 말 것.**
   `release()` 가 락을 정리할 때까지(최대 500ms) 기다린 다음 `moveTask` 를 호출한다.
   이 순서가 어긋나면 워크플로우의 마지막 kanban 쓰기와 race 해서 cleanup 시 ENOENT.
6. **새 워크플로우 디스패치 helper 를 만들면 `workflowPromises` 에 등록할 것.**
   `drainProcessingTasks()` 가 락뿐 아니라 promise 까지 기다려야 stop/cleanup race 가 사라진다.

### 회귀 테스트
- [tests/e2e/messaging.e2e.test.ts](../../tests/e2e/messaging.e2e.test.ts) — `urgent priority 메시지는 normal 메시지보다 먼저 정렬되어 반환된다`
- [tests/e2e/orchestrator.e2e.test.ts](../../tests/e2e/orchestrator.e2e.test.ts) — `urgent directive 메시지가 들어오면 진행 중인 동일 역할 워크플로우를 인터럽트하고 메시지를 우선 처리한다` / `priority=normal 인 directive 는 진행 중 워크플로우를 인터럽트하지 않는다`
