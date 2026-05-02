# development-component: 같은 세션 내 테스트 실행 루프

## 증상 / 동기

- 기존 `development-component` 페이즈는 unit/UI/snapshot/integration/E2E 5종 테스트를 **모두** 작성하도록 강제했지만, 실제로 테스트가 통과했는지는 **파일 존재 여부만** 검증했다.
- 결과적으로 에이전트가 빈 셸 테스트만 만들고 통과 여부 검증 없이 종료해도 워크플로우 엔진은 "성공" 처리.
- 또한 5종 모두 강제는 작은 컴포넌트엔 과해서 5–15분 컴포넌트 한 개에 시간을 낭비.

## 변경 정책

1. **unit + ui 만 필수**, snapshot/integration/e2e 는 선택. 매니페스트(`components.json`)의 `test_paths` 와 `tech_stack.test_runners` 가 unit/ui 두 종만 있으면 통과.
2. `tech_stack.test_runners` 의 각 항목은 `string`(도구명만) 또는 `{ tool, command }` 객체.
   - 객체 형태 + `command` 가 있으면 워크플로우 엔진이 `bash -lc <command>` 로 직접 실행해서 종료코드 0 일 때만 페이즈 통과.
   - 문자열만 있으면 자동 실행을 건너뛴다 (옛 매니페스트 하위 호환).
3. `development-component` 페이즈가 끝날 때 워크플로우 엔진이 다음 순서로 검증:
   1. 산출물 파일 존재 (구현 + declared 테스트 파일들).
   2. 실행 가능한(`command` 있는) 종류를 순서대로 Bash 실행 — 첫 실패에서 멈춤.
   3. 결과를 `docs/development/feature-<task-slug>/components/<comp-slug>.test-output.md` 에 항상 기록 (성공이든 실패든).
4. 한 종류라도 실패하면 페이즈 fail → 같은 페이즈 자동 재시도. 다음 시도 세션의 `inputDocPaths` 에 위 `.test-output.md` 가 포함되어, 에이전트가 실패 출력을 보고 코드를 고친다.
5. 시스템 프롬프트(`development-component` 룰)도 "구현 + 테스트를 같은 세션에서 작성하고, **Bash 로 직접 테스트 명령을 실행해 통과시킨 뒤** 종료" 라고 명시.

## 영향 범위

- `src/core/workflow/components.ts` — 스키마, 가드, `componentExpectedOutputs`, 새 헬퍼 `declaredTestKinds` / `executableTestKinds` / `componentTestOutputPath` / `getRunnerCommand`. `TestRunner = string | { tool, command }` 유니언 도입.
- `src/core/workflow/test-runner.ts` (신규) — `runComponentTests`, `persistTestOutput`. 명령 실행은 `bash -lc`, 64KB 출력 캡, 5분 기본 타임아웃, AbortSignal 전파.
- `src/core/workflow/workflow-engine.ts` — `executePhase` 가 development-component 페이즈에서 산출물 검증 후 `runComponentTests` 실행 → 실패 시 false 반환 → onFailure 가 자기 자신이라 같은 페이즈 자동 재시도.
- `src/core/workflow/phases.ts` — completionCriteria 텍스트 갱신, `inputDocPaths` 에 직전 시도의 `.test-output.md` 경로 추가.
- `src/core/agent/prompt-builder.ts` — development-plan/component 룰 갱신 (unit+UI 필수, `command` 권장, Bash 자체 실행 루프, 자동 재시도 안내). `buildComponentContext` 헬퍼로 선언된 선택 테스트만 노출.

## 규칙 (다음 변경 시 주의)

1. **새 테스트 종류 추가 시**: `TestKind` 유니언 + `REQUIRED_TEST_KINDS`/`OPTIONAL_TEST_KINDS` + `isComponentTechStack`/`isComponentSpec` 가드 + `componentExpectedOutputs` 4곳을 함께 갱신. 누락하면 가드는 통과해도 검증/프롬프트가 어긋난다.
2. **에이전트가 쓰는 JSON 은 읽는 쪽에서 가드한다** — `TestRunner` 유니언도 `isTestRunner` 로 좁혀라 (CLAUDE.md SSOT 룰).
3. **테스트 명령 실행은 사이드이펙트가 강하다** — 새로 추가하는 자동 실행 단계는 반드시 `AbortSignal` 을 받아 stop()/urgent 인터럽트와 협조해야 한다. `runComponentTests` 가 패턴 참고.
4. **재시도 컨텍스트는 파일로 전달한다** — 같은 페이즈 재진입 시 inputDocPaths 에 직전 결과 파일을 노출하는 패턴(`.test-output.md`)을 다른 페이즈에도 동일하게 적용 가능. 단, 컴포넌트 인스턴스마다 다른 경로여야 인스턴스 간 오염이 없다.
5. **워크플로우 엔진이 명령을 실행하는 경로는 `bash -lc`** — 사용자 PATH/nvm/ asdf 환경을 반영해야 `npx`/`pnpm` 등이 동작한다. 컨테이너/CI 에서 다른 셸을 써야 하면 spawn 옵션을 추상화하라.
