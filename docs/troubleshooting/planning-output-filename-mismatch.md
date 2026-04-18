# 페이즈 산출물 파일명 불일치 → 워크플로우 재시도 루프

## 증상
planning 페이즈가 에이전트 세션 종료 후 계속 실패 재시도:
```
✗ [2] planning 산출물 누락: docs/planning/feature-2.md
⚠ [2] planning 실패 → planning로 재시도
→ [2] planning 페이즈 시작 (담당: po) [재시도 1/2]
```

`docs/planning/` 을 보면 에이전트는 기획 문서를 **생성했지만** 파일명을 `mvp-core-features.md`, `ai-cfo-user-personas.md` 처럼 **의미 기반**으로 붙이고, 워크플로우가 기대하는 `feature-<taskSlug>.md` 와 어긋남.

## 원인
- 페이즈 정의 ([src/core/workflow/phases.ts](../../src/core/workflow/phases.ts)) 의 `outputDocPaths` 는 `docs/planning/feature-<taskSlug>.md` 형태의 **기계적 슬러그** 파일명을 요구.
- 하지만 에이전트에게 전달되는 태스크 지시 ([src/core/session/session-manager.ts](../../src/core/session/session-manager.ts) 의 `startAgent`) 는 제목/설명/수용 기준만 포함하고, **기대 산출물 경로를 명시하지 않음**.
- 에이전트 시스템 프롬프트에는 "기획 문서는 docs/planning/에 작성한다" 수준의 가이드만 있어 파일명을 자유 서술형으로 붙임.
- 워크플로우 엔진은 세션 종료 후 `checkOutputs(outputPaths)` 로 파일 존재 여부만 확인 → `feature-2.md` 가 없으니 실패 → `onFailure=planning` 로 회귀 → 재시도 2회 소진 후 todo 복귀.

## 해결
`startAgent` 에 `expectedOutputs`, `completionCriteria` 옵션 추가하고, `executePhase` 가 페이즈의 `outputDocPaths(slug)` 와 `completionCriteria` 를 그대로 전달한다. 태스크 지시 하단에 "필수 산출물 (파일명 정확히)" 블록이 주입되어, 에이전트가 의미 이름을 쓰더라도 **지정 경로의 파일을 반드시 생성**하게 된다. 의미 있는 이름은 별도 파일로 추가하거나 필수 파일 안에서 제목으로 표현하도록 안내.

## 재발 방지
- **새 페이즈 정의 추가 시**: `outputDocPaths` 의 파일명 컨벤션을 에이전트가 알 수 없다는 점을 염두에 두고, **반드시 `expectedOutputs` 로 태스크 지시에 전달**한다.
- 에이전트 시스템 프롬프트는 저장 위치만 안내하고, **파일명은 태스크 지시에 명시** 하는 것이 역할 분담에 맞다 (프롬프트는 역할 불변, 지시는 태스크별 가변).
- 워크플로우 엔진의 `checkOutputs` 가 파일 존재만 보기 때문에 "산출물이 실제로 기획 문서인가" 는 검증 못함 — 에이전트가 빈 파일만 만들어도 통과한다는 한계는 있음. 향후 minimum size 또는 required section 검증을 추가할 수 있음.

## 관련 파일
- 지시 주입: [src/core/session/session-manager.ts](../../src/core/session/session-manager.ts) `startAgent`
- 전달: [src/core/workflow/workflow-engine.ts](../../src/core/workflow/workflow-engine.ts) `executePhase`
- 페이즈 스펙: [src/core/workflow/phases.ts](../../src/core/workflow/phases.ts)
