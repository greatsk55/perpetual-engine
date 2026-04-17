import { Command } from 'commander';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { getProjectPaths, isPerpetualEngineProject } from '../../utils/paths.js';
import { logger } from '../../utils/logger.js';

export function registerMessageCommand(program: Command): void {
  program
    .command('message <msg>')
    .description('팀에게 메시지 전달')
    .action(async (msg: string) => {
      const projectRoot = process.cwd();
      if (!isPerpetualEngineProject(projectRoot)) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다.');
        process.exit(1);
      }

      const paths = getProjectPaths(projectRoot);
      await mkdir(paths.messages, { recursive: true });

      const message = {
        id: nanoid(),
        from: 'investor',
        to: 'all',
        type: 'directive',
        content: msg,
        read: false,
        created_at: new Date().toISOString(),
      };

      const filePath = path.join(paths.messages, `investor-${Date.now()}.json`);
      await writeFile(filePath, JSON.stringify(message, null, 2), 'utf-8');

      logger.success(`메시지가 전달되었습니다: "${msg}"`);
    });
}
