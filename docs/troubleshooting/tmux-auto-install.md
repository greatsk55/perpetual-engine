# tmux 자동 설치

## 배경
`perpetual-engine` 는 에이전트 세션을 tmux 로 관리한다. tmux 가 없으면 `perpetual-engine start` 시점에 `TmuxNotFoundError` 를 던지며 종료.

사용자가 별도의 사전 설치를 신경쓰지 않아도 되도록 **두 시점**에서 자동 설치/안내를 수행한다.

## 진입점 두 가지

### 1. npm install 시점 (postinstall 훅)
`scripts/postinstall.mjs` — package.json `"postinstall"` 스크립트.

- 이미 tmux 가 설치돼 있으면 아무 일도 하지 않음
- **macOS + brew 있음**: `brew install tmux` 를 바로 실행 (sudo 불필요)
- **macOS + brew 없음**: Homebrew 설치 안내 메시지 출력 후 종료
- **Linux**: 지원 패키지 매니저(apt-get/dnf/yum/pacman/apk)를 탐지해 명령어 안내만 출력. sudo 가 필요하므로 자동 실행하지 않음
- **그 외**: 수동 설치 안내

실패해도 npm install 전체를 실패시키지 않는다 (예외 catch).

환경변수로 스킵 가능:
- `SKIP_INFINITE_POWER_POSTINSTALL=1` — 강제 스킵
- `CI=true` — CI 에서 자동 스킵 (필요 시 `INFINITE_POWER_FORCE_POSTINSTALL=1` 로 덮어쓰기)

### 2. `perpetual-engine start` 시점 (런타임 폴백)
`src/core/session/session-manager.ts` 의 `checkPrerequisites()`:

- `tmux.checkInstalled()` 가 실패하면 → `tryAutoInstallTmux()` 호출
- 성공하면 검증 재수행 후 진행
- 실패하면 원래 에러를 다시 throw → orchestrator.start() 가 종료

postinstall 이 스킵된 경우(예: CI, 환경변수)나 사용자가 별도 경로로 tmux 를 삭제한 경우에도 start 시점에 한 번 더 기회를 준다.

## 구현 위치
- `src/core/session/tmux-installer.ts` — 공용 설치 로직 (`tryAutoInstallTmux(platform?)`)
- `scripts/postinstall.mjs` — npm install 훅 전용(의존성 번들 전이라 `src/` 를 못 쓰므로 로직을 복제)
- `src/core/session/session-manager.ts` — 런타임 진입점

postinstall 이 `src/` 를 못 쓰는 이유: npm install 중에는 아직 타입스크립트 빌드가 끝나지 않았을 수 있고, 외부 의존성을 import 하면 설치 순서에 민감해진다. 그래서 `node:child_process` / `node:os` 만 쓰는 독립 스크립트로 유지.

## 플랫폼별 의도
- **macOS**: brew 는 사용자 권한으로 돌아가며 빠르게 설치되므로 자동 실행이 안전
- **Linux**: sudo 를 요구하는 명령을 말없이 실행하는 건 예상 밖 부작용 — 명령어만 출력
- **Windows**: WSL 권장. 네이티브 tmux 자동 설치는 구현하지 않음

## 관련 테스트
- `tests/unit/core/tmux-installer.test.ts`
  - linux: 자동 실행 금지, sudo 명령어 안내
  - 지원되지 않는 플랫폼: 수동 안내 반환
  - 결과 객체 형식(attempted/succeeded 불린) 검증

## 교훈
- 설치 자동화는 사용자 기대("그냥 되길")와 안전("내 시스템 건드리지 말기") 사이 균형이다.
- sudo 필요한 경로는 자동화하지 않고, 대신 복사-붙여넣기 가능한 정확한 명령어를 제공한다.
- npm postinstall 은 실패해도 install 전체를 깨지 않도록 catch 필수 — 아니면 사용자 경험이 최악이 된다.
