export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'testing' | 'done' | 'suspended';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskType = 'feature' | 'bug' | 'chore' | 'spike' | 'design' | 'marketing';
/**
 * 워크플로우 페이즈.
 *
 * `development` 페이즈는 컴포넌트 단위 TDD 흐름을 위해 3개로 분할되었다:
 * - `development-plan`: CTO 가 기술 스택과 컴포넌트 분해를 산출 (`tech-stack.md` + `components.json`)
 * - `development-component`: 컴포넌트마다 인스턴스화되어 5종 테스트(unit/UI/snapshot/integration/E2E) 까지 작성
 * - `development-integrate`: 전체 통합 + 통합 빌드/테스트
 *
 * 옛 값 `development` 는 마이그레이션을 위해 타입에 남겨둔다 — 새 워크플로우 빌더는 이를
 * `development-plan` 으로 재해석한다 ([resumeInFlightTasks](src/core/workflow/orchestrator.ts) 참고).
 */
export type WorkflowPhase =
  | 'planning'
  | 'design'
  | 'development'
  | 'development-plan'
  | 'development-component'
  | 'development-integrate'
  | 'testing'
  | 'deployment'
  | 'documentation';

export interface Task {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  sprint: string | null;
  assignee: string;
  sub_agents: string[];
  dependencies: string[];
  created_by: string;
  created_in_meeting: string | null;
  acceptance_criteria: string[];
  phase: WorkflowPhase | null;
  documents: {
    planning?: string;
    design?: string;
    development?: string;
  };
  /** 중단 전 상태 (suspended에서 resume 시 복원용) */
  suspended_from?: TaskStatus;
  /** 중단 사유 */
  suspended_reason?: string;
  /** 메트릭스 기반 평가가 설정되었는지 여부 */
  has_metrics?: boolean;
  /** 최신 평가 결��� 요약 (verdict + action) */
  metrics_summary?: {
    verdict: string;
    action: string;
    overall_achievement: number;
    last_evaluated: string;
  };
  created_at: string;
  updated_at: string;
}

export interface KanbanBoard {
  tasks: Task[];
  next_id: number;
}

export interface Sprint {
  id: string;
  name: string;
  status: 'planning' | 'active' | 'completed';
  tasks: string[];
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface SprintStore {
  sprints: Sprint[];
  current_sprint: string | null;
}
