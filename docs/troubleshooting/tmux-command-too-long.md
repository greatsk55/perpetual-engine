# tmux "command too long"

## 증상
회의 세션이 시작되지 않고 다음과 같이 실패:

```
... -p '회의를 진행하세요. ... 각 참여자의 관점을 반영하여 논의하고,
    결정사항과 액션 아이템을 도출하세요.' 2>&1 | tee '.../meeting-XXX.log'
command too long
```

## 원인
tmux `new-session -d -s NAME COMMAND` 의 **COMMAND 인자는 약 16KB 에서 잘린다** — 초과하면 tmux 가 즉시 "command too long" 으로 거절한다.

이 한도는 kernel 의 `ARG_MAX` (macOS 기준 1MB) 와 다른, tmux 내부 한도다. 실측:

```bash
# ~16007 바이트: OK
# ~17007 바이트: command too long
```

회의 세션의 명령어는 다음을 한 줄에 포함한다:
- `--append-system-prompt '…시스템 프롬프트…'`
  - 에이전트 템플릿 + 회사 정보 + 스킬 섹션 + 진실성/메트릭스/회의 룰 + 공통 규칙 + **참여자 컨텍스트** + **아젠다(관련 태스크 전문 포함)** + 칸반 요약
- `-p '…태스크 지시…'` (아젠다 + 참여자 재포함)

참여자가 5-6명이고 관련 태스크가 10개 이상이면 쉽게 20KB 를 넘긴다.

## 해결
`src/core/session/session-manager.ts` 에 `createTmuxSession(name, fullCmd)` 헬퍼를 두고,
명령 길이가 `TMUX_CMD_THRESHOLD` (8KB) 를 넘으면 다음과 같이 분기한다:

1. 전체 명령을 `.perpetual-engine/sessions/{sessionName}.sh` 에 셸 스크립트로 작성
2. `chmod 755` 로 실행권한 부여
3. tmux 에는 `bash '{scriptPath}'` 만 전달 — 수십 바이트짜리 짧은 명령

세 진입점(`startAgent`, `startEphemeralAgent`, `startMeetingSession`) 모두
이 헬퍼를 경유하도록 통일.

### 왜 8KB 임계?
tmux 한도(~16KB)의 절반. 환경에 따라 한도가 낮을 수 있고, 셸 확장/변수 치환으로
최종 argv 가 더 길어질 수 있으므로 여유를 둔다.

### 왜 스크립트 경로를 프로젝트 로컬에 두는가
- 디버깅 용이: 실패 시 정확히 무엇이 실행됐는지 파일로 확인 가능
- 권한·소유권이 프로젝트와 동일
- `.perpetual-engine/sessions/` 에 이미 로그가 떨어지므로 같은 디렉토리에 묶어둔다

## 관련 테스트
- `tests/e2e/orchestrator.e2e.test.ts` — "긴 회의 명령은 tmux 한도를 피해 스크립트 파일로 실행된다"
  - 10개 태스크에 긴 설명을 붙여 아젠다를 팽창시킨 뒤, 회의 세션 생성 시 tmux 에 전달된 명령이
    `bash '…/meeting-….sh'` 형태인지 + 스크립트 파일이 claude 명령을 담고 있는지 검증

## 교훈
- tmux 에 임의 길이의 shell 명령을 직접 전달하는 패턴은 위험하다. 스크립트 파일 경유가 기본.
- ARG_MAX(kernel) 와 tmux 내부 한도는 다르다. 툴체인의 각 홉마다 별도 한도를 의심할 것.
