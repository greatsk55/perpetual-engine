import { nanoid } from 'nanoid';
import type { AgentConfig } from './agent-types.js';

/**
 * 자문 전문가 에이전트 생성 요청.
 *
 * 고정된 도메인 목록이 없다.
 * 에이전트가 "이런 전문가가 필요하다"고 자유롭게 서술하면
 * 그 설명으로부터 전문가 에이전트를 즉석 생성한다.
 */
export interface ConsultantRequest {
  /**
   * 어떤 전문가가 필요한지 자유 서술.
   * 예: "SaaS B2B 가격 전략 전문가", "GDPR 및 한국 개인정보보호법 전문 변호사",
   *     "헬스케어 도메인의 데이터 규제 전문가", "시리즈A 투자유치 경험이 풍부한 재무 전문가"
   */
  expertise: string;
  /** 자문 요청 배경/컨텍스트 — 왜 이 전문가가 필요한지 */
  context: string;
  /** 구체적 질문 목록 */
  questions: string[];
  /** 자문을 요청한 에이전트 */
  requested_by: string;
  /** 관련 태스크 ID (있으면) */
  related_task_id?: string;
}

/** 생성된 자문 에이전트 인스턴스 (추적용) */
export interface ConsultantAgent {
  /** 고유 ID (예: "consultant-a8f3k2m1") */
  id: string;
  /** 실제 AgentConfig */
  config: AgentConfig;
  /** 전문 분야 (요청자가 서술한 그대로) */
  expertise: string;
  /** 생성 시각 */
  created_at: string;
  /** 요청자 */
  requested_by: string;
  /** 관련 태스크 */
  related_task_id?: string;
  /** 소멸 여부 */
  disposed: boolean;
}

/**
 * 자문 전문가 에이전트 팩토리.
 *
 * 미리 정의된 도메인 없이, 요청에 서술된 전문성으로부터
 * 즉석으로 해당 분야 전문가 에이전트를 생성한다.
 * 생성된 에이전트는 목적 완수 후 자동 소멸된다.
 */
export class ConsultantFactory {
  /**
   * 자문 요청으로부터 에페메럴(일시적) 전문가 에이전트를 즉석 생성한다.
   *
   * expertise 필드에 서술된 내용이 곧 이 에이전트의 정체성이 된다.
   * "GDPR 전문 변호사"라고 쓰면 GDPR 전문 변호사가 되고,
   * "핀테크 결제 시스템 아키텍트"라고 쓰면 그 전문가가 된다.
   */
  create(request: ConsultantRequest): ConsultantAgent {
    const id = `consultant-${nanoid(8)}`;

    const systemPrompt = `당신은 "${request.expertise}" 전문가입니다.

당신은 이 분야에서 10년 이상의 깊은 실무 경험을 가진 최고 수준의 전문가입니다.
스타트업 환경에서의 실전 조언에 특화되어 있으며, 이론보다 실행 가능한 구체적 가이드를 제공합니다.

## 자문 요청 배경
${request.context}

## 답변해야 할 질문
${request.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

## 진실성 원칙 (최우선)
- **거짓 정보, 날조된 사실, 검증되지 않은 추정치를 사실처럼 사용하지 않는다.**
- 통계·수치·법령·표준·사례를 인용할 때 반드시 출처(문서명, 조항, URL, 발행 연도 중 가능한 것)를 명시한다.
- 출처가 불확실하면 "[출처 미확인]" 또는 "[일반적 업계 통념]" 으로 표기하고 단정하지 않는다.
- 전문 범위 밖이거나 최신 정보가 필요한 질문은 "내 전문 범위 밖" 또는 "추가 검증 필요"로 명확히 밝힌다.
- 추측을 사실처럼 단정하느니, 짧고 검증된 답 + 미확인 항목 목록을 제공한다.

## 자문 규칙
1. "${request.expertise}" 분야의 깊은 전문 지식을 기반으로 답변한다
2. 추상적 조언이 아닌, 바로 실행할 수 있는 구체적 가이드를 제공한다
3. 불확실하거나 전문 범위 밖의 질문은 명확히 밝히고, 어디서 추가 정보를 얻을 수 있는지 안내한다
4. 리스크와 트레이드오프를 솔직히 짚어준다
5. 답변을 docs/decisions/ 에 문서화한다 (출처 인용 포함)
6. 핵심 권고사항 요약 + 실행 계획(action items)을 반드시 포함한다
7. 자문이 끝나면 추가로 할 일이 없다 — 당신의 역할은 여기서 종료된다`;

    const config: AgentConfig = {
      name: `자문: ${request.expertise}`,
      role: 'custom',
      description: `${request.expertise} — 일시적 자문 전문가`,
      responsibilities: [
        `${request.expertise} 분야의 전문 자문 제공`,
        '질문에 대한 구체적이고 실행 가능한 답변',
        '리스크 및 트레이드오프 분석',
        '실행 계획(action items) 제안',
      ],
      rules: [
        '전문 지식에 기반한 객관적 조언',
        '불확실한 부분은 명확히 표시',
        '바로 실행 가능한 수준의 구체적 권고',
        '자문 결과를 문서화',
      ],
      skills: [],
      can_create_sub_agents: false,
      max_sub_agents: 0,
      reports_to: request.requested_by,
      collaborates_with: [request.requested_by],
      system_prompt_template: systemPrompt,
      meeting_permissions: {
        can_schedule: false,
        can_participate: true,
        required_meetings: ['consultation'],
      },
    };

    return {
      id,
      config,
      expertise: request.expertise,
      created_at: new Date().toISOString(),
      requested_by: request.requested_by,
      related_task_id: request.related_task_id,
      disposed: false,
    };
  }
}
