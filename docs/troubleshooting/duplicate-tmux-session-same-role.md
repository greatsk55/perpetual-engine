# 같은 역할 태스크 동시 디스패치 → `duplicate session: ip-<role>`

## 증상
`perpetual-engine start` 직후 PO 에게 할당된 태스크가 2개 이상 동시에 todo 상태이면 두 번째 워크플로우가 즉시 실패한다.

```
ℹ 새 태스크 감지: 9 - 경쟁사 분석 및 포지셔닝
→ [9] planning 페이즈 시작 (담당: po)
ℹ 새 태스크 감지: 16 - 타겟 사용자 페르소나 3종 개발
→ [16] planning 페이즈 시작 (담당: po)
✗ [16] 워크플로우 예외 발생: Command failed: tmux new-session -d -s ip-po …
duplicate session: ip-po
⚠ [16] 워크플로우 실패 → 태스크를 todo로 복구
```

## 원인
- `Orchestrator.processNewTasks` ([src/core/workflow/orchestrator.ts](../../src/core/workflow/orchestrator.ts)) 가 모든 pending 태스크를 **병렬** 로 `runWorkflow` 실행.
- `SessionManager.startAgent` 는 `sessionName = agent.role` 로 tmux 세션을 만든다. 역할이 같은 두 태스크는 같은 이름 `ip-<role>` 을 공유 → tmux 가 `duplicate session` 으로 거절.
- 기존에도 `tmux.hasSession` 가드는 있었지만, 첫 호출이 `activeSessions.set` 에 등록되기 전에 두 번째 호출이 들어오면 race 로 둘 다 생성 시도.

## 해결
**역할 단위 직렬화** — `Orchestrator` 가 `task.assignee` 를 락 키로 써서, 같은 역할이 이미 워크플로우를 진행 중이면 다음 태스크를 대기열에 남겨둔다.

- `processingRoles: Map<taskId, role>` 추가.
- `processNewTasks` 에서 `busyRoles.has(task.assignee)` 면 skip (로그만 남기고 다음 tick 에 재시도).
- 워크플로우 완료/실패/abort 시 `processingRoles.delete(taskId)` 후 `processNewTasks()` 를 재호출해 대기 태스크 즉시 픽업. 칸반 파일 이벤트가 누락돼도 대기 태스크가 멈추지 않는다.
- `forceRunTask`, `suspendTask` 경로도 동일하게 락 관리.

태스크의 phase 가 진행되면서 `assignee` 가 `phase.leadAgent` 로 바뀌어도, 디스패치 시점의 role 을 `processingRoles` 에 저장하므로 락 해제가 일관된다. 즉 task A(po) 가 development(cto) 로 넘어가도 task B(po) 는 task A 의 전체 워크플로우가 끝난 뒤에만 진입 — 보수적이지만 일관적.

## 재발 방지
1. **MockTmuxAdapter 가 실제 tmux 처럼 duplicate 이름을 거부한다** ([tests/e2e/helpers/mock-tmux.ts](../../tests/e2e/helpers/mock-tmux.ts)). 기존에는 silent overwrite 였기 때문에 이 버그가 테스트에 잡히지 않았다.
2. **회귀 테스트** ([tests/e2e/orchestrator.e2e.test.ts](../../tests/e2e/orchestrator.e2e.test.ts)) — `po` 할당 태스크 2개를 동시 생성 후, `po` 세션이 정확히 1개만 만들어지는지 검증.
3. **설계 원칙**: tmux 세션명이 역할 단위이므로 **한 역할당 동시 세션 1개** 가 아키텍처 불변식. 새 dispatch 경로를 추가할 때 이 제약을 반드시 유지한다.

## 참고
- 한계: 보수적 락(디스패치 시점 assignee)이라 같은 역할의 다른 태스크가 불필요하게 대기할 수 있다. 나중에 phase 단위 락으로 세분화하려면 `WorkflowEngine.executePhase` 에서 `phase.leadAgent` 를 키로 acquire/release 하는 방식으로 이동.
- MockTmuxAdapter 가 duplicate 를 throw 하게 된 후, 같은 역할로 직접 `startAgent` 를 두 번 호출하는 테스트는 모두 실패한다. 테스트 작성 시 세션명 충돌이 없도록 주의.
