import { Command } from 'commander';
import chalk from 'chalk';
import { KanbanManager } from '../../core/state/kanban.js';
import { SprintManager } from '../../core/state/sprint.js';
import { SessionManager } from '../../core/session/session-manager.js';
import { getProjectPaths, isPerpetualEngineProject } from '../../utils/paths.js';
import { loadConfig } from '../../core/project/config.js';
import { logger } from '../../utils/logger.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('현재 상태 요약')
    .action(async () => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const paths = getProjectPaths(projectRoot);
      const config = await loadConfig(paths.config);
      const kanban = new KanbanManager(paths.kanban);
      const sprintManager = new SprintManager(paths.sprints);
      const sessionManager = new SessionManager();

      // 회사 정보
      console.log(chalk.bold(`\n  ${config.company.name}`));
      console.log(chalk.dim(`  ${config.company.mission}\n`));

      // 스프린트 현황
      const currentSprint = await sprintManager.getCurrentSprint();
      if (currentSprint) {
        console.log(chalk.cyan(`  Sprint: ${currentSprint.name} (${currentSprint.status})`));
      } else {
        console.log(chalk.dim('  Sprint: 없음'));
      }

      // 태스크 현황
      const tasks = await kanban.getAllTasks();
      const byStatus: Record<string, number> = {};
      for (const t of tasks) {
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      }
      const done = byStatus['done'] || 0;
      console.log(`  Tasks: ${done}/${tasks.length} 완료`);

      // 상태별 요약
      const statusOrder = ['backlog', 'todo', 'in_progress', 'review', 'testing', 'done'];
      const statusLabels: Record<string, string> = {
        backlog: 'Backlog',
        todo: 'To Do',
        in_progress: 'In Progress',
        review: 'Review',
        testing: 'Testing',
        done: 'Done',
      };
      console.log('');
      for (const status of statusOrder) {
        const count = byStatus[status] || 0;
        if (count > 0) {
          console.log(`    ${statusLabels[status]}: ${count}`);
        }
      }

      // 에이전트 상태
      const running = await sessionManager.getRunningAgents();
      console.log(`\n  Active Agents: ${running.length}`);
      for (const agent of running) {
        console.log(`    ${agent.role} - ${agent.status} ${agent.currentTask ? `(${agent.currentTask})` : ''}`);
      }

      console.log('');
    });
}
