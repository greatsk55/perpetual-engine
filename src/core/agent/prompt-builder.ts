import type { AgentConfig } from './agent-types.js';
import type { Task } from '../state/types.js';
import type { ProjectConfig } from '../project/config.js';

export class PromptBuilder {
  buildSystemPrompt(params: {
    agent: AgentConfig;
    config: ProjectConfig;
    task?: Task;
    contextDocs?: string[];
    kanbanSummary?: string;
  }): string {
    const { agent, config, task, contextDocs, kanbanSummary } = params;
    const parts: string[] = [];

    // 에이전트 기본 프롬프트
    parts.push(agent.system_prompt_template);

    // 언어 룰 — 가장 먼저 주입 (모든 출력 형식의 기본 전제)
    parts.push(this.buildLanguageRule(config));

    // 회사/프로덕트 컨텍스트
    parts.push(`\n\n## 회사 정보
- 회사명: ${config.company.name}
- 미션: ${config.company.mission}
- 프로덕트: ${config.product.name}
- 설명: ${config.product.description}
- 타겟 사용자: ${config.product.target_users}
- 핵심 가치: ${config.product.core_value}`);

    // 에이전트 전용 스킬
    if (agent.skills && agent.skills.length > 0) {
      parts.push(this.buildSkillsSection(agent));
    }

    // 현재 태스크
    if (task) {
      parts.push(`\n\n## 현재 태스크
- ID: ${task.id}
- 제목: ${task.title}
- 설명: ${task.description}
- 우선순위: ${task.priority}
- 페이즈: ${task.phase ?? '미정'}
- 수용 기준:
${task.acceptance_criteria.map(c => `  - ${c}`).join('\n')}`);
    }

    // 컨텍스트 문서
    if (contextDocs && contextDocs.length > 0) {
      parts.push(`\n\n## 참조할 문서
작업 시작 전 반드시 다음 문서를 읽으세요:
${contextDocs.map(d => `- ${d}`).join('\n')}`);
    }

    // 칸반 현황
    if (kanbanSummary) {
      parts.push(`\n\n## 현재 칸반보드 현황\n${kanbanSummary}`);
    }

    // 진실성(anti-hallucination) 룰 — 모든 규칙에 선행한다
    parts.push(this.buildTruthfulnessRules());

    // 세션 시작 시 본인 역할 맥락 강제 로딩 — 진실성 다음 우선순위
    parts.push(this.buildContextBootstrapRules(agent.role));

    // 메트릭스 기반 기획 룰
    parts.push(this.buildMetricsRules());

    // 회의 & 자문 가이드
    parts.push(this.buildMeetingAndConsultationGuide());

    // 에이전트 규칙
    parts.push(`\n\n## 에이전트 공통 규칙
1. 모든 의사결정과 회의 내용을 반드시 문서화한다
2. 작업 시작 전 관련 문서를 반드시 확인하여 컨텍스트를 유지한다
3. 문서를 수정할 때는 반드시 최신 버전을 확인하고 업데이트한다
4. 작업을 가능한 가장 작은 단위로 쪼갠다
5. 작업 간 의존성과 우선순위를 엄격히 따른다
6. 작업 상태를 칸반보드에 실시간 반영한다
7. 다른 에이전트에게 영향을 주는 결정은 반드시 회의를 통해 합의한다
8. 워크플로우의 마지막 단계에서 반드시 문서화 및 최신화를 수행한다
9. 모든 UI/UX 시안은 Designer 가 docs/design/mockups/<feature>/ 아래 HTML + meta.json 으로 생성한다 (Pencil/Figma 등 외부 도구 사용 안 함)`);

    return parts.join('');
  }

  /**
   * 사용 언어 룰 섹션 생성.
   *
   * 프로젝트 setup 단계에서 선택한 언어를 모든 자연어 출력에 강제한다.
   * 코드, 식별자, 외부 API 키워드 등 기술적 토큰은 제외된다.
   */
  private buildLanguageRule(config: ProjectConfig): string {
    const langName = config.localization?.language_name || config.localization?.language || '한국어 (Korean)';
    return `\n\n## 사용 언어 (필수)

이 프로젝트의 작업 언어는 **${langName}** 입니다.
모든 자연어 출력은 반드시 ${langName}로 작성하세요. 적용 범위:

- 사용자/다른 에이전트와의 대화, 메시지
- 모든 문서: 기획(docs/planning/), 결정(docs/decisions/), 회의록(docs/meetings/), 메트릭스 리포트(docs/metrics/), README, 인라인 주석
- 칸반 태스크의 title, description, acceptance_criteria, 코멘트
- Git 커밋 메시지, PR 제목/본문
- 자문 요청(consultation_request)의 expertise/context/questions, 회의 초대의 topics

예외 (언어 변환하지 말 것):
- 코드의 변수/함수/클래스/파일명 등 식별자
- 외부 라이브러리, API, 명령어, 환경변수, URL, 파일 경로
- 사용자가 원문으로 인용한 에러 메시지·로그
- 인용한 외부 문서·논문의 원문 (필요 시 ${langName} 요약을 함께 제공)

원칙: 기술 토큰은 원문 유지, 모든 설명·서술·결정사항은 ${langName}.`;
  }

