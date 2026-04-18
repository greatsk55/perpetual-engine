# 워크플로우 재시도 소진이 성공으로 기록되던 버그

## 증상
```
✗ [16] planning 산출물 누락: docs/planning/feature-16.md
⚠ [16] planning 실패 → planning로 재시도
✗ [16] planning 최대 재시도 횟수(2) 초과
✓ [16] 워크플로우 완료          ← 이게 찍히면 안 됨
✗ 메트릭스 평가 오류: Cannot read properties of undefined (reading 'some')
```

- 기획 문서(`docs/planning/feature-16.md`)가 생성되지 않아서 페이즈 검증이 계속 실패
- 2회 재시도 후 루프 break 로 빠져나오는데, 태스크가 `done` 으로 이동하고 메트릭스 평가까지 트리거됨

## 원인
`src/core/workflow/workflow-engine.ts` 의 `runWorkflow` 가 워크플로우 성공 여부를
`workflowSucceeded = !aborted()` 한 줄로만 판정했다. 이 수식은 세 가지 종료 경로를 구분하지 못한다:

1. 모든 페이즈가 정상 완료 (nextPhase=null 까지 도달)
2. 재시도 소진(MAX_PHASE_RETRIES) → `break`
3. `onFailure` 가 없는 페이즈 실패 → `break`

abort 만 아니면 전부 "성공" 으로 처리돼서, 실제로는 산출물이 하나도 없는데 태스크가 `done` 으로 이동했다.

## 해결 패턴
**"succeeded" 플래그는 성공 경로 한 곳에서만 set 한다.**
루프 바깥에서 "abort 아닌 모든 경로 = 성공" 으로 추론하는 대신, `nextPhase === null` 에
도달한 순간에만 `workflowSucceeded = true` 로 명시적으로 표시.

```ts
if (success) {
  currentPhaseName = phase.nextPhase;
  if (currentPhaseName === null) {
    workflowSucceeded = true; // 여기서만 true
  }
}
```

이렇게 하면 break(재시도 소진/회귀 불가)로 빠져나온 케이스는 자동으로 `false` 유지 → 태스크는 `todo` 로 복구된다.

## 재발 방지
- **플래그는 "성공 경로"에서만 set**: 복수의 종료 경로가 있는 루프에서 "성공" 을
  "아닌 걸 빼고 추론" 하지 말 것. 성공 조건이 성립하는 지점에서만 true 로 집는다.
- 같은 패턴이 재현될 만한 곳: 세션 완료 판정, 회의 성공 판정, 배포 판정 등.
