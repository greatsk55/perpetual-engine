# Perpetual Engine - PRD (Product Requirements Document)

> AI 에이전트 스타트업 프레임워크
> 작성일: 2026-04-16
> 버전: 1.0.0

---

## 1. 제품 개요

### 1.1 한 줄 요약

**Perpetual Engine**는 AI 에이전트들로 구성된 가상 스타트업 팀을 구동하고, 사용자가 투자자 역할로 회사의 비전만 제시하면 에이전트 팀이 자율적으로 기획-디자인-개발-테스트-배포-마케팅 전 과정을 수행하는 오픈소스 프레임워크이다.

### 1.2 비전

"토큰만 투자하면, AI가 사업을 만든다."

사용자는 회사의 목표와 프로덕트의 큰 그림만 설정하면, CEO·CTO·PO·디자이너·QA·마케터 에이전트들이 회의·의사결정·실행을 자율적으로 수행한다. 사용자는 실시간 대시보드를 통해 진행 상황을 모니터링하고, 필요시 방향을 조정하는 **투자자(Investor)** 역할을 담당한다.

### 1.3 핵심 가치

| 가치 | 설명 |
|------|------|
| **자율성** | 에이전트들이 주체적으로 회의하고 의사결정하며 실행한다 |
| **가시성** | 모든 작업 진행 상황을 칸반보드와 실시간 대시보드로 확인 가능 |
| **확장성** | 필요에 따라 에이전트를 추가 고용하고, 하위 에이전트를 병렬 생성 가능 |
| **컨텍스트 연속성** | 모든 회의·의사결정·기획을 문서화하여 세션 간 컨텍스트 유지 |
| **점진적 진화** | 최소 단위로 쪼개어 가장 필요한 기능부터 하나씩 추가 |

---

## 2. 대상 사용자

### 2.1 페르소나: 투자자 (Investor)

- **역할**: 회사의 비전·목표·프로덕트 방향성을 설정하고, Claude Code 토큰으로 자금을 지원하는 사람
- **핵심 니즈**:
  - 사업 아이디어를 구체적인 프로덕트로 빠르게 구현하고 싶다
  - 개발·디자인·마케팅 등 전 과정을 직접 수행할 시간/역량이 부족하다
  - 진행 상황을 실시간으로 모니터링하고 싶다
- **기대 행동**:
  - 회사 목표 및 프로덕트 비전 문서 작성
  - 에이전트 팀 구성 및 추가 고용 결정
  - 대시보드를 통한 진행 상황 모니터링
  - 필요시 방향 수정 및 피드백 제공

---

## 3. 설치 및 실행

### 3.1 설치

```bash
# npm을 통한 글로벌 설치
npm install -g perpetual-engine

# 또는 npx로 바로 실행
npx perpetual-engine init my-startup
```

### 3.2 프로젝트 초기화

```bash
# 새 스타트업 프로젝트 생성
perpetual-engine init my-startup
cd my-startup

# 대화형 설정 (회사 목표, 프로덕트 비전 입력)
perpetual-engine setup
```

### 3.3 실행

```bash
# 로컬 대시보드 서버 구동 + 에이전트 팀 가동
perpetual-engine start

# 대시보드: http://localhost:3000
# 에이전트 팀이 자동으로 업무 시작
```

### 3.4 프로젝트 구조

```
my-startup/
├── .perpetual-engine/
│   ├── config.yaml              # 프레임워크 설정
│   ├── agents/                  # 에이전트 설정 및 상태
│   │   ├── ceo.yaml
│   │   ├── cto.yaml
│   │   ├── po.yaml
│   │   ├── designer.yaml
│   │   ├── qa.yaml
│   │   └── marketer.yaml
│   ├── sessions/                # 에이전트 세션 로그
│   └── state/                   # 시스템 상태 (칸반, 스프린트 등)
├── docs/
│   ├── vision/                  # 회사 비전 및 목표 문서
│   │   ├── company-goal.md
│   │   └── product-vision.md
│   ├── meetings/                # 회의록
│   │   ├── 2026-04-16-sprint-planning.md
│   │   └── ...
│   ├── decisions/               # 의사결정 기록
│   ├── planning/                # 기획 문서
│   ├── design/                  # 디자인 문서 및 명세
│   │   ├── system/              # tokens.css / components.css / design-system.md (디자인 시스템 SSOT)
│   │   └── mockups/             # HTML 목업 (*.html + meta.json) — Design Canvas 자동 감지
│   ├── development/             # 개발 기획 및 기술 문서
│   ├── marketing/               # 마케팅 전략 및 문서
│   │   └── mockups/             # 마케팅 HTML 목업 (*.html + meta.json)
│   └── changelog/               # 변경사항 문서
├── workspace/                   # 실제 프로덕트 작업 공간
│   └── (에이전트들이 생성하는 코드/자산)
├── kanban.json                  # 칸반보드 상태
├── sprints.json                 # 스프린트 정보
└── package.json
```

---

## 4. 에이전트 시스템

### 4.1 기본 에이전트 구성

