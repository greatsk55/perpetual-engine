import { Command } from 'commander';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { getProjectPaths, isPerpetualEngineProject } from '../../utils/paths.js';
import { logger } from '../../utils/logger.js';

export function registerMessageCommand(program: Command): void {
  program
    .command('message <msg>')
    .description('팀에게 메시지 전달 (사용자 directive 는 우선순위로 처리됨)')
    .option('-t, --to <role>', '대상 역할 (예: ceo, cto, all)', 'all')
    .option('--normal', '진행 중인 워크플로우를 인터럽트하지 않고 일반 우선순위로 처리')
    .action(async (msg: string, opts: { to: string; normal?: boolean }) => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const paths = getProjectPaths(projectRoot);
      await mkdir(paths.messages, { recursive: true });

      // 사용자가 CLI 로 보낸 메시지는 기본적으로 urgent — 진행 중인 동일 역할 워크플로우를
      // 인터럽트하고 즉시 처리한다. 백그라운드 자동화 메시지로 보내려면 --normal 옵션 사용.
      const priority: 'urgent' | 'normal' = opts.normal ? 'normal' : 'urgent';

      const message = {
        id: nanoid(),
        from: 'investor',
        to: opts.to,
        type: 'directive',
        content: msg,
        read: false,
        created_at: new Date().toISOString(),
        priority,
      };

      const filePath = path.join(paths.messages, `investor-${Date.now()}.json`);
      await writeFile(filePath, JSON.stringify(message, null, 2), 'utf-8');

      const tag = priority === 'urgent' ? ' [urgent]' : '';
      logger.success(`메시지가 전달되었습니다${tag}: "${msg}" → ${opts.to}`);
    });
}
