import { Command } from 'commander';
import { SessionManager } from '../../core/session/session-manager.js';
import { AgentRegistry } from '../../core/agent/agent-registry.js';
import { getProjectPaths, isPerpetualEngineProject } from '../../utils/paths.js';
import { logger } from '../../utils/logger.js';

export function registerPauseCommand(program: Command): void {
  program
    .command('pause')
    .description('모든 에이전트 일시 정지')
    .action(async () => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const paths = getProjectPaths(projectRoot);
      const registry = new AgentRegistry(paths.agents);
      await registry.load();

      const sessionManager = new SessionManager();
      for (const role of registry.getRoles()) {
        try {
          await sessionManager.pauseAgent(role);
          logger.step(`${role} 일시 정지됨`);
        } catch {
          // 실행 중이 아닌 에이전트 무시
        }
      }

      logger.success('모든 에이전트가 일시 정지되었습니다.');
    });
}
