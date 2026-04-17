import type { AgentRole } from '../agent/agent-types.js';
import type { WorkflowPhase, TaskStatus } from '../state/types.js';

export interface Phase {
  name: WorkflowPhase;
  /** 이 페이즈에 진입할 때 칸반 ���드에 표시할 상태 */
  taskStatus: TaskStatus;
  leadAgent: AgentRole;
  participantAgents: AgentRole[];
  inputDocPaths: (taskSlug: string) => string[];
  outputDocPaths: (taskSlug: string) => string[];
  completionCriteria: string;
  nextPhase: WorkflowPhase | null;
  onFailure?: WorkflowPhase;
}

function taskSlugToDocPath(prefix: string, taskSlug: string): string {
  return `docs/${prefix}/feature-${taskSlug}.md`;
}

export const WORKFLOW_PHASES: Phase[] = [
  {
    name: 'planning',
    taskStatus: 'in_progress',
    leadAgent: 'po',
    participantAgents: ['ceo', 'cto'],
    inputDocPaths: () => ['docs/vision/company-goal.md', 'docs/vision/product-vision.md'],
    outputDocPaths: (slug) => [taskSlugToDocPath('planning', slug)],
    completionCriteria: '기획 문서가 docs/planning/에 생성되고 수용 기준이 명확히 정의됨',
    nextPhase: 'design',
    onFailure: 'planning',
  },
  {
    name: 'design',
    taskStatus: 'in_progress',
    leadAgent: 'designer',
    participantAgents: ['po'],
    inputDocPaths: (slug) => [
      taskSlugToDocPath('planning', slug),
      'docs/design/system/design-system.md',
      'docs/design/system/tokens.css',
      'docs/design/system/components.css',
    ],
    outputDocPaths: (slug) => [
      taskSlugToDocPath('design', slug),
      `docs/design/mockups/${slug}/`,
    ],
    completionCriteria: '디자인 시스템(docs/design/system/tokens.css + components.css + design-system.md)이 존재하고, 피처 시안이 시스템 토큰/컴포넌트만 참조하는 HTML + meta.json 으로 docs/design/mockups/<feature>/ 에 생성됨 (시스템이 없다면 이번 페이즈에서 먼저 부트스트랩; 리터럴 색상/px 금지)',
    nextPhase: 'development',
    onFailure: 'design',
  },
  {
    name: 'development',
    taskStatus: 'in_progress',
    leadAgent: 'cto',
    participantAgents: [],
    inputDocPaths: (slug) => [
      taskSlugToDocPath('planning', slug),
      taskSlugToDocPath('design', slug),
      'docs/design/system/design-system.md',
      'docs/design/system/tokens.css',
      'docs/design/system/components.css',
      `docs/design/mockups/${slug}/`,
    ],
    outputDocPaths: (slug) => [taskSlugToDocPath('development', slug)],
    completionCriteria: '코드가 workspace/에 구현되고 개발 문서가 작성됨. 디자인 시안(HTML 목업)의 토큰·컴포넌트 이름이 실제 코드의 디자인 토큰/컴포넌트와 1:1 매핑되어 재현됨',
    nextPhase: 'testing',
    onFailure: 'development',
  },
  {
    name: 'testing',
    taskStatus: 'testing',
    leadAgent: 'qa',
    participantAgents: [],
    inputDocPaths: (slug) => [
      taskSlugToDocPath('planning', slug),
      taskSlugToDocPath('development', slug),
    ],
    outputDocPaths: () => [],
    completionCriteria: '모든 테스트가 통과하고 수용 기준이 충족됨',
    nextPhase: 'deployment',
    onFailure: 'development',
  },
  {
    name: 'deployment',
    taskStatus: 'review',
    leadAgent: 'cto',
    participantAgents: ['qa', 'ceo'],
    inputDocPaths: () => [],
    outputDocPaths: () => [],
    completionCriteria: '배포가 성공적으로 완료됨',
    nextPhase: 'documentation',
  },
  {
    name: 'documentation',
    taskStatus: 'review',
    leadAgent: 'po',
    participantAgents: ['cto'],
    inputDocPaths: (slug) => [
      taskSlugToDocPath('planning', slug),
      taskSlugToDocPath('design', slug),
      taskSlugToDocPath('development', slug),
    ],
    outputDocPaths: () => [],
    completionCriteria: '모든 관련 문서가 최신화됨',
    nextPhase: null,
  },
];

export function getPhase(name: WorkflowPhase): Phase | undefined {
  return WORKFLOW_PHASES.find(p => p.name === name);
}

export function getNextPhase(currentPhase: WorkflowPhase): Phase | undefined {
  const current = getPhase(currentPhase);
  if (!current?.nextPhase) return undefined;
  return getPhase(current.nextPhase);
}
