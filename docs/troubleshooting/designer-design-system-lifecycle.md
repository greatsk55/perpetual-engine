# 디자이너 에이전트: 디자인 시스템 생명주기 강제

> ⚠️ **이 문서는 v0 (Pencil 기반) 이다.** 2026-04-17 부터 Designer 의 산출물은 Pencil → **HTML + CSS 목업**으로 전환되었다. 최신 버전은 [design-html-stack-migration.md](./design-html-stack-migration.md) 참조. 아래의 "3단계 생명주기" 개념은 유지되지만, 산출물 형식과 저장 위치는 HTML 스택 문서를 따른다.

## 배경
초기에는 Designer 에이전트가 피처 시안을 Pencil MCP로 만들기만 하면 완료되는 구조였다. 이로 인해:
- 피처마다 색상·간격·폰트·컴포넌트가 조금씩 달라지는 drift가 발생
- 재사용 가능한 시스템이 없어 프로젝트가 커질수록 일관성이 깨짐
- "일관된 디자인 시스템 유지"라는 규칙이 추상적이어서 실제로는 지켜지지 않음

## 원칙: 디자인 시스템 SSOT + 3단계 생명주기
`docs/design/design-system.md` + Pencil 시스템 시안 파일을 UI의 SSOT로 둔다.

1. **부트스트랩(프로젝트 초기)**: 첫 UI 작업 전에 Pencil 파일로 디자인 시스템을 먼저 확립
   - color palette, typography scale, spacing grid, radius/shadow
   - 기본 컴포넌트(Button/Input/Card/Modal 등) 시안
   - `docs/design/design-system.md` 에 토큰·컴포넌트 명세 문서화
   - `docs/design/mockups/system/` 에 Pencil 시스템 시안 저장
2. **기반 디자인**: 이후 모든 피처 시안은 시스템의 토큰/컴포넌트를 참조해서만 생성
   - 임의 색상·폰트·간격 금지 — 필요하면 시스템에 먼저 추가
   - 피처 시안 문서에 사용 토큰/컴포넌트 목록 명시
3. **주기적 최신화**: 스프린트 회고 또는 피처 시안 5개마다 디자인 시스템 리뷰
   - drift 흡수, 중복 컴포넌트 병합, 사용 안 하는 토큰 정리, 접근성·일관성 개선
   - `design-system.md` 의 CHANGELOG 섹션에 버전·날짜·변경 요약 기록

## 구현 지점
| 파일 | 변경 내용 |
|------|-----------|
| `src/core/agent/agent-defaults.ts` | Designer responsibilities/rules/system_prompt_template 에 생명주기 3단계 주입 |
| `src/core/project/detectors/agent-recommender.ts` | 동적으로 생성되는 Designer 설정에도 동일한 규칙 주입 (SSOT는 프롬프트 템플릿 본문) |
| `src/core/workflow/phases.ts` | `design` 페이즈 completionCriteria 에 "시스템이 없다면 먼저 부트스트랩" 명시 |
| `src/core/context/context-manager.ts` | `design`/`development` 페이즈 컨텍스트 문서에 `docs/design/design-system.md` 자동 포함 |

## SSOT 유지 원칙
- Designer 에이전트 정의는 두 곳(`agent-defaults.ts`, `agent-recommender.ts`)에 존재하므로 둘 다 업데이트해야 한다. 향후 단일 factory 로 병합을 고려할 것.
- 생명주기 문구는 system_prompt_template 에 배치 — 프롬프트가 최종 실행 컨텍스트의 SSOT이다.
- `docs/design/design-system.md` 자체가 런타임 SSOT이며, Pencil 시스템 시안은 그 시각적 표현이다.

## 테스트 관점
- 단위 테스트로 Designer 기본 설정의 rules/prompt 에 "디자인 시스템"/"부트스트랩"/"최신화" 키워드가 포함되는지 검증 가능.
- E2E 는 디자인 페이즈 진입 시 Designer 컨텍스트 문서 목록에 `docs/design/design-system.md` 가 후보로 포함되는지(파일이 있을 때) 확인 가능.

## 관련 문서
- [에이전트 작업 언어 설정](./agent-language-setup.md) — 시스템 프롬프트 주입 패턴 참고
- [에이전트 진실성 강제](./agent-truthfulness.md) — 프롬프트 최상단 규칙 주입 패턴
