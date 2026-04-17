<p align="center">
  <img src="./docs/assets/hero.png" alt="Perpetual Engine - AI 에이전트 스타트업 프레임워크" width="100%"/>
</p>

<h1 align="center">무한동력 Perpetual Engine</h1>

<p align="center">
  <b>AI 에이전트 스타트업 프레임워크 — 토큰만 투자하면 AI가 사업을 만든다.</b>
</p>

<p align="center">
  한국어 · <a href="./README.md">English</a>
</p>

---

## 빠른 시작

```bash
# 1. 설치
npm install -g perpetual-engine

# 2. 프로젝트 생성 (기존 프로젝트에서는 `perpetual-engine init`만 실행)
perpetual-engine init my-startup
cd my-startup

# 3. 스타트업 비전 설정
perpetual-engine setup

# 4. 실행 — 에이전트가 일을 시작하고, 대시보드가 열립니다
perpetual-engine start
# 대시보드: http://localhost:3000

# 5. 언제든 팀에게 지시
perpetual-engine message "랜딩페이지를 먼저 만들어줘"

# 6. 모니터링
perpetual-engine status   # 상태 요약
perpetual-engine board    # 터미널 칸반보드
```

---

## Perpetual Engine이란?

**Perpetual Engine**은 AI 에이전트로 구성된 가상 스타트업 팀을 구동하는 오픈소스 CLI 프레임워크입니다. 토큰이라는 연료만 공급하면 AI 팀이 멈추지 않고 사업을 굴려나간다는 의미에서 **Perpetual Engine**이라는 이름을 붙였습니다. 사용자는 **투자자(Investor)** 역할로 비전만 제시하면, CEO·CTO·PO·디자이너·QA·마케터 에이전트 팀이 기획-디자인-개발-테스트-배포-마케팅 전 과정을 자율적으로 수행합니다. 모든 에이전트는 Claude Code 세션으로 실행됩니다.

## 대시보드 미리보기

<p align="center">
  <img src="./docs/assets/dashboard.png" alt="Perpetual Engine 대시보드 — 칸반보드, 에이전트 상태, 활동 피드, 메트릭스" width="100%"/>
</p>

`perpetual-engine start` 실행 후 `http://localhost:3000`에서 칸반보드, 에이전트 상태, 자문 전문가, 활동 피드, 메트릭스를 실시간으로 확인할 수 있습니다.

## 주요 기능

- **자율 AI 팀** — 6종 전문 에이전트(CEO, CTO, PO, Designer, QA, Marketer)가 회의·의사결정·실행을 자율 수행
- **에이전트 스킬** — 각 에이전트에 역할 맞춤 스킬(슬래시 명령어)이 자동 주입
- **메트릭스 기반 기획** — 모든 기획에 측정 지표·기간·평가 기준 필수 (확대 / 유지 / 반복개선 / 방향전환 / 폐기 자동 판정)
- **다중 참여자 회의** — 이슈 발생 시 유관 에이전트를 여럿 소집하여 협의
- **즉석 자문 전문가** — "GDPR 전문 변호사"든 "핀테크 결제 아키텍트"든, 필요한 전문가를 서술하면 즉시 생성되어 자문 후 자동 소멸
- **병렬 실행** — tmux 기반 멀티 에이전트 세션이 독립적으로 동작
- **실시간 대시보드** — `http://localhost:3000`에서 칸반보드, 에이전트 상태, 회의록, 활동 피드 확인
- **문서 기반 컨텍스트** — Markdown 문서를 통해 세션 간 지식 전달, 컨텍스트 연속성 보장
- **스프린트 기반 워크플로우** — 애자일 프로세스: 기획 → 디자인 → 개발 → 테스트 → 배포
- **파일 기반 상태 관리** — `kanban.json`이 유일한 소스(SSOT), Git으로 추적 가능

## 사전 요구사항

