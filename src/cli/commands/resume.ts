import { Command } from 'commander';
import { logger } from '../../utils/logger.js';
import { isPerpetualEngineProject } from '../../utils/paths.js';

export function registerResumeCommand(program: Command): void {
  program
    .command('resume')
    .description('에이전트 재개')
    .action(async () => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      logger.info('에이전트를 재시작하려면 perpetual-engine start를 사용하세요.');
      logger.dim('pause된 에이전트는 자동으로 재개되지 않습니다.');
    });
}
