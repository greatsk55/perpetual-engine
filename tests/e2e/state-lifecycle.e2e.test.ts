import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectManager } from '../../src/core/project/project-manager.js';
import { KanbanManager } from '../../src/core/state/kanban.js';
import { SprintManager } from '../../src/core/state/sprint.js';
import { MetricsManager } from '../../src/core/metrics/metrics-store.js';
import { MetricsEvaluator } from '../../src/core/metrics/metrics-evaluator.js';
import { getProjectPaths } from '../../src/utils/paths.js';
import { TestProject } from './helpers/test-project.js';

/**
 * 상태 생명주기 E2E — 스캐폴딩 직후의 프로젝트에서
 * Kanban → Sprint → Metrics 가 파일 기반으로 올바르게 상호작용하는지 검증.
 */
describe('E2E — 상태 생명주기 (Kanban + Sprint + Metrics)', () => {
  let project: TestProject;
  let kanban: KanbanManager;
  let sprints: SprintManager;
  let metrics: MetricsManager;

  beforeEach(async () => {
    project = await TestProject.create('ip-e2e-state');
    await new ProjectManager(project.root).init('state-test');

    const paths = getProjectPaths(project.root);
    kanban = new KanbanManager(paths.kanban);
    sprints = new SprintManager(paths.sprints);
    metrics = new MetricsManager(paths.metrics);
  });

  afterEach(async () => {
    await project.cleanup();
  });

  it('태스크 생성 → 스프린트 편입 → 상태 전환이 파일에 영속된다', async () => {
    const task = await kanban.addTask({
      title: '랜딩페이지 첫 섹션',
      description: '히어로 + CTA',
      type: 'feature',
      priority: 'high',
      assignee: 'designer',
      created_by: 'po',
      acceptance_criteria: ['히어로 카피', 'CTA 버튼', '모바일 반응형'],
    });

    expect(task.id).toBe('TASK-1');
    expect(task.status).toBe('backlog');

    const sprint = await sprints.createSprint('Sprint 1');
    await sprints.addTaskToSprint(sprint.id, task.id);
    await sprints.startSprint(sprint.id);

    await kanban.moveTask(task.id, 'in_progress');

    // 새 매니저로 읽어도 동일해야 한다 (파일 영속성 검증)
    const paths = getProjectPaths(project.root);
    const fresh = new KanbanManager(paths.kanban);
    const reloaded = await fresh.getAllTasks();

    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].status).toBe('in_progress');

    const currentSprint = await new SprintManager(paths.sprints).getCurrentSprint();
    expect(currentSprint?.id).toBe(sprint.id);
    expect(currentSprint?.tasks).toContain(task.id);
  });

  it('suspend / resume 시 세션 종료 없이도 상태가 올바르게 복원된다', async () => {
    const task = await kanban.addTask({
      title: '결제 API 연동',
      description: '',
      type: 'feature',
      priority: 'high',
      assignee: 'cto',
      created_by: 'po',
    });

    await kanban.moveTask(task.id, 'in_progress');
    const suspended = await kanban.suspendTask(task.id, '요구사항 재검토 필요');
    expect(suspended.status).toBe('suspended');

    const resumed = await kanban.resumeTask(task.id);
    expect(resumed.status).toBe('in_progress');
  });

  it('메트릭스 계획 → 체크포인트 평가 → 최종 평가까지 이력이 쌓인다', async () => {
    const task = await kanban.addTask({
      title: '온보딩 개선 실험',
      description: '',
      type: 'feature',
      priority: 'high',
      assignee: 'po',
      created_by: 'ceo',
    });

    await metrics.setPlan(task.id, {
      hypothesis: '온보딩 개선 시 7일 리텐션이 20% 상승할 것',
      metrics: [
        { name: 'DAU', unit: '명', baseline: 100, target: 500, direction: 'higher' },
      ],
      measurement_start: '2026-04-17',
      measurement_end: '2026-05-17',
      checkpoints: ['2026-04-24', '2026-05-01', '2026-05-08'],
    });

    const evaluator = new MetricsEvaluator();

    // baseline=100, target=500 이므로 actual=340 이면 (240/400)*100 = 60% → improving
    const checkpoint = evaluator.evaluate({
      taskId: task.id,
      plan: (await metrics.getTaskMetrics(task.id))!.plan,
      actuals: [{ name: 'DAU', actual: 340 }],
      type: 'checkpoint',
    });
    await metrics.addEvaluation(task.id, checkpoint);

    expect(checkpoint.verdict).toBe('improving');
    expect(checkpoint.action).toBe('iterate');

    const finalEval = evaluator.evaluate({
      taskId: task.id,
      plan: (await metrics.getTaskMetrics(task.id))!.plan,
      actuals: [{ name: 'DAU', actual: 520 }],
      type: 'final',
    });
    await metrics.addEvaluation(task.id, finalEval);

    expect(finalEval.verdict).toBe('achieved');
    expect(finalEval.action).toBe('maintain');

    const stored = await metrics.getTaskMetrics(task.id);
    expect(stored?.evaluations).toHaveLength(2);
  });

  it('달성률 구간별 판정 매트릭스 (scale_up → maintain → iterate → pivot → kill)', async () => {
    const evaluator = new MetricsEvaluator();
    const plan = {
      hypothesis: 'test',
      metrics: [{ name: 'x', unit: '', baseline: 0, target: 100, direction: 'higher' as const }],
      measurement_start: '2026-01-01',
      measurement_end: '2026-02-01',
      checkpoints: [],
    };

    const scenarios: Array<[number, string, string]> = [
      [130, 'exceeded', 'scale_up'],
      [100, 'achieved', 'maintain'],
      [70, 'improving', 'iterate'],
      [40, 'stagnant', 'pivot'],
      [10, 'failed', 'kill'],
    ];

    for (const [actual, expectedVerdict, expectedAction] of scenarios) {
      const e = evaluator.evaluate({
        taskId: 'test',
        plan,
        actuals: [{ name: 'x', actual }],
        type: 'final',
      });
      expect(e.verdict, `actual=${actual}`).toBe(expectedVerdict);
      expect(e.action, `actual=${actual}`).toBe(expectedAction);
    }
  });

  it('우선순위·담당자 기준 필터링이 동작한다', async () => {
    await kanban.addTask({ title: 'A', description: '', type: 'feature', priority: 'high', assignee: 'cto', created_by: 'po' });
    await kanban.addTask({ title: 'B', description: '', type: 'bug', priority: 'low', assignee: 'qa', created_by: 'po' });
    await kanban.addTask({ title: 'C', description: '', type: 'feature', priority: 'high', assignee: 'cto', created_by: 'po' });

    const cto = await kanban.getTasks({ assignee: 'cto' });
    expect(cto).toHaveLength(2);

    const highs = await kanban.getTasks({ priority: 'high' });
    expect(highs).toHaveLength(2);
  });
});