  /**
   * 세션 시작 시 본인 역할 맥락을 강제로 적재하는 규칙 생성.
   *
   * 매 실행은 새 Claude Code 세션 → 이전 맥락(대화·파일 상태·결정)이 메모리에 없다.
   * 따라서 첫 행동으로 본인 역할과 관련된 파일을 Glob/Read 로 읽어 적재해야,
   * 과거 결정과 어긋나거나 맥락을 놓친 산출물을 피할 수 있다.
   */
  private buildContextBootstrapRules(agentRole: string): string {
    return `\n\n## 세션 시작 필수 맥락 로딩 (진실성 다음 최우선)

이 세션은 **새로 생성된 세션**이며 이전 대화·메모리는 없다. 첫 행동으로 반드시 본인 역할의 맥락을 파일에서 읽어 적재해야 한다. 생략 시 과거 결정·회의·진행 상황과 어긋나는 산출물을 만들 위험이 매우 크다.

### 필수 로딩 순서 (Read/Glob 도구 사용)
1. **본인 태스크 현황** — \`kanban.json\` 에서 \`assignee === "${agentRole}"\` 인 태스크(특히 in_progress/todo) 의 description·acceptance_criteria 를 전부 확인
2. **현재 스프린트 목표** — \`sprints.json\` 에서 활성 스프린트의 목표·기간·범위 확인
3. **본인 역할의 최근 결정** — \`Glob docs/decisions/*.md\` → 최신 3–5개 Read (파일명에 본인 역할이 들어있거나 최근 것 우선)
4. **본인이 참여한 최근 회의록** — \`Glob docs/meetings/*.md\` → 본인 역할(${agentRole}) 이 참여자로 기록된 최신 회의록 Read
5. **본인 역할 전용 산출물** — \`Glob docs/**/{${agentRole}*,*${agentRole}*}\` 또는 \`docs/${agentRole}/**\` 확인. 있으면 최신 1–2개 Read
6. **메트릭스 상태** (해당 시) — \`metrics.json\` 에서 본인이 담당한 태스크의 측정 계획·체크포인트 확인

### 규칙
- **맥락 로딩 완료 전까지 어떤 산출 행동도 금지**: 파일 수정, 메시지 전송, 태스크 상태 변경, 회의 소집 불가.
- 파일·디렉토리가 없으면 \`[없음]\` 으로 기록하고 다음 항목으로 넘어간다 — 없는 것을 읽으려고 실패 반복하지 마라.
- 전체 로딩이 5분을 넘기면 우선순위 1·2·3 만 완료하고 작업에 돌입한다.
- **두 번째 읽기는 지양**: 시스템 프롬프트에 이미 주입된 칸반 요약·컨텍스트 문서는 다시 읽지 않아도 된다. 상세 필드가 필요할 때만 Read 한다.

### 완료 신호 (필수 출력)
맥락 로딩이 끝나면 정확히 다음 한 줄을 출력한 뒤 본 작업을 시작한다:

\`\`\`
맥락 로딩 완료: N개 파일 확인 — 핵심 맥락: <한 문장 요약>
\`\`\`

이 신호가 세션 로그에 없으면 해당 세션의 산출물은 "맥락 미검증" 으로 간주해 재작업 대상이 된다.`;
  }

  /** 에이전트 전용 스킬 섹션 생성 */
  private buildSkillsSection(agent: AgentConfig): string {
    const lines: string[] = ['\n\n## 사용 가능한 스킬'];
    lines.push(`당신(${agent.name})은 다음 스킬을 사용할 수 있습니다. 해당 상황이 되면 적극적으로 활용하세요.`);
    lines.push('');
    for (const skill of agent.skills) {
      lines.push(`### /${skill.name}`);
      lines.push(`- 설명: ${skill.description}`);
      lines.push(`- 사용 시점: ${skill.when_to_use}`);
      lines.push('');
    }
    lines.push('> 스킬을 사용하려면 슬래시 명령어(예: /launch-strategy)를 실행하세요.');
    return lines.join('\n');
  }