| 에이전트 | 역할 | 업무 범위 | 핵심 규칙 |
|----------|------|-----------|-----------|
| **CEO** | 총괄 리더 | 전사 전략, 우선순위 결정, 리소스 배분, 스프린트 계획, 최종 의사결정 | 항상 회사 목표와 프로덕트 비전에 정렬된 판단을 해야 함 |
| **CTO** | 기술 총괄 | 기술 아키텍처, 기술 스택 결정, 코드 리뷰, 기술 부채 관리, 배포 관리 | 확장성·유지보수성을 최우선으로 고려. 최소 단위 기능으로 쪼개어 점진적 개발 |
| **PO** | 프로덕트 오너 | 요구사항 정의, 유저 스토리 작성, 백로그 관리, 우선순위 조정, 수용 기준 정의 | 사용자 가치 중심 사고. MVP 원칙 준수. 기능 하나하나의 가치를 명확히 정의 |
| **Designer** | 디자인 총괄 | UI/UX 디자인, 디자인 시스템, 프로토타이핑, 사용성 검토. **모든 디자인 산출물은 HTML + CSS 목업** (`docs/design/system/` 의 토큰/컴포넌트 사용) | 일관된 디자인 시스템 유지. 구현 가능성 고려. 접근성(WCAG AA) 준수. **Pencil / Figma 등 외부 디자인 툴 사용 금지** |
| **QA** | 품질 보증 | 테스트 전략, 테스트 케이스 작성, 버그 리포트, 회귀 테스트, 배포 승인 | 모든 기능에 대한 테스트 커버리지 확보. 배포 전 반드시 승인 필요 |
| **Marketer** | 마케팅 총괄 | 시장 분석, 마케팅 전략, 콘텐츠 제작, 성과 분석, 사용자 획득 | 데이터 기반 의사결정. ROI 중심 마케팅. 프로덕트 가치와 일치하는 메시징 |

### 4.2 에이전트 공통 규칙

모든 에이전트가 반드시 지켜야 할 규칙:

1. **문서 우선**: 모든 의사결정과 회의 내용을 반드시 문서화한다
2. **컨텍스트 확인**: 작업 시작 전 관련 문서를 반드시 확인하여 컨텍스트를 유지한다
3. **충돌 방지**: 문서를 수정할 때는 반드시 최신 버전을 확인하고 업데이트한다
4. **최소 단위 원칙**: 작업을 가능한 가장 작은 단위로 쪼갠다
5. **우선순위 준수**: 작업 간 의존성과 우선순위를 엄격히 따른다
6. **투명성**: 작업 상태를 칸반보드에 실시간 반영한다
7. **협업 의무**: 다른 에이전트에게 영향을 주는 결정은 반드시 회의를 통해 합의한다
8. **문서 최신화**: 워크플로우의 마지막 단계에서 반드시 문서화 및 최신화를 수행한다
9. **HTML 목업 디자인 원칙**: 모든 UI/UX 디자인은 Designer 가 `docs/design/mockups/<feature>/*.html` + `meta.json` 형태로 제공한다 (디자인 시스템 토큰/컴포넌트 기반). 개발 시 이 HTML 시안과 토큰을 구현의 유일한 UI 기준으로 삼는다. 시안 없이 UI 를 임의로 구현하는 것을 금지한다. Pencil / Figma 등 외부 디자인 툴을 사용하지 않는다

### 4.3 에이전트 추가 고용

```yaml
# .perpetual-engine/agents/advisor.yaml (사용자 정의 에이전트 예시)
name: "전략 자문가"
role: advisor
description: "시장 분석 및 경쟁사 전략 자문"
responsibilities:
  - 시장 트렌드 분석
  - 경쟁사 분석
  - 전략적 조언 제공
rules:
  - 데이터 기반 분석 수행
  - CEO와 정기적 브리핑
reports_to: ceo
```

```bash
# CLI를 통한 에이전트 추가
perpetual-engine hire --role advisor --name "전략 자문가"

# 에이전트 해고
perpetual-engine fire advisor

# 에이전트 목록 확인
perpetual-engine team
```

### 4.4 하위 에이전트 (Sub-Agents)

각 에이전트는 작업 속도를 높이기 위해 **하위 에이전트를 병렬로 생성**할 수 있다.

```
CTO (메인)
├── Sub-Agent: Backend 개발 (병렬)
├── Sub-Agent: Frontend 개발 (병렬)
└── Sub-Agent: Infrastructure 설정 (병렬)
```

- 하위 에이전트는 상위 에이전트의 컨텍스트를 상속받는다
- 하위 에이전트의 작업 결과는 상위 에이전트에게 보고된다
- 하위 에이전트는 작업 완료 후 자동으로 종료된다
- tmux 세션을 통해 병렬 실행되며, 대시보드에서 모든 하위 에이전트의 상태를 확인 가능하다

---

## 5. 멀티 에이전트 실행 환경

### 5.1 tmux 기반 병렬 실행

각 에이전트는 독립된 tmux 세션에서 실행된다.

```
tmux session: perpetual-engine
├── window: dashboard        # 대시보드 서버
├── window: ceo              # CEO 에이전트
├── window: cto              # CTO 에이전트
├── window: po               # PO 에이전트
├── window: designer         # 디자이너 에이전트
├── window: qa               # QA 에이전트
├── window: marketer         # 마케터 에이전트
└── window: cto-sub-backend  # CTO의 하위 에이전트 (동적 생성)
```

### 5.2 에이전트 간 통신

