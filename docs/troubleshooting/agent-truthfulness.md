# 에이전트 진실성(anti-hallucination) 강제

## 문제
LLM 기반 에이전트는 사실 검증 없이 그럴듯한 정보를 생성하는 경향(hallucination)이 있다.
- 존재하지 않는 파일/함수/API/패키지/URL 인용
- 측정하지 않은 KPI(DAU, 전환율 등)를 사실처럼 기재
- 회의·합의·실험·테스트가 실제로 진행된 것처럼 기록
- 외부 자료(논문, 시장 데이터, 경쟁사 사례)의 출처 위조

이런 거짓 정보가 칸반/문서/회의록에 한 번 들어가면 다른 에이전트가 이를 사실로 받아들여 연쇄적으로 오염되며, 메트릭스 기반 의사결정이 무너진다.

## 해결
모든 에이전트의 시스템 프롬프트 최상단(메트릭스 룰보다 먼저)에 **진실성 원칙**을 주입한다.

### 적용 위치
- [src/core/agent/prompt-builder.ts](../../src/core/agent/prompt-builder.ts) — `buildTruthfulnessRules()` 메서드, `buildSystemPrompt()`에서 메트릭스/회의 룰보다 앞서 주입
- [src/core/agent/consultant-factory.ts](../../src/core/agent/consultant-factory.ts) — 자문 전문가(에페메럴) 시스템 프롬프트에 동일 원칙 주입

### 핵심 규칙 (요약)
1. **금지**: 미확인 파일/함수/URL/수치/회의/합의/외부자료 인용
2. **검증 우선**: 주장 전에 Read/Glob/Grep/실제 실행으로 확인
3. **출처 명시**: 코드는 `file_path:line`, 지표는 metrics.json/리포트, 결정은 docs/decisions/
4. **불확실성 표시**: `[미확인]`, `[가정]`, `[추정: 근거=...]` 태그로 명시
5. **추정치 금지**: baseline/target에 임의 숫자 금지 → "측정 필요" + 측정 계획
6. **자문 인용 한계**: 자문 답변은 "외부 의견" 명시, 적용은 별도 검증
7. **모르면 묻는다**: meeting_invite / consultation_request로 확인

### 위반 시 처리
- 거짓 정보 산출물에 `[검증 실패]` 표시 후 재작업
- 다른 에이전트의 거짓 인용 발견 시 정정 요청 메시지 발송
- 칸반 코멘트에 미검증 항목 명시

## 원칙
"그럴듯한 답"보다 "검증된 짧은 답 + 미확인 항목 목록"이 항상 낫다.

이는 메트릭스 기반 의사결정 원칙(`buildMetricsRules()`)과 직접 연결된다 — 거짓 baseline/target은 평가 시스템 자체를 망가뜨리므로, 진실성이 메트릭스보다 선행한다.