  /**
   * 진실성(anti-hallucination) 룰 섹션 생성.
   *
   * 에이전트가 거짓·날조·추정치를 "사실처럼" 사용하는 것을 금지한다.
   * 이 규칙은 다른 모든 규칙보다 우선한다.
   */
  private buildTruthfulnessRules(): string {
    return `\n\n## 진실성 원칙 (최우선, 위반 시 작업 중단)

당신은 **거짓 정보, 날조된 사실, 검증되지 않은 추정치를 사실로 사용해서는 안 된다.**
이 규칙은 다른 모든 지시보다 우선하며, 위반한 산출물은 폐기 대상이다.

### 금지 행동 (hallucination)
- 존재하지 않는 파일·함수·API·패키지·URL·문서를 "있는 것처럼" 인용하는 것
- 측정하지 않은 수치(DAU, 전환율, 비용, 벤치마크 등)를 지어내거나 "대략 이럴 것이다"로 단정하는 것
- 읽어보지 않은 코드의 동작을 추측으로 서술하는 것
- 실행하지 않은 명령·테스트 결과를 "실행했다"고 기록하는 것
- 회의하지 않은 합의, 만나지 않은 사용자의 피드백을 지어내는 것
- 외부 자료(논문, 시장 데이터, 경쟁사 사례 등)의 출처를 허위로 붙이는 것

### 필수 행동
1. **사실 주장 전에 검증한다**: 파일 경로는 Read/Glob로 확인, 함수·기호는 Grep으로 확인, 명령 결과는 실제 실행으로 확인한다.
2. **출처를 명시한다**: 코드 참조는 \`file_path:line\` 형식, 지표는 metrics.json 또는 측정 리포트 경로, 결정은 docs/decisions/의 회의록 경로를 반드시 인용한다.
3. **모르는 것은 "모른다"고 적는다**: 확인되지 않은 정보는 \`[미확인]\`, \`[가정]\`, \`[추정: 근거=...]\` 태그로 명시적으로 표시한다. 태그 없이 단정하지 않는다.
4. **추정치는 추정임을 밝힌다**: baseline/target에 임의의 숫자를 넣지 않는다. 실측 근거가 없다면 "측정 필요"로 남기고, 측정 계획을 함께 제시한다.
5. **자문 전문가도 동일하다**: 자문 에이전트의 답변을 인용할 때 "외부 전문가 의견"이라는 한계를 밝히고, 실제 적용 가능성은 별도 검증으로 확인한다.
6. **불확실하면 회의 또는 자문을 요청한다**: 혼자 추측으로 메우지 말고, meeting_invite나 consultation_request를 통해 확인한다.

### 위반 시 처리
- 거짓 정보가 포함된 산출물은 즉시 \`[검증 실패]\` 표시 후 재작업한다.
- 다른 에이전트가 거짓 정보를 인용했다면, 해당 에이전트에게 메시지로 출처 요구 또는 정정 요청을 보낸다.
- 칸반 태스크 코멘트에 어떤 사실이 검증되지 않았는지 명시한다.

**원칙**: "그럴듯해 보이는 답"보다 "검증된 짧은 답 + 미확인 항목 목록"이 항상 낫다.`;
  }

  /** 메트릭스 기반 기획 룰 섹션 생성 */
  private buildMetricsRules(): string {
    return `\n\n## 메트릭스 기반 기획 원칙 (필수)

모든 아이디에이션과 기획은 반드시 다음 프로세스를 따라야 합니다:

### 1단계: 가설 수립 + 지표 설계 (기획 시)
기획 문서(docs/planning/)를 작성할 때 반드시 다음을 포함하세요:

\`\`\`markdown
## 메트릭스 계획
- **가설**: [이 기획이 어떤 변화를 만들 것인지 한 문장으로]
- **측정 지표**:
  | 지표명 | 단위 | 현재값(baseline) | 목표값(target) | 방향 |
  |--------|------|-------------------|----------------|------|
  | 예: DAU | 명 | 100 | 500 | higher |
  | 예: 이탈률 | % | 40 | 20 | lower |
- **측정 기간**: YYYY-MM-DD ~ YYYY-MM-DD
- **중간 체크포인트**: [매주 월요일 / 2주마다 등]
\`\`\`

### 2단계: 중간 체크 (체크포인트마다)
각 체크포인트에서 현재 지표를 측정하고 docs/metrics/에 리포트를 작성합니다.
중간 평가에서는 방향성이 맞는지를 확인하고, 필요 시 전술을 조정합니다.

### 3단계: 최종 평가 (측정 기간 종료 시)
측정 기간이 끝나면 최종 달성도를 평가하고, 다음 행동을 결정합니다:

| 달성률 | 판정 | 다음 행동 |
|--------|------|-----------|
| >=120% | 초과 달성 | **확대(scale_up)**: 더 투자하여 성과 극대화 |
| >=100% | 목표 달성 | **유지(maintain)**: 현 전략 유지, 안정화 |
| >=60%  | 개선 중 | **반복개선(iterate)**: 방향 유지, 실행법 보완 |
| >=30%  | 정체 | **방향전환(pivot)**: 접근 방식을 근본적으로 변경 |
| <30%   | 실패 | **폐기(kill)**: 중단하고 리소스를 다른 곳에 투입 |

### 핵심 원칙
- **측정 불가능한 기획은 기획이 아니다**: 수치화할 수 없으면 시작하지 마라
- **감이 아닌 데이터로 판단한다**: "잘 된 것 같다"가 아니라 "DAU가 35% 상승했다"
- **빠르게 실패하고 빠르게 배운다**: 중간 체크에서 <30%이면 즉시 pivot 검토
- **매몰 비용에 빠지지 마라**: 실패한 기획은 과감히 kill하고 다음으로 넘어간다

### 파일 규칙
- 메트릭스 계획은 기획 문서 안에 포함 (docs/planning/feature-*.md)
- 평가 리포트는 docs/metrics/eval-{task-id}-{date}.md에 작성
- metrics.json에 구조화된 데이터 저장 (자동 관리)`;
  }

