import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { KanbanManager } from '../../../src/core/state/kanban.js';

describe('KanbanManager', () => {
  let tmpDir: string;
  let kanbanPath: string;
  let kanban: KanbanManager;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ip-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    kanbanPath = path.join(tmpDir, 'kanban.json');
    await writeFile(kanbanPath, JSON.stringify({ tasks: [], next_id: 1 }));
    kanban = new KanbanManager(kanbanPath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('태스크를 추가할 수 있다', async () => {
    const task = await kanban.addTask({
      title: '로그인 기능 구현',
      description: '이메일/비밀번호 기반 로그인',
      type: 'feature',
      priority: 'high',
      assignee: 'cto',
      created_by: 'po',
    });

    expect(task.id).toBe('TASK-1');
    expect(task.title).toBe('로그인 기능 구현');
    expect(task.status).toBe('backlog');
  });

  it('태스크 상태를 변경할 수 있다', async () => {
    await kanban.addTask({
      title: '태스크 1',
      description: '설명',
      type: 'feature',
      priority: 'medium',
      assignee: 'cto',
      created_by: 'po',
    });

    const moved = await kanban.moveTask('TASK-1', 'in_progress');
    expect(moved.status).toBe('in_progress');
  });

  it('태스크를 필터링 할 수 있다', async () => {
    await kanban.addTask({
      title: '태스크 1',
      description: '',
      type: 'feature',
      priority: 'high',
      assignee: 'cto',
      created_by: 'po',
    });
    await kanban.addTask({
      title: '태스크 2',
      description: '',
      type: 'bug',
      priority: 'low',
      assignee: 'qa',
      created_by: 'po',
    });

    const ctoTasks = await kanban.getTasks({ assignee: 'cto' });
    expect(ctoTasks).toHaveLength(1);
    expect(ctoTasks[0].title).toBe('태스크 1');
  });

  it('next_id가 자동 증가한다', async () => {
    await kanban.addTask({
      title: '첫 번째',
      description: '',
      type: 'feature',
      priority: 'medium',
      assignee: 'cto',
      created_by: 'po',
    });
    const second = await kanban.addTask({
      title: '두 번째',
      description: '',
      type: 'feature',
      priority: 'medium',
      assignee: 'po',
      created_by: 'ceo',
    });

    expect(second.id).toBe('TASK-2');
  });
});
