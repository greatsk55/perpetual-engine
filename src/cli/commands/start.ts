import { Command } from 'commander';
import path from 'node:path';
import { Orchestrator } from '../../core/workflow/orchestrator.js';
import { logger } from '../../utils/logger.js';
import { isPerpetualEngineProject } from '../../utils/paths.js';

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('에이전트 팀 가동 + 대시보드 시작')
    .action(async () => {
      const projectRoot = process.cwd();

      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다. 먼저 perpetual-engine init <name> 으로 프로젝트를 생성하세요.');
        process.exit(1);
      }

      const orchestrator = new Orchestrator(projectRoot);
      await orchestrator.start();
    });
}
