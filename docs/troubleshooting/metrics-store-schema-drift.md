# `metrics.json` 스키마 드리프트로 평가 루틴 크래시

## 증상
```
✗ 메트릭스 평가 오류: Cannot read properties of undefined (reading 'some')
```

`WorkflowEngine.runMetricsCheckIfNeeded` 가 호출하는
`MetricsManager.getTasksNeedingEvaluation()` 내부에서
`evaluations.some(...)` 이 터짐.

## 원인
`metrics.json` 파일의 실제 내용이 `MetricsManager` 가 기대하는 스키마와 달랐다.

기대:
```json
{ "tasks": { "<id>": { "plan": { "metrics": [], "checkpoints": [], "measurement_end": "..." }, "evaluations": [] } } }
```

실제 (CEO 에이전트가 자유 서술로 작성):
```json
{ "tasks": { "1": { "status": "completed", "metrics_achieved": {...} } } }
```

- `plan` 도 `evaluations` 도 없다 → 프로퍼티 접근이 `undefined.some(...)` 크래시로 이어짐.
- `MetricsManager` 는 FileStore 로 JSON 을 읽기만 할 뿐 스키마 검증을 하지 않았다.
- 에이전트가 스프린트 단위 자유 구조로 같은 파일을 덮어써도 막을 방법이 없다.

## 해결 패턴
**시스템 경계(파일 → 코드)에서 스키마 가드**.

`isTaskMetrics(value)` 타입가드를 도입하고, 평가 루틴은 이 가드를 통과한 엔트리만 평가 대상으로 삼는다.

```ts
function isTaskMetrics(value: unknown): value is TaskMetrics {
  if (!value || typeof value !== 'object') return false;
  const v = value as { plan?: unknown; evaluations?: unknown };
  if (!v.plan || typeof v.plan !== 'object') return false;
  const plan = v.plan as { metrics?: unknown; checkpoints?: unknown };
  return Array.isArray(plan.metrics) && Array.isArray(plan.checkpoints) && Array.isArray(v.evaluations);
}
```

- `getTasksNeedingEvaluation` 은 가드 실패 엔트리를 건너뛴다 → 크래시 대신 "평가 대상 없음".
- `getTaskMetrics` 도 가드 실패 시 `null` 반환 → 하위 소비자(`buildMetricsEvalInstruction` 등)의 `plan.metrics.map(...)` 같은 접근도 안전.

## 재발 방지
- **파일 기반 SSOT 는 읽는 쪽에서 반드시 가드**: 에이전트가 쓰는 JSON/Markdown 은
  언제든 스키마 밖으로 나갈 수 있다. `FileStore.read()` 결과는 `unknown` 취급하고,
  사용 직전에 타입가드 또는 zod 스키마로 좁힐 것.
- 에이전트에게 스키마를 강제하려면 프롬프트에 포맷 예시 + "다른 구조 금지" 명시.
  단, 프롬프트는 best-effort 이므로 읽는 쪽 가드는 별도로 유지.
- 같은 위험이 있는 파일: `kanban.json`, `sprints.json`, `messages/*.json`,
  `docs/decisions/*.md` 프론트매터 등. 소비자 쪽에 가드가 있는지 점검.
