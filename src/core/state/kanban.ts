import { FileStore } from './file-store.js';
import type { KanbanBoard, Task, TaskStatus, TaskPriority, TaskType, WorkflowPhase } from './types.js';

export class KanbanManager {
  private store: FileStore<KanbanBoard>;

  constructor(kanbanPath: string) {
    this.store = new FileStore<KanbanBoard>(kanbanPath);
  }

  async addTask(params: {
    title: string;
    description: string;
    type: TaskType;
    priority: TaskPriority;
    assignee: string;
    created_by: string;
    sprint?: string;
    dependencies?: string[];
    acceptance_criteria?: string[];
    created_in_meeting?: string;
  }): Promise<Task> {
    let newTask: Task | undefined;

    await this.store.update(board => {
      const id = `TASK-${board.next_id}`;
      const now = new Date().toISOString();
      newTask = {
        id,
        title: params.title,
        description: params.description,
        type: params.type,
        status: 'backlog',
        priority: params.priority,
        sprint: params.sprint ?? null,
        assignee: params.assignee,
        sub_agents: [],
        dependencies: params.dependencies ?? [],
        created_by: params.created_by,
        created_in_meeting: params.created_in_meeting ?? null,
        acceptance_criteria: params.acceptance_criteria ?? [],
        phase: null,
        documents: {},
        created_at: now,
        updated_at: now,
      };
      return {
        tasks: [...board.tasks, newTask],
        next_id: board.next_id + 1,
      };
    });

    return newTask!;
  }

  async moveTask(taskId: string, status: TaskStatus): Promise<Task> {
    let updated: Task | undefined;

    await this.store.update(rawBoard => {
      const board = this.normalize(rawBoard);
      const tasks = board.tasks.map(t => {
        if (t.id === taskId) {
          // suspended 태스크는 resumeTask 경로로만 복원 가능. 백그라운드 워크플로우의
          // 최종 moveTask(done/todo)가 사용자가 건 중단을 덮어쓰지 않도록 보호한다.
          if (t.status === 'suspended' && status !== 'suspended') {
            updated = t;
            return t;
          }
          updated = { ...t, status, updated_at: new Date().toISOString() };
          return updated;
        }
        return t;
      });
      return { ...board, tasks };
    });

    if (!updated) throw new Error(`태스크를 찾을 수 없습니다: ${taskId}`);
    return updated;
  }

  async updateTaskPhase(taskId: string, phase: WorkflowPhase, assignee?: string): Promise<Task> {
    let updated: Task | undefined;

    await this.store.update(rawBoard => {
      const board = this.normalize(rawBoard);
      const tasks = board.tasks.map(t => {
        if (t.id === taskId) {
          updated = {
            ...t,
            phase,
            ...(assignee ? { assignee } : {}),
            updated_at: new Date().toISOString(),
          };
          return updated;
        }
        return t;
      });
      return { ...board, tasks };
    });

    if (!updated) throw new Error(`태스크를 찾을 수 없습니다: ${taskId}`);
    return updated;
  }

  /**
   * 태스크를 강제로 in_progress로 이동시킨다.
   * 의존성과 현재 상태를 무시하고 즉시 실행 대기 상태로 만든다.
   */
  async forceStart(taskId: string): Promise<Task> {
    let updated: Task | undefined;

    await this.store.update(rawBoard => {
      const board = this.normalize(rawBoard);
      const tasks = board.tasks.map(t => {
        if (t.id === taskId) {
          if (t.status === 'done') {
            throw new Error(`이미 완료된 태스크입니다: ${taskId}`);
          }
          updated = {
            ...t,
            status: 'in_progress',
            suspended_from: undefined,
            suspended_reason: undefined,
            updated_at: new Date().toISOString(),
          };
          return updated;
        }
        return t;
      });
      return { ...board, tasks };
    });

    if (!updated) throw new Error(`태스크를 찾을 수 없습니다: ${taskId}`);
    return updated;
  }

