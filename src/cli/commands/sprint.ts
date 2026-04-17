import { Command } from 'commander';
import chalk from 'chalk';
import { SprintManager } from '../../core/state/sprint.js';
import { KanbanManager } from '../../core/state/kanban.js';
import { getProjectPaths, isPerpetualEngineProject } from '../../utils/paths.js';
import { logger } from '../../utils/logger.js';

export function registerSprintCommand(program: Command): void {
  program
    .command('sprint')
    .description('현재 스프린트 정보')
    .action(async () => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const paths = getProjectPaths(projectRoot);
      const sprintManager = new SprintManager(paths.sprints);
      const kanban = new KanbanManager(paths.kanban);

      const current = await sprintManager.getCurrentSprint();
      if (!current) {
        logger.info('현재 활성 스프린트가 없습니다.');
        return;
      }

      console.log(chalk.bold(`\n  ${current.name}`));
      console.log(`  상태: ${current.status}`);
      console.log(`  시작: ${current.started_at ?? '미시작'}`);
      console.log(`  태스크: ${current.tasks.length}개\n`);

      for (const taskId of current.tasks) {
        const task = await kanban.getTask(taskId);
        if (task) {
          console.log(`    [${task.status}] ${task.id}: ${task.title} (${task.assignee})`);
        }
      }
      console.log('');
    });
}
