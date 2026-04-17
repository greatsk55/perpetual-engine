import { Command } from 'commander';
import { SessionManager } from '../../core/session/session-manager.js';
import { logger } from '../../utils/logger.js';
import { isPerpetualEngineProject } from '../../utils/paths.js';

export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('모든 에이전트 종료')
    .action(async () => {
      const projectRoot = process.cwd();

      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const sessionManager = new SessionManager();
      await sessionManager.stopAll();
      logger.success('모든 에이전트가 종료되었습니다.');
    });
}