  /**
   * 태스크를 일시 중단(suspended) 상태로 전환한다.
   * 현재 상태를 suspended_from에 저장하여 나중에 복원할 수 있다.
   */
  async suspendTask(taskId: string, reason?: string): Promise<Task> {
    let updated: Task | undefined;

    await this.store.update(rawBoard => {
      const board = this.normalize(rawBoard);
      const tasks = board.tasks.map(t => {
        if (t.id === taskId) {
          if (t.status === 'done') {
            throw new Error(`이미 완료된 태스크는 중단할 수 없습니다: ${taskId}`);
          }
          if (t.status === 'suspended') {
            throw new Error(`이미 중단된 태스크입니다: ${taskId}`);
          }
          updated = {
            ...t,
            suspended_from: t.status,
            suspended_reason: reason,
            status: 'suspended' as TaskStatus,
            updated_at: new Date().toISOString(),
          };
          return updated;
        }
        return t;
      });
      return { ...board, tasks };
    });

    if (!updated) throw new Error(`태스크를 찾을 수 없습니다: ${taskId}`);
    return updated;
  }

  /**
   * 중단된 태스크를 이전 상태로 복원한다.
   */
  async resumeTask(taskId: string): Promise<Task> {
    let updated: Task | undefined;

    await this.store.update(rawBoard => {
      const board = this.normalize(rawBoard);
      const tasks = board.tasks.map(t => {
        if (t.id === taskId) {
          if (t.status !== 'suspended') {
            throw new Error(`중단 상태가 아닌 태스크입니다: ${taskId} (현재: ${t.status})`);
          }
          const restoreTo = t.suspended_from ?? 'todo';
          updated = {
            ...t,
            status: restoreTo,
            suspended_from: undefined,
            suspended_reason: undefined,
            updated_at: new Date().toISOString(),
          };
          return updated;
        }
        return t;
      });
      return { ...board, tasks };
    });

    if (!updated) throw new Error(`태스크를 찾을 수 없습니다: ${taskId}`);
    return updated;
  }

  async getTask(taskId: string): Promise<Task | null> {
    const board = await this.getBoard();
    return board.tasks.find(t => t.id === taskId) ?? null;
  }

  async getTasks(filter?: {
    status?: TaskStatus;
    assignee?: string;
    sprint?: string;
    priority?: TaskPriority;
  }): Promise<Task[]> {
    const board = await this.getBoard();
    let tasks = board.tasks;

    if (filter?.status) tasks = tasks.filter(t => t.status === filter.status);
    if (filter?.assignee) tasks = tasks.filter(t => t.assignee === filter.assignee);
    if (filter?.sprint) tasks = tasks.filter(t => t.sprint === filter.sprint);
    if (filter?.priority) tasks = tasks.filter(t => t.priority === filter.priority);

    return tasks;
  }

  async getAllTasks(): Promise<Task[]> {
    const board = await this.getBoard();
    return board.tasks;
  }

  async getBoard(): Promise<KanbanBoard> {
    const board = await this.store.read();
    return this.normalize(board);
  }

  /**
   * 에이전트가 숫자 id를 쓸 수 있으므로, 읽을 때 문자열로 정규화
   */
  private normalize(board: KanbanBoard): KanbanBoard {
    return {
      ...board,
      tasks: board.tasks.map(t => ({
        ...t,
        id: String(t.id),
        dependencies: (t.dependencies ?? []).map(d => String(d)),
        sub_agents: t.sub_agents ?? [],
        acceptance_criteria: t.acceptance_criteria ?? [],
        documents: t.documents ?? {},
        phase: t.phase ?? null,
        sprint: t.sprint ?? null,
        created_in_meeting: t.created_in_meeting ?? null,
        created_by: t.created_by ?? 'agent',
        type: t.type ?? 'feature',
        status: t.status ?? 'backlog',
        priority: t.priority ?? 'medium',
        has_metrics: t.has_metrics ?? false,
      })),
    };
  }
}
