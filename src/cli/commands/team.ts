import { Command } from 'commander';
import { AgentRegistry } from '../../core/agent/agent-registry.js';
import { getProjectPaths } from '../../utils/paths.js';
import { logger } from '../../utils/logger.js';

export function registerTeamCommand(program: Command): void {
  program
    .command('team')
    .description('에이전트 팀 목록 확인')
    .action(async () => {
      const projectRoot = process.cwd();
      const paths = getProjectPaths(projectRoot);
      const registry = new AgentRegistry(paths.agents);

      try {
        await registry.load();
      } catch {
        logger.error('PerpetualEngine 프로젝트가 아닙니다. 먼저 프로젝트를 초기화하세요.');
        process.exit(1);
      }

      const agents = registry.getAll();
      logger.info(`에이전트 팀 (${agents.length}명)\n`);

      for (const agent of agents) {
        console.log(`  ${agent.name} (${agent.role})`);
        console.log(`    ${agent.description}`);
        console.log(`    보고 대상: ${agent.reports_to}`);
        console.log(`    협업: ${agent.collaborates_with.join(', ')}`);
        console.log('');
      }
    });
}