```
┌─────────────────────────────────────────────┐
│              Message Bus (Event Queue)        │
├─────────────────────────────────────────────┤
│                                               │
│  CEO ◄──► CTO ◄──► PO                       │
│   │        │        │                         │
│   ▼        ▼        ▼                         │
│ Marketer Designer   QA                       │
│                                               │
│  통신 방식:                                    │
│  1. 파일 기반 메시지 큐 (docs/messages/)       │
│  2. 회의 요청/응답 프로토콜                     │
│  3. 칸반보드 상태 변경 이벤트                   │
│                                               │
└─────────────────────────────────────────────┘
```

- **비동기 메시지**: 파일 기반 메시지 큐를 통해 에이전트 간 비동기 통신
- **동기 회의**: 특정 주제에 대해 관련 에이전트들이 동시에 참여하는 회의 메커니즘
- **이벤트 구독**: 칸반보드 상태 변경, 문서 업데이트 등 이벤트를 구독하여 반응

### 5.3 회의 시스템

에이전트들은 다음 상황에서 **자동으로 회의를 소집**한다:

| 회의 유형 | 참여 에이전트 | 트리거 |
|-----------|-------------|--------|
| **스프린트 계획** | CEO, CTO, PO | 새 스프린트 시작 시 |
| **백로그 그루밍** | PO, CTO, Designer | 백로그 정리 필요 시 |
| **기술 설계 리뷰** | CTO, PO, (Designer) | 새로운 기능 개발 전 |
| **디자인 리뷰** | Designer, PO, CTO | 디자인 완료 시 |
| **배포 판단** | CTO, QA, CEO | 테스트 통과 후 배포 전 |
| **마케팅 전략** | Marketer, CEO, PO | 마케팅 캠페인 기획 시 |
| **긴급 이슈** | 관련 에이전트 전원 | 크리티컬 버그/장애 발생 시 |
| **회고** | 전원 | 스프린트 종료 시 |

#### 회의 프로세스

```
1. 회의 소집 → 안건(Agenda) 문서 생성
2. 참여 에이전트 소환
3. 라운드 로빈 방식으로 의견 개진
4. 합의 또는 CEO 최종 결정
5. 회의록(Minutes) 자동 생성 → docs/meetings/에 저장
6. 결정사항(Decision Record) 생성 → docs/decisions/에 저장
7. 액션 아이템 → 칸반보드 Task로 자동 등록
```

---

## 6. 워크플로우

### 6.1 스프린트 기반 애자일 프로세스

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Sprint Cycle                                  │
│                                                                        │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐              │
│  │ Sprint  │──▶│ Sprint  │──▶│  실행    │──▶│ Sprint  │              │
│  │ Planning│   │ Backlog │   │ (워크    │   │ Review &│              │
│  │ (회의)  │   │ 확정    │   │  플로우) │   │ Retro   │              │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘              │
│       │                            │              │                    │
│       ▼                            ▼              ▼                    │
│  CEO+CTO+PO 회의로           각 워크플로우     문서화 & 최신화         │
│  Task 주체적 생성            페이즈별 실행    다음 스프린트 준비        │
└──────────────────────────────────────────────────────────────────────┘
```

- 스프린트 길이는 자동 조정 (작업량 기반)
- **휴식 없이 연속 실행** (AI이므로 노동력 제약 없음)
- 작업 간 **의존성과 우선순위를 엄격히 관리**

### 6.2 프로덕트 개발 워크플로우

```
기획 ──▶ 디자인 ──▶ 개발 ──▶ 테스트 ──▶ (실패시) 개발 ──▶ 테스트 ──▶ 배포
 │         │         │         │                                        │
 PO       Designer   CTO       QA                                     CTO
 CEO                                                                   QA
 CTO                                                                  CEO
