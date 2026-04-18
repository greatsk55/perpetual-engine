# development 페이즈 컴포넌트 단위 분할 + 5종 테스트 강제

## 증상
- CTO `development` 페이즈가 600초 하드코딩 타임아웃에 자주 걸림 (`waitForCompletion` 강제 종료 → 재시도 루프).
- 한 세션에서 여러 컴포넌트를 한 번에 구현하려다 입력 컨텍스트 폭증 + 막힌 컴포넌트 1개가 전체를 막음.
- 산출물에 unit/UI/snapshot/integration/E2E 테스트가 모두 포함되지 않은 채 "구현 완료"로 판정되는 경우 발생.

## 원인
- `WorkflowEngine.waitForCompletion(role, maxWait = 600000)` 이 모든 페이즈에 동일한 10분 타임아웃을 적용.
- `WORKFLOW_PHASES` 가 정적 배열이라 development 페이즈가 단일 거대 단위로만 정의됨 — 컴포넌트 단위로 쪼갤 메커니즘 없음.
- 테스트 종류별 산출 강제가 없음 (시스템 프롬프트에서 권고만, expectedOutputs 검증은 한 개 마크다운 파일만 확인).

## 해결
1. **페이즈 분할** ([phases.ts](../../src/core/workflow/phases.ts)): `development` 를 3개로 분할.
   - `development-plan` (CTO, 15분): `tech-stack.md` + `components.json` 산출. 코드는 한 줄도 안 만든다.
   - `development-component` (CTO, 컴포넌트마다 인스턴스화, 15분/회): 한 컴포넌트만 구현 + 5종 테스트(unit/UI/snapshot/integration/E2E) 전부 작성.
   - `development-integrate` (CTO, 15분): 통합 빌드/테스트 + `feature-<slug>.md` 산출.
2. **컴포넌트 매니페스트 SSOT** ([components.ts](../../src/core/workflow/components.ts)): `ComponentManifest` 스키마 + `isComponentManifest` 가드. development-plan 이 작성하면 워크플로우 엔진이 읽어 컴포넌트별 페이즈를 동적으로 펼친다.
3. **페이즈별 타임아웃** ([phases.ts](../../src/core/workflow/phases.ts) + [workflow-engine.ts](../../src/core/workflow/workflow-engine.ts)): `Phase.timeoutMs` 옵셔널 필드 추가, `waitForCompletion` 이 페이즈에서 받는다. 미설정 시 `DEFAULT_PHASE_TIMEOUT_MS` (10분).
4. **5종 테스트 강제**: `Phase.outputDocPaths` 에 `componentExpectedOutputs(spec)` (구현 + 5종 테스트) 가 들어가, `checkOutputs` 가 누락 시 페이즈 실패 → 재시도. 도구는 CTO 가 `tech-stack.md` 의 `test_runners` 에서 자유 선택.
5. **컴포넌트 컨텍스트 주입** ([prompt-builder.ts](../../src/core/agent/prompt-builder.ts)): `phaseName` + `componentSpec` 을 시스템 프롬프트에 전달, 페이즈별 룰(컴포넌트 단위 TDD, 5종 테스트, 다른 컴포넌트 수정 금지) 을 동적으로 주입.
6. **옛 phase 마이그레이션** ([phases.ts](../../src/core/workflow/phases.ts) `resolvePhaseAlias`): `task.phase === 'development'` 로 남은 고아 태스크는 자동으로 `development-plan` 부터 다시 시작.

## 동작 흐름
```
planning → design → development-plan
                    ↓ (components.json 작성)
                    development-component[component-1]
                    ↓
                    development-component[component-2]
                    ↓
                    ...
                    development-integrate
                    ↓
                    testing → deployment → documentation
```

워크플로우 엔진은 `development-plan` 완료 직후 `readComponentManifest` 로 매니페스트를 읽어 `buildPhases(taskSlug, manifest)` 를 다시 호출 — 컴포넌트 페이즈가 N개로 펼쳐진다.

## 재발 방지 규칙
- **새 페이즈를 추가할 때**:
  - `WorkflowPhase` 타입에 추가 + `phases.ts` 빌더에 위치 결정 + `Phase.timeoutMs` 명시.
  - 옛 페이즈명을 폐기·rename 한다면 `resolvePhaseAlias` 에 매핑 추가 (마이그레이션 보장).
  - `resumeInFlightTasks` 의 `resumeStatuses` 와 일치하는지 확인.
- **Phase 시그니처 변경 시**: `inputDocPaths`/`outputDocPaths` 가 함수 → 배열로 바뀌었음을 모든 호출자에서 동기화. `executePhase` 가 단일 진입점이지만 시그니처 변경 시 prompt-builder/session-manager 까지 함께 본다.
- **에이전트가 쓰는 JSON (`components.json`)**: 반드시 `isComponentManifest` 가드로 좁힌 뒤 사용. 자유 형식으로 덮어써도 워크플로우 엔진이 크래시하지 않게 한다 ([CLAUDE.md feedback](../../../../.claude/projects/-Users-sunggookkim-Downloads-projectList-Perpetual-Engine/memory/feedback_guard_agent_written_json.md)).
- **5종 테스트 원칙**: development 산출물 검증은 컴포넌트마다 6개 경로(구현 1 + 테스트 5) 가 모두 존재해야 한다. 테스트 도구는 자유지만 종류는 5종 모두 필수.

## 관련 파일
- 페이즈 정의: [src/core/workflow/phases.ts](../../src/core/workflow/phases.ts)
- 매니페스트 스키마/가드: [src/core/workflow/components.ts](../../src/core/workflow/components.ts)
- 워크플로우 엔진: [src/core/workflow/workflow-engine.ts](../../src/core/workflow/workflow-engine.ts)
- 페이즈별 룰 주입: [src/core/agent/prompt-builder.ts](../../src/core/agent/prompt-builder.ts) `buildPhaseRules`
- 단위 테스트: [tests/unit/core/components.test.ts](../../tests/unit/core/components.test.ts), [tests/unit/core/phases.test.ts](../../tests/unit/core/phases.test.ts)
- E2E 마이그레이션 검증: [tests/e2e/orchestrator.e2e.test.ts](../../tests/e2e/orchestrator.e2e.test.ts) "고아 태스크 재개"