- **Node.js** >= 18.0.0
- **tmux** — 에이전트 병렬 세션 실행용
- **Claude Code CLI** — 각 에이전트가 Claude Code 세션으로 동작
- **[Pencil](https://www.pencil.dev/)** + **Pencil MCP** — Designer / Marketer 에이전트의 **필수** UI/UX 시안 도구

```bash
# tmux 설치 (macOS)
brew install tmux

# tmux 설치 (Ubuntu/Debian)
sudo apt install tmux
```

### Pencil 설치

Designer / Marketer 에이전트는 모든 UI/UX·마케팅 시안을 [Pencil](https://www.pencil.dev/)로 생성합니다. Pencil이 설치되어 있지 않으면 디자인 페이즈가 동작하지 않습니다.

1. **Pencil 앱 설치** — [pencil.dev](https://www.pencil.dev/)에서 운영체제에 맞는 설치 파일을 내려받습니다.
   - macOS: `.dmg`
   - Windows: 설치 관리자(installer)
   - Linux: `.deb` 또는 `.AppImage` (X11 권장, Wayland/Hyprland에는 일부 이슈 있음)
   - VS Code / Cursor 사용자는 Extensions 마켓플레이스에서 "Pencil"을 검색해 확장으로 설치할 수도 있습니다.
2. **Pencil MCP 활성화** — **Pencil 앱을 실행하면 Pencil MCP 서버가 자동으로 시작**됩니다. 별도의 `claude mcp add` 명령이나 API 키 설정은 필요하지 않습니다.
3. **확인** — Pencil 앱을 띄운 상태에서 `perpetual-engine start` 를 실행하면 Designer 에이전트가 Pencil MCP를 통해 `.pen` 시안을 `docs/design/mockups/` 와 `docs/marketing/mockups/` 에 생성합니다.

> **주의:** 에이전트가 디자인 작업을 수행하는 동안 Pencil 앱은 계속 열려 있어야 합니다 (MCP 서버가 앱 프로세스와 함께 동작).

## 설치

### 글로벌 설치 (새 프로젝트)

```bash
npm install -g perpetual-engine

# 새 프로젝트 생성
perpetual-engine init my-startup
cd my-startup
```

### 기존 프로젝트에 설치

```bash
cd your-existing-project

# 현재 디렉토리에 Perpetual Engine 초기화
perpetual-engine init

# 기존 파일(README.md 등)은 덮어쓰지 않습니다
```

### 설정

```bash
# 대화형 설정 — 회사 비전 및 프로덕트 정보 입력
perpetual-engine setup

# 에이전트 + 대시보드 시작
perpetual-engine start
```

## CLI 명령어

### 프로젝트 관리

| 명령어 | 설명 |
|--------|------|
| `perpetual-engine init [name]` | 새 프로젝트 생성, 이름 생략 시 현재 디렉토리에 설치 |
| `perpetual-engine setup` | 대화형 설정 (회사 비전, 프로덕트, 기술 스택) |
| `perpetual-engine start` | 대시보드 + 에이전트 팀 가동 |
| `perpetual-engine stop` | 모든 에이전트 종료 |
| `perpetual-engine pause` | 모든 에이전트 일시 정지 |
| `perpetual-engine resume` | 에이전트 재개 |
| `perpetual-engine status` | 현재 상태 요약 |

### 에이전트 관리

| 명령어 | 설명 |
|--------|------|
| `perpetual-engine team` | 에이전트 팀 목록 |
| `perpetual-engine agent <name>` | 에이전트 상세 정보 |

### 모니터링

| 명령어 | 설명 |
|--------|------|
| `perpetual-engine board` | 터미널 칸반보드 |
| `perpetual-engine sprint` | 현재 스프린트 정보 |
| `perpetual-engine logs <agent>` | 에이전트 로그 확인 |

### 사용자 개입

| 명령어 | 설명 |
|--------|------|
| `perpetual-engine message "<msg>"` | 팀에게 메시지 전달 |

## 프로젝트 구조

초기화 후 생성되는 구조:

```
your-project/
├── .perpetual-engine/          # 프레임워크 내부 파일
│   ├── config.yaml           # 프로젝트 설정
│   ├── agents/               # 에이전트 정의 (YAML)
│   │   ├── ceo.yaml
│   │   ├── cto.yaml
│   │   ├── po.yaml
│   │   ├── designer.yaml
│   │   ├── qa.yaml
│   │   └── marketer.yaml
│   ├── sessions/             # 에이전트 세션 로그
│   ├── state/                # 시스템 상태
│   └── messages/             # 에이전트 간 메시지
├── docs/
│   ├── vision/               # 회사 비전 및 목표
│   ├── meetings/             # 회의록
│   ├── decisions/            # 의사결정 기록
│   ├── planning/             # 기획 문서
│   ├── design/               # 디자인 문서 및 시안
│   ├── development/          # 개발 문서
│   ├── marketing/            # 마케팅 전략 및 자산
│   └── changelog/            # 변경사항
├── workspace/                # 프로덕트 작업 공간 (코드/자산)
├── kanban.json               # 칸반보드 상태 (SSOT)
└── sprints.json              # 스프린트 데이터
```

## 동작 방식

### 아키텍처

<p align="center">
  <img src="./docs/assets/architecture.png" alt="Perpetual Engine 아키텍처 — 투자자, 오케스트레이터, 6종 에이전트, 파일 기반 SSOT, 대시보드" width="100%"/>
</p>

1. **사용자**가 회사 비전과 프로덕트 방향을 설정
2. **오케스트레이터**가 스프린트 페이즈와 메시지를 라우팅
3. **에이전트**들이 자율적으로 회의하고, 태스크를 생성하고, 작업을 실행
4. **전문가**가 필요하면 즉석으로 생성되어 자문 후 자동 소멸
5. **대시보드**에서 실시간으로 진행 상황 모니터링
6. 언제든 메시지, 우선순위 변경, 일시 정지로 **개입** 가능

### 스프린트 워크플로우

<p align="center">
  <img src="./docs/assets/workflow.png" alt="Sprint Workflow — Planning → Design → Development → Testing → Launch, 그리고 메트릭스·회의·자문·사용자 개입의 연속 루프" width="100%"/>
</p>

각 페이즈는 **독립적인 Claude Code 세션**에서 실행되며, 산출물은 `docs/` 하위의 Markdown 문서로 핸드오프됩니다. 전 구간에 메트릭스 평가, 다중 참여자 회의, 즉석 자문, 사용자 개입이 상시 끼어들 수 있습니다.

## 에이전트 스킬

각 에이전트는 역할에 맞는 전용 스킬(Claude Code 슬래시 명령어)을 보유합니다:

| 에이전트 | 스킬 |
|----------|------|
| **CEO** | `/launch-strategy`, `/marketing-psychology`, `/seo-audit` |
| **CTO** | `/security-review`, `/claude-api`, `/vercel-react-best-practices`, `/simplify` |
| **PO** | `/copywriting`, `/marketing-psychology`, `/web-design-guidelines` |
| **Designer** | `/frontend-design`, `/web-design-guidelines` |
| **QA** | `/security-review`, `/audit-website` |
| **Marketer** | `/paid-ads`, `/seo-audit`, `/copywriting`, `/launch-strategy`, `/marketing-psychology`, `/google-ads-manager` |

스킬은 `src/core/agent/agent-skills.ts`에 정의되며, 에이전트 세션의 시스템 프롬프트에 자동 주입됩니다.

## 메트릭스 기반 기획

<p align="center">
  <img src="./docs/assets/metrics.png" alt="Metrics-Driven Decision Flow — 기획, 측정, 자동 판정, 후속 실행" width="100%"/>
</p>

모든 기획에는 측정 가능한 목표가 필수입니다. "감"이 아닌 데이터로 판단합니다.

**기획 시 에이전트가 정의해야 하는 것:**

| 항목 | 예시 |
|------|------|
| 가설 | "온보딩 개선 시 7일 리텐션이 20% 상승할 것" |
| KPI | DAU: 100 → 500 (높을수록 좋음) |
| 측정 기간 | 2026-04-17 ~ 2026-05-17 |
| 체크포인트 | 매주 월요일 |

**체크포인트마다 자동 평가 후 다음 행동 결정:**

| 달성률 | 판정 | 행동 |
|--------|------|------|
| >= 120% | 초과 달성 | **확대(scale_up)** — 더 투자 |
| >= 100% | 목표 달성 | **유지(maintain)** — 현 전략 유지 |
| >= 60% | 개선 중 | **반복개선(iterate)** — 실행법 보완 |
| >= 30% | 정체 | **방향전환(pivot)** — 접근법 변경 |
| < 30% | 실패 | **폐기(kill)** — 중단, 리소스 재배치 |

## 다중 참여자 회의

이슈 발생 시 유관 에이전트를 여럿 소집하여 협의할 수 있습니다:

```json
{
  "type": "meeting_invite",
  "to": "orchestrator",
  "content": {
    "title": "API Rate Limiting 전략",
    "type": "issue_discussion",
    "participantRoles": ["cto", "po", "qa"],
    "topics": ["현재 Rate Limit으로 인한 사용자 불만", "요금제별 차등 정책"],
    "relatedTaskIds": ["TASK-12", "TASK-15"]
  }
}
```

회의 세션에서는 자동으로:
- 각 참여자의 역할·책임·관점을 주입
- 관련 태스크를 컨텍스트로 연결
- `docs/meetings/`에 회의록 생성
- 액션 아이템을 칸반 태스크로 등록

## 즉석 자문 전문가

전문 지식이 필요할 때, **필요한 전문가를 자유롭게 서술**하면 즉시 생성됩니다. 미리 정해진 카테고리 없이 어떤 분야든 가능합니다. 자문 완료 후 자동 소멸됩니다.

```json
{
  "type": "consultation_request",
  "to": "orchestrator",
  "content": {
    "expertise": "GDPR 및 한국 개인정보보호법 전문 변호사",
    "context": "유럽 사용자 데이터를 수집하려는데 법적 요건이 궁금합니다",
    "questions": [
      "GDPR 준수를 위해 필수적인 조치는?",
      "데이터 처리 동의 양식은 어떻게 구성해야 하나?"
    ],
    "requested_by": "ceo",
    "related_task_id": "TASK-5"
  }
}
```

**어떤 전문가든 가능합니다** — 구체적으로 서술할수록 더 전문적인 답변을 받을 수 있습니다:

| 요청 | 생성되는 전문가 |
|------|----------------|
| `"시리즈A 투자유치 전문 재무 전문가"` | 초기 VC 라운드에 특화된 재무 자문가 |
| `"React Native → Flutter 마이그레이션 아키텍트"` | 크로스플랫폼 전환 경험이 있는 모바일 아키텍트 |
| `"핀테크 결제 시스템 PCI-DSS 컴플라이언스 전문가"` | 결제 업계 규제 보안 전문가 |
| `"B2B SaaS 엔터프라이즈 영업 전략가"` | 대기업 딜사이클 전문 영업 전문가 |
| `"헬스케어 AI 규제 및 인허가 전문가"` | 의료 AI 인허가 도메인 전문가 |

**생명주기:** 생성 → 자문 → 자동 소멸 (5분 타임아웃). 다중 참여자 회의에 `consultantRequests` 필드로 초대할 수도 있습니다.

## 기술 스택

| 구성 요소 | 기술 |
|-----------|------|
| CLI | Node.js + TypeScript + Commander.js |
| 대시보드 | Express + WebSocket + React (Tailwind CDN) |
| 상태 관리 | 파일 기반 JSON (kanban.json, sprints.json) |
| 에이전트 런타임 | tmux + Claude Code CLI |
| 문서 관리 | Markdown + Git |

## 설정 파일

`perpetual-engine setup` 실행 후 `.perpetual-engine/config.yaml`에 저장:

```yaml
company:
  name: "내스타트업"
  mission: "미션 선언문"

product:
  name: "프로덕트명"
  description: "프로덕트 설명"
  target_users: "대상 사용자"
  core_value: "핵심 가치"

constraints:
  tech_stack_preference: "auto"   # 또는 지정 (예: "next.js + supabase")
  deploy_target: "vercel"         # 배포 대상
```

## 테스트

```bash
npm test              # 전체 (단위 + E2E)
npm run test:unit     # 단위 테스트만
npm run test:e2e      # E2E 테스트만 (37개, ~5–7초)
```

E2E 테스트는 `tmux` 와 Claude CLI 를 `MockTmuxAdapter` 로 대체하고, 파일시스템·chokidar·Express 는 실제 구현을 사용합니다. `Orchestrator` / `DashboardServer` / `WorkflowEngine` 은 테스트용 의존성 주입 포인트(`sessionManager`, `dashboardPort=0`, `workflowPollInterval` 등)를 노출합니다. 상세 구조는 [E2E 테스트 인프라 문서](docs/troubleshooting/e2e-test-infrastructure.md) 참고.

## 라이선스

MIT
