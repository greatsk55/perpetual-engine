import { Command } from 'commander';
import { SessionManager } from '../../core/session/session-manager.js';
import { isPerpetualEngineProject } from '../../utils/paths.js';
import { logger } from '../../utils/logger.js';

export function registerLogsCommand(program: Command): void {
  program
    .command('logs <agent>')
    .description('에이전트 로그 확인')
    .option('-n, --lines <number>', '출력할 줄 수', '100')
    .action(async (agent: string, opts: { lines: string }) => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const sessionManager = new SessionManager();
      const log = await sessionManager.getAgentLog(agent, parseInt(opts.lines));

      if (!log.trim()) {
        logger.info(`${agent} 에이전트의 로그가 없습니다 (실행 중이 아닐 수 있음).`);
        return;
      }

      console.log(log);
    });
}
