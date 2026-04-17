import { Command } from 'commander';
import { KanbanManager } from '../../core/state/kanban.js';
import { getProjectPaths, isPerpetualEngineProject } from '../../utils/paths.js';
import { logger } from '../../utils/logger.js';

export function registerTaskCommand(program: Command): void {
  const task = program
    .command('task')
    .description('태스크 직접 제어 (강제 실행, 중단, 재개)');

  // perpetual-engine task run <id>
  task
    .command('run <id>')
    .description('태스크를 강제로 실행 (의존성/상태 무시)')
    .action(async (id: string) => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const paths = getProjectPaths(projectRoot);
      const kanban = new KanbanManager(paths.kanban);

      try {
        const task = await kanban.forceStart(id);
        logger.success(`[${id}] 강제 실행 → in_progress: ${task.title}`);
        logger.dim('실행 중인 오케스트레이터가 있으면 자동으로 워크플로우가 시작됩니다.');
        logger.dim('오케스트레이터가 없으면 perpetual-engine start로 시작하세요.');
      } catch (err) {
        logger.error((err as Error).message);
        process.exit(1);
      }
    });

  // perpetual-engine task suspend <id> [reason]
  task
    .command('suspend <id>')
    .description('태스크를 일시 중단')
    .option('-r, --reason <reason>', '중단 사유')
    .action(async (id: string, opts: { reason?: string }) => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const paths = getProjectPaths(projectRoot);
      const kanban = new KanbanManager(paths.kanban);

      try {
        const task = await kanban.suspendTask(id, opts.reason);
        logger.success(`[${id}] 일시 중단: ${task.title}`);
        if (opts.reason) logger.dim(`사유: ${opts.reason}`);
        logger.dim('실행 중인 에이전트 세션은 수동으로 종료해야 할 수 있습니다.');
        logger.dim('재개하려면: perpetual-engine task resume ' + id);
      } catch (err) {
        logger.error((err as Error).message);
        process.exit(1);
      }
    });

  // perpetual-engine task resume <id>
  task
    .command('resume <id>')
    .description('중단된 태스크를 재개 (이전 상태로 복원)')
    .action(async (id: string) => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const paths = getProjectPaths(projectRoot);
      const kanban = new KanbanManager(paths.kanban);

      try {
        const task = await kanban.resumeTask(id);
        logger.success(`[${id}] 재개 → ${task.status}: ${task.title}`);
      } catch (err) {
        logger.error((err as Error).message);
        process.exit(1);
      }
    });

  // perpetual-engine task list [--status <status>]
  task
    .command('list')
    .description('태스크 목록 조회')
    .option('-s, --status <status>', '상태로 필터 (backlog, todo, in_progress, suspended, done 등)')
    .action(async (opts: { status?: string }) => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const paths = getProjectPaths(projectRoot);
      const kanban = new KanbanManager(paths.kanban);

      const tasks = opts.status
        ? await kanban.getTasks({ status: opts.status as any })
        : await kanban.getAllTasks();

      if (tasks.length === 0) {
        logger.info('태스크가 없습니다.');
        return;
      }

      for (const t of tasks) {
        const suspendedInfo = t.status === 'suspended' && t.suspended_reason
          ? ` (사유: ${t.suspended_reason})`
          : '';
        logger.info(`${t.id} [${t.status}] ${t.title} (${t.assignee}, ${t.priority})${suspendedInfo}`);
      }
    });
}
