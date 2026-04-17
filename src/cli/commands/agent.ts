import { Command } from 'commander';
import chalk from 'chalk';
import { AgentRegistry } from '../../core/agent/agent-registry.js';
import { SessionManager } from '../../core/session/session-manager.js';
import { getProjectPaths, isPerpetualEngineProject } from '../../utils/paths.js';
import { logger } from '../../utils/logger.js';

export function registerAgentCommand(program: Command): void {
  program
    .command('agent <name>')
    .description('특정 에이전트 상세 정보')
    .action(async (name: string) => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const paths = getProjectPaths(projectRoot);
      const registry = new AgentRegistry(paths.agents);
      await registry.load();

      const agent = registry.get(name);
      if (!agent) {
        logger.error(`에이전트를 찾을 수 없습니다: ${name}`);
        logger.dim(`사용 가능: ${registry.getRoles().join(', ')}`);
        process.exit(1);
      }

      const sessionManager = new SessionManager();
      const isRunning = await sessionManager.isAgentRunning(name);

      console.log(chalk.bold(`\n  ${agent.name} (${agent.role})`));
      console.log(`  ${agent.description}`);
      console.log(`  상태: ${isRunning ? chalk.green('실행 중') : chalk.dim('대기')}`);
      console.log(`  보고 대상: ${agent.reports_to}`);
      console.log(`  협업: ${agent.collaborates_with.join(', ')}`);

      console.log(chalk.bold('\n  담당 업무:'));
      for (const r of agent.responsibilities) {
        console.log(`    - ${r}`);
      }

      console.log(chalk.bold('\n  규칙:'));
      for (const r of agent.rules) {
        console.log(`    - ${r}`);
      }

      if (agent.required_mcp_tools?.length) {
        console.log(chalk.bold('\n  필수 MCP 도구:'));
        for (const t of agent.required_mcp_tools) {
          console.log(`    - ${t}`);
        }
      }

      console.log('');
    });
}
