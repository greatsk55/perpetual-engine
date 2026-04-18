import { Command } from 'commander';
import path from 'node:path';
import { Orchestrator } from '../../core/workflow/orchestrator.js';
import { logger } from '../../utils/logger.js';
import { isPerpetualEngineProject } from '../../utils/paths.js';

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .description('에이전트 팀 가동 + 대시보드 시작')
    .option('--no-ceo', 'CEO 자동 기동 건너뛰기 (기존 스프린트를 유지하고 워처만 가동)')
    .option('--force-ceo', '기존 스프린트가 있어도 CEO 를 강제 기동해 재계획')
    .action(async (opts: { ceo?: boolean; forceCeo?: boolean }) => {
      const projectRoot = process.cwd();

      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다. 먼저 perpetual-engine init <name> 으로 프로젝트를 생성하세요.');
        process.exit(1);
      }

      // commander 는 `--no-ceo` 를 opts.ceo === false 로, `--force-ceo` 를 opts.forceCeo === true 로 전달한다
      const autoStartCeo: 'always' | 'if-empty' | false =
        opts.ceo === false ? false : opts.forceCeo ? 'always' : 'if-empty';

      const orchestrator = new Orchestrator(projectRoot, { autoStartCeo });
      await orchestrator.start();
    });
}
