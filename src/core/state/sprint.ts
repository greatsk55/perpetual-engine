import { FileStore } from './file-store.js';
import type { Sprint, SprintStore } from './types.js';

export class SprintManager {
  private store: FileStore<SprintStore>;

  constructor(sprintsPath: string) {
    this.store = new FileStore<SprintStore>(sprintsPath);
  }

  async createSprint(name: string): Promise<Sprint> {
    let newSprint: Sprint | undefined;

    await this.store.update(store => {
      const id = `sprint-${store.sprints.length + 1}`;
      newSprint = {
        id,
        name,
        status: 'planning',
        tasks: [],
        started_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
      };
      return {
        sprints: [...store.sprints, newSprint],
        current_sprint: store.current_sprint,
      };
    });

    return newSprint!;
  }

  async startSprint(sprintId: string): Promise<Sprint> {
    let updated: Sprint | undefined;

    await this.store.update(store => {
      const sprints = store.sprints.map(s => {
        if (s.id === sprintId) {
          updated = { ...s, status: 'active' as const, started_at: new Date().toISOString() };
          return updated;
        }
        return s;
      });
      return { sprints, current_sprint: sprintId };
    });

    if (!updated) throw new Error(`스프린트를 찾을 수 없습니다: ${sprintId}`);
    return updated;
  }

  async completeSprint(sprintId: string): Promise<Sprint> {
    let updated: Sprint | undefined;

    await this.store.update(store => {
      const sprints = store.sprints.map(s => {
        if (s.id === sprintId) {
          updated = { ...s, status: 'completed' as const, completed_at: new Date().toISOString() };
          return updated;
        }
        return s;
      });
      const current = store.current_sprint === sprintId ? null : store.current_sprint;
      return { sprints, current_sprint: current };
    });

    if (!updated) throw new Error(`스프린트를 찾을 수 없습니다: ${sprintId}`);
    return updated;
  }

  async addTaskToSprint(sprintId: string, taskId: string): Promise<void> {
    await this.store.update(store => {
      const sprints = store.sprints.map(s => {
        if (s.id === sprintId && !s.tasks.includes(taskId)) {
          return { ...s, tasks: [...s.tasks, taskId] };
        }
        return s;
      });
      return { ...store, sprints };
    });
  }

  async getCurrentSprint(): Promise<Sprint | null> {
    const store = await this.store.read();
    if (!store.current_sprint) return null;
    return store.sprints.find(s => s.id === store.current_sprint) ?? null;
  }

  async getAllSprints(): Promise<Sprint[]> {
    const store = await this.store.read();
    return store.sprints;
  }

  async getSprintStore(): Promise<SprintStore> {
    return this.store.read();
  }
}