```

#### Phase 1: 기획 (Planning)

| 항목 | 내용 |
|------|------|
| **담당** | PO (리드), CEO, CTO |
| **세션** | 새로운 세션에서 실행 |
| **입력** | `docs/vision/`, `docs/planning/` 의 기존 문서 확인 |
| **활동** | 요구사항 분석, 유저 스토리 작성, 수용 기준 정의, 우선순위 설정 |
| **산출물** | 기획 문서 (`docs/planning/feature-xxx.md`) |
| **회의** | PO-CEO-CTO 기획 회의, 회의록 생성 |
| **완료 조건** | CEO 승인, 기획 문서 확정 |

#### Phase 2: 디자인 (Design)

| 항목 | 내용 |
|------|------|
| **담당** | Designer (리드), PO |
| **세션** | 새로운 세션에서 실행 |
| **입력** | 기획 문서 (`docs/planning/feature-xxx.md`) + 디자인 시스템 (`docs/design/system/`) 확인으로 컨텍스트 유지 |
| **산출 형식** | **HTML + CSS 목업** — `tokens.css` / `components.css` 를 참조한 피처 목업 + `meta.json` (Pencil / Figma 등 외부 디자인 툴 사용 안 함) |
| **활동** | 디자인 시스템(토큰·컴포넌트) 선반영 → 피처 HTML 목업 작성 → `meta.json` 선언 → Design Canvas(`/design`)에서 렌더 확인 |
| **산출물** | 피처 목업 (`docs/design/mockups/feature-xxx/*.html` + `meta.json`), 디자인 문서 (`docs/design/feature-xxx.md`), 필요 시 토큰/컴포넌트 업데이트와 CHANGELOG |
| **회의** | 디자인 리뷰 (Designer-PO-CTO) — Design Canvas 에 렌더된 HTML 시안 기반 |
| **완료 조건** | PO 승인, 시안이 Design Canvas 에서 정상 렌더, 디자인 문서 확정 |

#### Phase 3: 개발 (Development)

| 항목 | 내용 |
|------|------|
| **담당** | CTO (리드), 하위 에이전트들 |
| **세션** | 새로운 세션에서 실행 |
| **입력** | 기획 문서 + **HTML 목업**(`docs/design/mockups/feature-xxx/`) + `tokens.css` / `components.css` + 디자인 문서 + 개발 문서 (`docs/development/`) 확인으로 컨텍스트 유지 |
| **UI 구현 기준** | **반드시 HTML 목업과 디자인 시스템 토큰을 참조하여 UI를 구현**. 시안과 구현 간 불일치 시 Designer 에게 확인 요청 |
| **활동** | HTML 시안을 동일 토큰(`var(--…)`)과 `.ip-*` 컴포넌트 규약으로 실제 제품 코드에 재현, 비즈니스 로직 구현, 코드 리뷰, 단위 테스트 작성 |
| **산출물** | 구현 코드, 개발 문서 (`docs/development/feature-xxx.md`) |
| **완료 조건** | CTO 코드 리뷰 완료, **HTML 시안과 UI 일치 확인**, 칸반보드 상태 업데이트 |

#### Phase 4: 테스트 (Testing)

| 항목 | 내용 |
|------|------|
| **담당** | QA (리드) |
| **세션** | 새로운 세션에서 실행 |
| **입력** | 기획 문서 (수용 기준) + 개발 문서 확인으로 컨텍스트 유지 |
| **활동** | 통합 테스트, E2E 테스트, 버그 리포트 작성 |
| **산출물** | 테스트 결과 리포트, 버그 리포트 |
| **분기** | 통과 → Phase 5(배포) / 실패 → Phase 3(개발)로 회귀 |

#### Phase 5: 배포 (Deployment)

| 항목 | 내용 |
|------|------|
| **담당** | CTO (리드), QA, CEO |
| **세션** | 새로운 세션에서 실행 |
| **입력** | 테스트 결과 리포트, 배포 체크리스트 |
| **활동** | 배포 실행, 스모크 테스트, 롤백 계획 수립 |
| **산출물** | 배포 완료 보고, 릴리즈 노트 |
| **회의** | 배포 판단 회의 (CTO-QA-CEO) |

#### Phase 6: 문서화 & 최신화 (Documentation)

| 항목 | 내용 |
|------|------|
| **담당** | 전 에이전트 |
| **활동** | 모든 관련 문서 최신화, CHANGELOG 업데이트, 기술 문서 업데이트 |
| **목적** | 다음 스프린트/작업의 컨텍스트 유지를 위한 문서 정합성 확보 |

### 6.3 마케팅 워크플로우

```
기획 ──▶ 디자인 ──▶ 마케팅 실행
 │         │           │
 Marketer  Designer    Marketer
 CEO       Marketer
 PO
```

#### Phase 1: 마케팅 기획

| 항목 | 내용 |
|------|------|
| **담당** | Marketer (리드), CEO, PO |
| **세션** | 새로운 세션에서 실행 |
| **입력** | 프로덕트 비전, 기존 마케팅 문서 확인 |
| **활동** | 타겟 분석, 채널 전략, 메시징 프레임워크, KPI 설정 |
| **산출물** | 마케팅 전략 문서 (`docs/marketing/strategy-xxx.md`) |

#### Phase 2: 마케팅 디자인

| 항목 | 내용 |
|------|------|
| **담당** | Designer (리드), Marketer |
| **세션** | 새로운 세션에서 실행 |
| **산출 형식** | **HTML + CSS 목업** — 제품과 동일한 디자인 시스템(`tokens.css`/`components.css`) 을 재사용 (Pencil / Figma 등 외부 툴 사용 안 함) |
| **입력** | 마케팅 전략 문서, 디자인 시스템 |
| **활동** | 크리에이티브 시안·랜딩페이지·콘텐츠를 HTML 목업으로 제작하고 `meta.json` 선언 → Design Canvas 에서 확인 |
| **산출물** | 마케팅 HTML 시안 (`docs/marketing/mockups/*.html` + `meta.json`), 마케팅 디자인 자산 |

#### Phase 3: 마케팅 실행

| 항목 | 내용 |
|------|------|
| **담당** | Marketer (리드) |
| **세션** | 새로운 세션에서 실행 |
| **입력** | 마케팅 전략 + 디자인 자산 |
| **활동** | 캠페인 실행, 콘텐츠 배포, 성과 측정 |
| **산출물** | 마케팅 실행 리포트, 성과 분석 문서 |

---

## 7. 칸반보드 & 태스크 관리

### 7.1 칸반보드 구조

```
┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│ Backlog  │ To Do    │ In       │ Review   │ Testing  │ Done     │
│          │ (Sprint) │ Progress │          │          │          │
├──────────┼──────────┼──────────┼──────────┼──────────┼──────────┤
│ [TASK-7] │ [TASK-4] │ [TASK-2] │ [TASK-3] │ [TASK-1] │ [TASK-0] │
│ [TASK-8] │ [TASK-5] │          │          │          │          │
│ [TASK-9] │ [TASK-6] │          │          │          │          │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

### 7.2 Task 구조

```json
{
  "id": "TASK-42",
  "title": "사용자 로그인 기능 구현",
  "description": "이메일/비밀번호 기반 로그인 기능",
  "type": "feature",
  "status": "in_progress",
  "priority": "high",
  "sprint": "sprint-3",
  "assignee": "cto",
  "sub_agents": ["cto-sub-backend", "cto-sub-frontend"],
  "dependencies": ["TASK-40", "TASK-41"],
  "created_by": "po",
  "created_in_meeting": "2026-04-16-sprint-planning",
  "acceptance_criteria": [
    "이메일 형식 검증",
    "비밀번호 최소 8자",
    "로그인 성공 시 토큰 발급",
    "실패 시 에러 메시지 표시"
  ],
  "phase": "development",
  "documents": {
    "planning": "docs/planning/feature-login.md",
    "design": "docs/design/feature-login.md",
    "development": "docs/development/feature-login.md"
  },
  "created_at": "2026-04-16T10:00:00Z",
  "updated_at": "2026-04-16T14:30:00Z"
}
```

### 7.3 Task 생성 규칙

- Task는 **CEO, CTO, PO 에이전트들의 회의**를 통해 주체적으로 생성된다
- 사용자(투자자)가 직접 Task를 생성하지 않는다 (방향 제시만 가능)
- 모든 Task에는 다음이 필수:
  - 명확한 수용 기준 (Acceptance Criteria)
  - 우선순위와 의존성
  - 담당 에이전트 지정
  - 관련 기획 회의 참조

### 7.4 우선순위 관리

```
Priority Levels:
  critical  → 즉시 처리 (다른 작업 차단)
  high      → 현재 스프린트 필수
  medium    → 현재 스프린트 권장
  low       → 다음 스프린트 고려

의존성 규칙:
  - 선행 Task가 완료되지 않으면 후행 Task 시작 불가
  - 의존성 없는 Task는 병렬 실행
  - 순환 의존성 감지 시 CEO에게 보고
```

---

## 8. 컨텍스트 관리 시스템

### 8.1 문서 기반 컨텍스트 유지

각 워크플로우 페이즈는 **새로운 세션에서 실행**되므로, 문서를 통해 컨텍스트를 유지한다.

```
┌─────────────────────────────────────────────────────────┐
│                  컨텍스트 흐름도                           │
│                                                           │
│  [기획 세션]                                              │
│       │                                                   │
│       ▼ docs/planning/feature-xxx.md (산출)               │
│       │                                                   │
│  [디자인 세션] (HTML 목업 + 디자인 시스템)                │
│       │ docs/planning/feature-xxx.md (입력)               │
│       │ docs/design/system/tokens.css,components.css (입력)│
│       ▼ docs/design/feature-xxx.md (산출)                 │
│       ▼ docs/design/mockups/feature-xxx/*.html+meta.json  │
│       │                                                   │
│  [개발 세션]                                              │
│       │ docs/planning/feature-xxx.md (입력)               │
│       │ docs/design/feature-xxx.md (입력)                 │
│       │ docs/design/mockups/feature-xxx/*.html (입력)     │
│       │ docs/design/system/tokens.css (입력)              │
│       │ docs/development/feature-xxx.md (입력/산출)       │
│       ▼                                                   │
│  [테스트 세션]                                            │
│       │ docs/planning/feature-xxx.md (입력 - 수용 기준)   │
│       │ docs/development/feature-xxx.md (입력)            │
│       ▼                                                   │
│  [문서화]                                                 │
│       │ 모든 문서 최신화                                   │
│       ▼ docs/changelog/ (산출)                            │
└─────────────────────────────────────────────────────────┘
```

### 8.2 문서 충돌 방지 규칙

1. **Lock 메커니즘**: 문서 수정 시 `.lock` 파일 생성, 수정 완료 후 해제
2. **버전 관리**: 모든 문서 변경은 Git 커밋으로 추적
3. **최신화 의무**: 각 페이즈 완료 시 관련 문서를 반드시 최신 상태로 업데이트
4. **읽기 우선**: 작업 시작 전 반드시 관련 문서를 읽어 최신 컨텍스트 확보

### 8.3 회의록 & 의사결정 기록

```markdown
<!-- docs/meetings/2026-04-16-sprint-planning.md -->
# Sprint Planning Meeting

- **일시**: 2026-04-16
- **참여자**: CEO, CTO, PO
- **스프린트**: Sprint-3

## 안건
1. 로그인 기능 우선순위
2. 랜딩페이지 디자인 방향

## 논의 내용
### CEO:
"사용자 획득이 급선무이므로 랜딩페이지를 먼저 진행하자"

### CTO:
"로그인이 없으면 MVP 기능을 테스트할 수 없다. 로그인을 먼저 하되 최소한으로 구현하자"

### PO:
"소셜 로그인만 먼저 하고, 이메일 로그인은 다음 스프린트로 미루자"

## 결정사항
- 소셜 로그인(Google) 먼저 구현 → TASK-42
- 랜딩페이지 병렬 진행 → TASK-43
- 이메일 로그인은 Sprint-4로 연기

## 액션 아이템
- [TASK-42] PO: 소셜 로그인 기획서 작성
- [TASK-43] Designer: 랜딩페이지 디자인
```

---

## 9. 대시보드 UI

### 9.1 메인 대시보드

로컬 서버 (`http://localhost:3000`)에서 제공되는 웹 대시보드:

```
┌─────────────────────────────────────────────────────────────────┐
│  Perpetual Engine Dashboard              [Sprint-3]    [Settings] │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─ Company Status ──────────────────────────────────────────┐  │
│  │  Vision: AI 기반 요리 레시피 추천 서비스                    │  │
│  │  Sprint: Sprint-3 (진행중)   Tasks: 12/20 완료             │  │
│  │  Active Agents: 6    Sub-Agents: 3                         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Agent Status ────────────────────────────────────────────┐  │
│  │                                                            │  │
│  │  🟢 CEO      │ Idle       │ 마지막: 스프린트 계획 회의     │  │
│  │  🔵 CTO      │ Working    │ TASK-42: 소셜 로그인 구현     │  │
│  │  🟢 PO       │ Idle       │ 마지막: 기획서 작성 완료       │  │
│  │  🔵 Designer │ Working    │ TASK-43: 랜딩페이지 디자인     │  │
│  │  ⚪ QA       │ Waiting    │ 대기중: 개발 완료 대기         │  │
│  │  ⚪ Marketer │ Waiting    │ 대기중: 랜딩페이지 완료 대기   │  │
│  │                                                            │  │
│  │  Sub-Agents:                                               │  │
│  │  🔵 CTO-Backend  │ Working │ API 엔드포인트 구현           │  │
│  │  🔵 CTO-Frontend │ Working │ 로그인 UI 컴포넌트            │  │
│  │  🔵 CTO-Infra    │ Working │ OAuth 설정                    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Kanban Board ────────────────────────────────────────────┐  │
│  │  Backlog(5) │ To Do(3) │ Progress(2) │ Review │ Done(10)  │  │
│  │  ...        │ ...      │ ...         │ ...    │ ...       │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Recent Activity ─────────────────────────────────────────┐  │
│  │  14:30 CTO    - TASK-42 상태 변경: To Do → In Progress   │  │
│  │  14:25 PO     - TASK-44 생성: 마이페이지 기획             │  │
│  │  14:00 CEO    - 스프린트 계획 회의 완료                    │  │
│  │  13:45 Designer - TASK-43 디자인 시안 1차 완료             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Meetings & Decisions ────────────────────────────────────┐  │
│  │  최근 회의: 스프린트 계획 (14:00)  [회의록 보기]           │  │
│  │  최근 결정: 소셜 로그인 우선 구현  [상세 보기]             │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 대시보드 주요 뷰

| 뷰 | 설명 |
|----|------|
| **Overview** | 회사 상태, 에이전트 상태, 최근 활동 요약 |
| **Kanban Board** | Jira 스타일 칸반보드 - 드래그 불가 (에이전트가 관리) |
| **Agent Detail** | 특정 에이전트의 현재 작업, 세션 로그, 하위 에이전트 |
| **Meetings** | 회의록 목록 및 상세 내용 |
| **Decisions** | 의사결정 기록 목록 및 상세 내용 |
| **Design Canvas** | HTML 목업 갤러리(`/design`) — 줌/팬, 디바이스 필터, PNG 추출 지원 |
| **Documents** | 전체 문서 탐색기 |
| **Sprint** | 현재/과거 스프린트 현황, 번다운 차트 |
| **Settings** | 회사 목표, 에이전트 설정, 워크플로우 설정 |
| **Terminal** | 각 에이전트의 tmux 세션 실시간 출력 확인 |

---

## 10. 사용자(투자자) 인터랙션

### 10.1 초기 설정

사용자가 입력해야 하는 최소 정보:

```yaml
# 대시보드 Settings 또는 CLI를 통해 설정
company:
  name: "RecipeAI"
  mission: "모든 사람이 쉽고 건강하게 요리할 수 있게 돕는다"
  
product:
  name: "RecipeAI App"
  description: "AI 기반 맞춤형 요리 레시피 추천 웹 서비스"
  target_users: "요리 초보자, 건강 관심 직장인"
  core_value: "개인 맞춤형 레시피 추천"
  
constraints:
  tech_stack_preference: "auto"  # 또는 특정 기술 지정
  deploy_target: "vercel"        # 배포 환경
  budget_tokens: "unlimited"     # 토큰 예산
```

### 10.2 사용자 개입 포인트

사용자는 **투자자**로서 다음 시점에서 개입할 수 있다:

| 시점 | 개입 방식 | 예시 |
|------|-----------|------|
| **방향 전환** | 비전/목표 문서 수정 | "타겟을 B2B로 변경해줘" |
| **우선순위 조정** | 대시보드에서 피드백 | "마케팅보다 핵심 기능 먼저" |
| **에이전트 조정** | 에이전트 추가/제거 | "보안 전문가 에이전트 추가" |
| **긴급 지시** | CLI 또는 대시보드 | "이 버그 최우선으로 수정해" |
| **승인** | 대시보드 알림 | 배포 전 최종 승인 |

```bash
# CLI를 통한 사용자 개입
perpetual-engine message "로그인 기능보다 랜딩페이지를 먼저 해줘"
perpetual-engine pause          # 모든 에이전트 일시 정지
perpetual-engine resume         # 재개
perpetual-engine status         # 현재 상태 확인
```

---

## 11. 기술 아키텍처

### 11.1 시스템 구성도

```
┌─────────────────────────────────────────────────────────────┐
│                    Perpetual Engine Framework                     │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │   CLI Tool   │  │  Dashboard   │  │  Agent Runtime    │    │
│  │  (Node.js)   │  │  (Web App)   │  │  (Orchestrator)   │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────────┘    │
│         │                  │                  │                  │
│  ┌──────┴──────────────────┴──────────────────┴───────────┐    │
│  │                    Core Engine                           │    │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────────────┐  │    │
│  │  │  Session    │ │  Message   │ │  Document Manager  │  │    │
│  │  │  Manager    │ │  Bus       │ │  (컨텍스트 관리)    │  │    │
│  │  └────────────┘ └────────────┘ └────────────────────┘  │    │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────────────┐  │    │
│  │  │  Kanban     │ │  Sprint    │ │  Meeting           │  │    │
│  │  │  Manager    │ │  Manager   │ │  Coordinator       │  │    │
│  │  └────────────┘ └────────────┘ └────────────────────┘  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                              │                                    │
│  ┌───────────────────────────┴─────────────────────────────┐    │
│  │              tmux Session Layer                           │    │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐     │    │
│  │  │ CEO │ │ CTO │ │ PO  │ │ Des │ │ QA  │ │ Mkt │     │    │
│  │  └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘     │    │
│  │     │       │       │       │       │       │          │    │
│  │     ▼       ▼       ▼       ▼       ▼       ▼          │    │
│  │  Claude Code Sessions (각 에이전트별 독립 세션)          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                              │                                    │
│  ┌───────────────────────────┴─────────────────────────────┐    │
│  │              File System (Single Source of Truth)          │    │
│  │  docs/  │  kanban.json  │  sprints.json  │  workspace/   │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 11.2 기술 스택

| 구성 요소 | 기술 | 이유 |
|-----------|------|------|
| **CLI** | Node.js + Commander.js | npm 생태계 활용, 쉬운 배포 |
| **Dashboard** | React + Vite | 빠른 개발, 실시간 UI 업데이트 |
| **Dashboard UI** | Tailwind CSS + shadcn/ui | 빠른 UI 구성 |
| **Real-time** | WebSocket | 에이전트 상태 실시간 반영 |
| **Agent Runtime** | Node.js | Claude Code CLI 연동 |
| **Session Management** | tmux | 멀티 에이전트 병렬 실행 |
| **State Management** | File-based JSON | 단순성, Git 추적 가능 |
| **디자인 스택** | HTML + CSS (`tokens.css` + `components.css`) | Designer 산출물 형식. `meta.json` 과 함께 Design Canvas(`/design`) 로 렌더되고 CTO 가 동일 토큰으로 제품 구현. 외부 디자인 툴(Pencil/Figma) 사용 안 함 |
| **문서 관리** | Markdown + Git | 버전 관리, 충돌 감지 |

### 11.3 Claude Code 연동

각 에이전트는 독립된 Claude Code 세션으로 실행:

```bash
# 에이전트 세션 시작 예시
tmux new-session -d -s "cto" \
  "claude --session-id cto-sprint3-task42 \
   --system-prompt '$(cat .perpetual-engine/agents/cto.yaml)' \
   --append-system-prompt '현재 작업: TASK-42 소셜 로그인 구현\n컨텍스트: docs/planning/feature-login.md, docs/design/feature-login.md를 읽고 시작하세요'"
```

---

## 12. MVP 범위 (Phase 1)

### 12.1 MVP에 포함되는 기능

최소한의 동작 가능한 프레임워크:

| # | 기능 | 설명 | 우선순위 |
|---|------|------|----------|
| 1 | **CLI 설치 및 초기화** | `npm install -g` + `init` + `setup` | P0 |
| 2 | **기본 에이전트 6종** | CEO, CTO, PO, Designer, QA, Marketer 정의 및 실행 | P0 |
| 3 | **tmux 기반 멀티세션** | 에이전트별 독립 세션 실행 | P0 |
| 4 | **파일 기반 상태 관리** | kanban.json, sprints.json 관리 | P0 |
| 5 | **기본 워크플로우** | 기획→디자인→개발→테스트→배포 파이프라인 | P0 |
| 6 | **문서 기반 컨텍스트** | docs/ 구조, 세션 간 문서 전달 | P0 |
| 7 | **대시보드 (기본)** | 에이전트 상태, 칸반보드, 최근 활동 | P1 |
| 8 | **회의 시스템** | 에이전트 간 회의, 회의록 자동 생성 | P1 |
| 9 | **에이전트 간 메시징** | 파일 기반 메시지 큐 | P1 |
| 10 | **사용자 개입 CLI** | message, pause, resume, status | P1 |

### 12.2 MVP 이후 로드맵

| Phase | 기능 |
|-------|------|
| **Phase 2** | 하위 에이전트 병렬 생성, 에이전트 추가 고용 시스템, 스프린트 자동 관리 |
| **Phase 3** | 대시보드 고도화 (번다운 차트, 에이전트 터미널 뷰), 실시간 WebSocket |
| **Phase 4** | 플러그인 시스템, 외부 서비스 연동 (GitHub, Vercel, Slack), 배포 자동화 |
| **Phase 5** | 에이전트 성과 분석, 멀티 프로젝트 지원, 팀 템플릿 |

---

## 13. 성공 지표

| 지표 | 측정 방법 |
|------|-----------|
| **Task 완료율** | 생성된 Task 대비 완료된 Task 비율 |
| **스프린트 속도** | 스프린트당 완료 Task 수 추이 |
| **회의 → 액션 전환율** | 회의 결정사항이 실제 Task로 전환된 비율 |
| **테스트 통과율** | 첫 번째 테스트에서 통과하는 비율 |
| **배포 성공률** | 배포 시도 대비 성공 비율 |
| **문서 최신화율** | 페이즈 완료 후 문서 업데이트 여부 |
| **컨텍스트 유지 점수** | 세션 간 컨텍스트 손실 없이 작업이 이어진 비율 |

---

## 14. 제약 사항 및 리스크

| 리스크 | 영향 | 대응 방안 |
|--------|------|-----------|
| **Claude Code 토큰 소비** | 에이전트 수 * 세션 수 만큼 토큰 소비 | 토큰 사용량 모니터링, 예산 설정 기능 |
| **컨텍스트 윈도우 한계** | 긴 대화 시 초기 컨텍스트 손실 | 문서 기반 컨텍스트 유지, 새 세션에서 문서 재로딩 |
| **에이전트 간 충돌** | 동시에 같은 파일 수정 시 충돌 | Lock 메커니즘, Git 기반 충돌 감지 |
| **무한 루프** | 개발-테스트 반복이 끝나지 않음 | 최대 반복 횟수 설정, 에스컬레이션 규칙 |
| **품질 일관성** | 에이전트 출력 품질 편차 | 에이전트별 명확한 규칙, 체크리스트 기반 품질 검증 |

---

## 15. 용어 사전

| 용어 | 정의 |
|------|------|
| **투자자 (Investor)** | Perpetual Engine 사용자. 회사 비전을 설정하고 토큰을 지원하는 역할 |
| **에이전트 (Agent)** | 특정 역할을 수행하는 AI 팀원. Claude Code 세션으로 실행 |
| **하위 에이전트 (Sub-Agent)** | 메인 에이전트가 작업 병렬화를 위해 생성하는 임시 에이전트 |
| **세션 (Session)** | 에이전트가 특정 작업을 수행하는 하나의 Claude Code 대화 단위 |
| **페이즈 (Phase)** | 워크플로우의 단계 (기획, 디자인, 개발, 테스트, 배포) |
| **스프린트 (Sprint)** | 일정 기간 동안 수행할 작업 묶음 단위 |
| **칸반보드 (Kanban Board)** | Task 진행 상태를 시각적으로 보여주는 보드 |
| **Design Canvas** | 대시보드 `/design` 페이지. `docs/design/mockups/**/meta.json` 을 스캔해 HTML 목업을 줌/팬/PNG 추출 가능한 캔버스로 렌더. 상단 Design 탭에서 진입 |
| **HTML 목업** | Designer 산출물. `docs/design/mockups/<feature>/*.html` + `meta.json`. `docs/design/system/` 의 토큰(`var(--…)`)과 컴포넌트(`.ip-*`) 만 사용하며 CTO 가 동일 토큰으로 제품 코드에 재현함 |

---

## 부록 A: CLI 명령어 전체 목록

```bash
# 프로젝트 관리
perpetual-engine init <name>           # 새 프로젝트 생성
perpetual-engine setup                 # 대화형 초기 설정
perpetual-engine start                 # 대시보드 + 에이전트 팀 가동
perpetual-engine stop                  # 모든 에이전트 종료
perpetual-engine pause                 # 일시 정지
perpetual-engine resume                # 재개
perpetual-engine status                # 현재 상태 요약

# 에이전트 관리
perpetual-engine team                  # 에이전트 팀 목록
perpetual-engine hire --role <role>    # 에이전트 추가 고용
perpetual-engine fire <agent>          # 에이전트 해고
perpetual-engine agent <name>          # 특정 에이전트 상세 정보

# 사용자 개입
perpetual-engine message "<msg>"       # 팀에게 메시지 전달
perpetual-engine priority <task> <lvl> # 우선순위 변경 요청
perpetual-engine approve <task>        # Task/배포 승인

# 모니터링
perpetual-engine board                 # 칸반보드 (터미널)
perpetual-engine sprint                # 현재 스프린트 정보
perpetual-engine meetings              # 최근 회의록 목록
perpetual-engine logs <agent>          # 에이전트 로그 확인
```

---

## 부록 B: 에이전트 설정 스키마

```yaml
# .perpetual-engine/agents/<agent>.yaml
name: string                    # 에이전트 이름
role: enum                      # ceo | cto | po | designer | qa | marketer | custom
description: string             # 역할 설명

responsibilities:               # 담당 업무 목록
  - string

rules:                          # 에이전트가 지켜야 할 규칙
  - string

required_mcp_tools:             # 필수 MCP 도구 (선택. 현재 기본 팀은 없음)
  - string

can_create_sub_agents: boolean  # 하위 에이전트 생성 가능 여부
max_sub_agents: number          # 최대 하위 에이전트 수

reports_to: string              # 보고 대상 에이전트
collaborates_with:              # 주요 협업 대상
  - string

system_prompt_template: string  # Claude Code 시스템 프롬프트 템플릿

meeting_permissions:            # 회의 소집 권한
  can_schedule: boolean
  can_participate: boolean
  required_meetings:            # 필수 참여 회의 유형
    - string
```
