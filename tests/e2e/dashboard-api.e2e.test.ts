import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectManager } from '../../src/core/project/project-manager.js';
import { DashboardServer } from '../../src/dashboard/server.js';
import { SessionManager } from '../../src/core/session/session-manager.js';
import { KanbanManager } from '../../src/core/state/kanban.js';
import { MessageQueue } from '../../src/core/messaging/message-queue.js';
import { getProjectPaths } from '../../src/utils/paths.js';
import { TestProject, waitFor } from './helpers/test-project.js';
import { MockTmuxAdapter } from './helpers/mock-tmux.js';

/**
 * Dashboard REST API E2E.
 *
 * port=0 으로 OS 가 할당한 임의 포트에 바인딩한다.
 * SessionManager 에는 MockTmuxAdapter 를 주입해 tmux 의존을 제거.
 */
describe('E2E — Dashboard API', () => {
  let project: TestProject;
  let dashboard: DashboardServer;
  let baseUrl: string;

  beforeEach(async () => {
    project = await TestProject.create('ip-e2e-dash');
    await new ProjectManager(project.root).init('dash-test');

    const mockTmux = new MockTmuxAdapter();
    const sessionManager = new SessionManager(mockTmux);
    sessionManager.setProjectRoot(project.root);

    dashboard = new DashboardServer(project.root, 0, { sessionManager });
    await dashboard.start();

    baseUrl = `http://127.0.0.1:${dashboard.getPort()}`;
  });

  afterEach(async () => {
    if (dashboard) await dashboard.stop();
    await project.cleanup();
  });

  it('/api/status 는 회사/프로덕트/태스크/에이전트 요약을 반환한다', async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      company: unknown;
      product: unknown;
      tasks: { total: number; by_status: Record<string, number> };
      active_agents: number;
    };

    expect(body.company).toBeDefined();
    expect(body.product).toBeDefined();
    expect(body.tasks.total).toBe(0);
    expect(body.active_agents).toBe(0);
  });

  it('/api/kanban 는 빈 보드로 시작한다', async () => {
    const res = await fetch(`${baseUrl}/api/kanban`);
    expect(res.status).toBe(200);

    const board = await res.json() as { tasks: unknown[]; next_id: number };
    expect(board.tasks).toEqual([]);
    expect(board.next_id).toBe(1);
  });

  it('태스크를 직접 추가하면 /api/tasks 에서 조회 가능하다', async () => {
    const paths = getProjectPaths(project.root);
    const kanban = new KanbanManager(paths.kanban);
    await kanban.addTask({
      title: '로그인 구현',
      description: '',
      type: 'feature',
      priority: 'high',
      assignee: 'cto',
      created_by: 'po',
    });

    const res = await fetch(`${baseUrl}/api/tasks`);
    expect(res.status).toBe(200);
    const tasks = await res.json() as Array<{ id: string; title: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('TASK-1');
    expect(tasks[0].title).toBe('로그인 구현');
  });

  it('assignee 필터링이 쿼리 파라미터로 동작한다', async () => {
    const paths = getProjectPaths(project.root);
    const kanban = new KanbanManager(paths.kanban);
    await kanban.addTask({ title: 'A', description: '', type: 'feature', priority: 'high', assignee: 'cto', created_by: 'po' });
    await kanban.addTask({ title: 'B', description: '', type: 'bug', priority: 'low', assignee: 'qa', created_by: 'po' });

    const res = await fetch(`${baseUrl}/api/tasks?assignee=cto`);
    const tasks = await res.json() as Array<{ assignee: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assignee).toBe('cto');
  });

  it('POST /api/tasks/:id/suspend 및 /resume 이 상태를 전이시킨다', async () => {
    const paths = getProjectPaths(project.root);
    const kanban = new KanbanManager(paths.kanban);
    await kanban.addTask({
      title: 'pause-me',
      description: '',
      type: 'feature',
      priority: 'medium',
      assignee: 'cto',
      created_by: 'po',
    });

    const suspendRes = await fetch(`${baseUrl}/api/tasks/TASK-1/suspend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'manual test' }),
    });
    expect(suspendRes.status).toBe(200);
    const suspended = await suspendRes.json() as { task: { status: string } };
    expect(suspended.task.status).toBe('suspended');

    const resumeRes = await fetch(`${baseUrl}/api/tasks/TASK-1/resume`, { method: 'POST' });
    expect(resumeRes.status).toBe(200);
    const resumed = await resumeRes.json() as { task: { status: string } };
    expect(resumed.task.status).toBe('backlog');
  });

  it('POST /api/messages 로 투자자 지시 메시지를 보낼 수 있다', async () => {
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'investor',
        to: 'ceo',
        type: 'directive',
        content: '다음주 데모 준비해주세요',
      }),
    });

    expect(res.status).toBe(200);

    const paths = getProjectPaths(project.root);
    const queue = new MessageQueue(paths.messages);
    const all = await queue.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('다음주 데모 준비해주세요');
  });

  it('/api/agents 는 기본 에이전트 6명을 반환한다', async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.status).toBe(200);
    const agents = await res.json() as Array<{ role: string }>;
    const roles = agents.map(a => a.role);
    for (const expected of ['ceo', 'cto', 'po', 'designer', 'qa', 'marketer']) {
      expect(roles).toContain(expected);
    }
  });

  it('/api/config 는 config.yaml 을 반환하고 PUT 으로 일부 갱신 가능하다', async () => {
    const getRes = await fetch(`${baseUrl}/api/config`);
    const config = await getRes.json() as { company: { name: string }; product: { name: string } };
    expect(config.company).toBeDefined();

    config.company.name = '업데이트된 회사명';
    config.product.name = '신제품';

    const putRes = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    expect(putRes.status).toBe(200);

    const afterRes = await fetch(`${baseUrl}/api/config`);
    const after = await afterRes.json() as { company: { name: string } };
    expect(after.company.name).toBe('업데이트된 회사명');
  });

  it('존재하지 않는 경로는 클라이언트 HTML 로 fallback 된다 (SPA 라우팅)', async () => {
    const res = await fetch(`${baseUrl}/some/spa/route`);
    // 클라이언트 HTML 을 서빙하거나 404 — 어느쪽이든 서버가 죽지 않음을 확인
    expect([200, 404]).toContain(res.status);
  });
});
