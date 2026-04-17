# 회의 초대 파싱 실패: "[object Object]" is not valid JSON

## 증상
```
✗ 회의 초대 파싱 실패: "[object Object]" is not valid JSON
```

## 원인
CEO 에이전트가 메시지 파일을 직접 생성할 때 `content` 필드에 JSON 문자열이 아닌 **객체**를 그대로 저장함.

`Message` 인터페이스는 `content: string`을 기대하지만, 에이전트가 생성한 메시지 파일에서는 `content`가 객체로 저장됨:
```json
{
  "type": "meeting_invite",
  "content": { "title": "...", "participantRoles": [...] }  // 객체 (문자열이 아님)
}
```

오케스트레이터의 `handleMeetingInvite()`에서 `JSON.parse(msg.content)`를 호출하면, 객체가 `toString()`되어 `"[object Object]"`가 되고 파싱 실패.

## 해결
`orchestrator.ts`의 `handleMeetingInvite()`와 `handleConsultationRequest()`에서 `content`가 이미 객체인 경우를 처리:
```typescript
const meetingConfig = (typeof msg.content === 'string'
  ? JSON.parse(msg.content)
  : msg.content) as { ... };
```

## 근본 원인
에이전트가 `MessageQueue.send()`를 거치지 않고 메시지 파일을 직접 생성하기 때문에, `content` 타입이 강제되지 않음.

## 후속 이슈 (2026-04-17): `주최자 에이전트를 찾을 수 없습니다: undefined`

같은 근본 원인(에이전트가 `send()` 우회)으로 **`from` 필드 누락**도 빈번히 발생. `handleMeetingInvite`가 `msg.from` 을 그대로 `initiatorRole`에 전달 → `agentRegistry.get(undefined)` 실패 → throw → 회의가 열리지 않음.

실제 `my-startup/.perpetual-engine/messages/` 에 쌓인 에이전트 작성 파일들을 확인해보면 `from`, `id`, `created_at` 이 모두 누락된 상태였다.

### 해결
1. **수신측 견고성** — `orchestrator.ts:handleMeetingInvite`:
   ```typescript
   const initiatorRole =
     msg.from ||
     meetingConfig.initiatorRole ||
     meetingConfig.requested_by ||
     'ceo'; // 최종 폴백
   ```
2. **프롬프트 업데이트** — `prompt-builder.ts` 의 meeting_invite / consultation_request 예시에 `from` 필드 명시.
3. **회귀 테스트** — `tests/e2e/orchestrator.e2e.test.ts` 에 "from 필드 없는 meeting_invite" 케이스 추가.

### 교훈
에이전트가 생성하는 아티팩트는 스키마 검증 없는 자유 입력이다. 수신측은 **필수 필드 누락에 대한 폴백/추론 경로**를 갖춰야 한다. 프롬프트를 고치는 것만으로는 부족함(에이전트는 언제든 지시를 무시한다).
