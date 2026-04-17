# 에이전트 작업 언어 설정

## 문제
- 다국어 환경에서 에이전트가 임의로 언어를 섞어 응답하면 사용자/팀이 일관되게 활용하기 어렵다.
- 문서·커밋 메시지·칸반 코멘트가 통일되지 않으면 검색·리뷰·인계가 모두 비효율적이다.
- LLM에게 매 요청마다 언어 지시를 반복할 수도 없다.

## 해결
**setup 단계에서 언어를 1회 선택**하고, 이후 모든 에이전트의 시스템 프롬프트 최상단에 자동 주입한다.

### 데이터 모델 (SSOT)
[src/core/project/config.ts](../../src/core/project/config.ts)
```ts
localization: z.object({
  language: z.string().default('ko'),               // BCP-47 코드
  language_name: z.string().default('한국어 (Korean)'), // LLM이 인식하기 좋은 표시명
}).default({}),
```
`config.yaml` 단일 소스. 기존 프로젝트 호환을 위해 `.default({})` 적용.

### 입력
- CLI: [src/cli/utils/prompts.ts](../../src/cli/utils/prompts.ts) 의 `LANGUAGE_CHOICES` 에 정의된 언어 중 select. `runSetupPrompts()` 첫 질문.
- Dashboard: Settings 탭의 Localization 섹션 (`src/dashboard/client/dist/index.html`).
- 같은 옵션 리스트가 양쪽에 동일하게 정의되어 있어 바뀔 때 함께 갱신해야 함 (현재는 길이가 짧아 중복 허용).

### 프롬프트 주입
[src/core/agent/prompt-builder.ts](../../src/core/agent/prompt-builder.ts) 의 `buildLanguageRule(config)` 가 시스템 프롬프트의 **가장 앞** (truthfulness/메트릭스 룰보다 먼저) 에 다음을 삽입:
- 적용 범위: 대화·문서·칸반·커밋·PR·자문 요청·회의 토픽
- 예외 (원문 유지): 코드 식별자, 라이브러리/API/명령어, URL/경로, 사용자 인용 에러·로그, 외부 인용 원문

자문(에페메럴) 에이전트도 `SessionManager.startEphemeralAgent()` 가 동일한 `PromptBuilder.buildSystemPrompt(config)` 를 통과하므로 자동으로 같은 언어 규칙이 적용된다 — `ConsultantFactory` 를 별도 수정할 필요 없음.

### 테스트
[tests/unit/core/prompt-builder.test.ts](../../tests/unit/core/prompt-builder.test.ts)
- 선택된 언어가 프롬프트에 포함되는지
- 미설정 시 한국어로 폴백되는지
- 진실성/메트릭스 룰보다 앞에 위치하는지 (순서 규약)

## 원칙
- **선언 1번, 강제 매 요청**: 사용자가 한 번 선택하면 모든 에이전트가 자동 준수
- **기술 토큰은 원문 유지**: 코드/API/명령어는 번역 금지 (로컬화의 흔한 함정)
- **기본값 = 한국어**: 이 프로젝트의 주 사용자 언어
- **언어 룰 > 진실성 룰 > 메트릭스 룰** 순서: 표현 형식 → 사실성 → 사고 방법론 순으로 누적
