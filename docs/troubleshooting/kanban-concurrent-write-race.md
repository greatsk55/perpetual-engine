# kanban.json 동시 쓰기 race (rename ENOENT)

## 증상
`perpetual-engine start` 후 다수의 태스크(5개 이상)가 동시에 planning 페이즈로 진입할 때:

```
✗ [9] 워크플로우 예외 발생: ENOENT: no such file or directory,
    rename '.../kanban.json.tmp' -> '.../kanban.json'
✗ [15] 워크플로우 예외 발생: ENOENT: no such file or directory,
    rename '.../kanban.json.tmp' -> '.../kanban.json'
```

## 원인
`src/core/state/file-store.ts` 의 잠금·원자적 쓰기 로직에 세 가지 결함이 있었다.

1. **TOCTOU race in `acquireLock()`**
   - 기존 구현: `if (!existsSync(lockPath)) { await writeFile(lockPath, ...) }`
   - `existsSync` 체크와 `writeFile` 호출 사이에 다른 async 오퍼레이션이 같은 체크를 통과 →
     여러 호출이 동시에 "잠금을 획득했다"고 판단.

2. **동일한 tmp 경로 공유**
   - 모든 쓰기가 `kanban.json.tmp` 하나를 공유.
   - 동시 쓰기가 일어나면:
     1. A 가 tmp 에 write, B 가 tmp 에 write (overwrite)
     2. A 가 `rename(tmp, target)` 성공 → tmp 파일 사라짐
     3. B 가 `rename(tmp, target)` → **ENOENT**

3. **프로세스 내 순차화 부재**
   - `KanbanManager.moveTask`, `updateTaskPhase` 등이 여러 워크플로우에서 동시에 호출되어도
     동일 파일에 대한 직렬화 장치가 없었다.

## 해결
`src/core/state/file-store.ts`:

- **원자적 잠금**: `fs.open(lockPath, 'wx')` (O_CREAT | O_EXCL) 로 대체.
  - EEXIST 면 stale lock 체크 후 재시도.
- **유니크 tmp 경로**: `${filePath}.${pid}.${randomHex}.tmp` 형태로 각 쓰기마다 고유 경로 사용.
- **프로세스 내 Promise 큐**: 동일 절대 경로의 `write`/`update` 를 Map 기반 체인으로 직렬화.

추가로, 테스트가 파일잠금 버그를 우연히 요구하고 있던 경우에 대한 보호:

- `KanbanManager.moveTask` 에 **suspended 보호 가드**를 추가.
  - `status === 'suspended'` 인 태스크는 `resumeTask` 경로로만 복원 가능.
- `WorkflowEngine.runWorkflow` 가 `AbortSignal` 을 받음.
  - `Orchestrator` 가 `workflowAborters: Map<taskId, AbortController>` 로 관리.
  - `suspendTask` / `stop()` 시 해당 워크플로우를 abort → 백그라운드 워크플로우가
    `moveTask('todo'/'done')` 로 외부 상태를 덮어쓰지 않는다.

## 교훈
- Node.js 에서 `existsSync` + `writeFile` 조합은 **절대 원자적 잠금이 아니다**. 반드시
  `fs.open(path, 'wx')` 를 사용할 것.
- 여러 async 오퍼레이션이 같은 파일을 쓸 때는 프로세스 내 뮤텍스(또는 Promise 큐)로
  명시적으로 직렬화해야 한다.
- 백그라운드 루프가 공유 상태를 쓴다면 취소 신호(AbortController)를 관통시켜
  외부 상태 변경을 덮어쓰지 않도록 해야 한다.

## 관련 테스트
- `tests/unit/core/file-store.test.ts` — 동시 update/write, 유니크 tmp, lock 미잔존 검증
- `tests/e2e/orchestrator.e2e.test.ts > suspend → resume` — 백그라운드 워크플로우가
  사용자 suspend 를 덮어쓰지 않음을 검증