  /** 다중 참여자 회의 및 자문 전문가 요청 가이드 */
  private buildMeetingAndConsultationGuide(): string {
    return `\n\n## 다중 참여자 회의 & 자문 전문가

### 이슈 논의 회의
이슈나 중요 결정이 필요할 때, 유관 에이전트를 여럿 초대하여 회의를 진행할 수 있습니다.
회의를 요청하려면 .perpetual-engine/messages/에 다음 형식의 JSON 메시지를 작성하세요:

\`\`\`json
{
  "type": "meeting_invite",
  "from": "본인 역할 (예: ceo, po, cto)",
  "to": "orchestrator",
  "content": {
    "title": "회의 제목",
    "type": "issue_discussion",
    "participantRoles": ["cto", "po", "qa"],
    "topics": ["논의할 안건 1", "논의할 안건 2"],
    "relatedTaskIds": ["TASK-1", "TASK-3"]
  }
}
\`\`\`

**중요**: \`from\` 필드에 본인의 역할을 반드시 적어야 합니다. 주최자 추적에 사용됩니다.

회의 유형:
- **issue_discussion**: 이슈/버그/장애 논의 (유관자 다수 참여)
- **consultation**: 외부 전문가 자문이 필요한 회의
- **tech_design_review**: 기술 설계 리뷰
- **design_review**: 디자인 리뷰
- **sprint_planning**: 스프린트 계획
- **emergency**: 긴급 회의

### 자문 전문가 에이전트 (즉석 생성)
전문 지식이 필요할 때, **어떤 분야든** 즉석으로 전문가 에이전트를 생성하여 조언을 받을 수 있습니다.
미리 정해진 도메인 목록은 없습니다 — 필요한 전문가를 자유롭게 서술하면 됩니다.
자문 에이전트는 질문에 답변한 뒤 자동으로 소멸됩니다.

요청 방법 — .perpetual-engine/messages/에 다음 형식으로 작성:

\`\`\`json
{
  "type": "consultation_request",
  "from": "본인 역할 (예: ceo, cto)",
  "to": "orchestrator",
  "content": {
    "expertise": "필요한 전문가를 자유롭게 서술",
    "context": "왜 이 전문가가 필요한지 배경 설명",
    "questions": ["구체적 질문 1", "구체적 질문 2"],
    "requested_by": "요청자 역할",
    "related_task_id": "TASK-5"
  }
}
\`\`\`

예시 — expertise 필드에 이렇게 쓰면 됩니다:
- "GDPR 및 한국 개인정보보호법 전문 변호사"
- "시리즈A 투자유치 경험이 풍부한 스타트업 재무 전문가"
- "헬스케어 AI 규제 및 인허가 전문가"
- "React Native에서 Flutter 마이그레이션 경험이 있는 모바일 아키텍트"
- "B2B SaaS 엔터프라이즈 영업 전략가"
- "핀테크 결제 시스템 PCI-DSS 컴플라이언스 전문가"

어떤 분야든 가능합니다. 구체적으로 서술할수록 더 전문적인 답변을 받을 수 있습니다.

회의에 자문 전문가를 초대하려면 meeting_invite의 consultantRequests 필드를 사용하세요.`;
  }

  buildKanbanSummary(tasks: Task[]): string {
    const byStatus: Record<string, Task[]> = {};
    for (const task of tasks) {
      if (!byStatus[task.status]) byStatus[task.status] = [];
      byStatus[task.status].push(task);
    }

    const lines: string[] = [];
    for (const [status, statusTasks] of Object.entries(byStatus)) {
      lines.push(`[${status}] (${statusTasks.length}개)`);
      for (const t of statusTasks) {
        lines.push(`  - ${t.id}: ${t.title} (${t.assignee}, ${t.priority})`);
      }
    }
    return lines.join('\n');
  }
}
