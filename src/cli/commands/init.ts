import { Command } from 'commander';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ProjectManager } from '../../core/project/project-manager.js';
import { scanExistingProject } from '../../core/project/project-scanner.js';
import { logger } from '../../utils/logger.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init [name]')
    .description('스타트업 프로젝트 생성 (이름 생략 시 현재 디렉토리에 설치)')
    .option('--skip-scan', '기존 프로젝트 스캔 건너뛰기 (기본 에이전트 사용)')
    .action(async (name?: string, opts?: { skipScan?: boolean }) => {
      const isExistingProject = !name;
      const projectRoot = name
        ? path.resolve(process.cwd(), name)
        : process.cwd();
      const projectName = name || path.basename(projectRoot);

      if (existsSync(path.join(projectRoot, '.perpetual-engine'))) {
        logger.error(`이미 PerpetualEngine 프로젝트가 존재합니다: ${projectRoot}`);
        process.exit(1);
      }

      if (isExistingProject) {
        logger.info(`기존 프로젝트에 PerpetualEngine 설치 중: ${projectRoot}`);
      } else {
        logger.info(`새 프로젝트 생성 중: ${projectName}`);
      }

      const manager = new ProjectManager(projectRoot);

      // 기존 프로젝트에 설치할 때 프로젝트 스캔
      if (isExistingProject && !opts?.skipScan) {
        const scanResult = await scanExistingProject(projectRoot);

        if (scanResult) {
          logger.success(scanResult.summary);
          console.log();

          // 감지된 에이전트 목록 표시
          for (const agent of scanResult.agents) {
            const roleLabel = agent.role === 'custom' ? '커스텀' : agent.role.toUpperCase();
            logger.dim(`  [${roleLabel}] ${agent.name} - ${agent.description}`);
          }

          // 기술 스택 표시
          const ts = scanResult.detectedTechStack;
          if (ts.languages.length > 0 || ts.frameworks.length > 0) {
            console.log();
            const stackParts: string[] = [];
            if (ts.languages.length > 0) stackParts.push(`언어: ${ts.languages.join(', ')}`);
            if (ts.frameworks.length > 0) stackParts.push(`프레임워크: ${ts.frameworks.join(', ')}`);
            if (ts.platforms.length > 0) stackParts.push(`플랫폼: ${ts.platforms.join(', ')}`);
            if (ts.backend.length > 0) stackParts.push(`백엔드: ${ts.backend.join(', ')}`);
            if (ts.databases.length > 0) stackParts.push(`DB: ${ts.databases.join(', ')}`);
            if (ts.isMonorepo) stackParts.push('모노레포');
            for (const part of stackParts) {
              logger.dim(`  ${part}`);
            }
          }

          // 프로젝트 메타 표시
          if (scanResult.projectMeta.name || scanResult.projectMeta.mission) {
            console.log();
            if (scanResult.projectMeta.name) {
              logger.dim(`  프로젝트: ${scanResult.projectMeta.name}`);
            }
            if (scanResult.projectMeta.mission) {
              logger.dim(`  미션: ${scanResult.projectMeta.mission}`);
            }
          }

          // 추천 이유 표시 (auto-detect 모드일 때)
          if (scanResult.scanMode === 'auto-detect' && scanResult.reasoning.length > 0) {
            console.log();
            logger.step('에이전트 추천 이유:');
            for (const reason of scanResult.reasoning) {
              logger.dim(`  - ${reason}`);
            }
          }

          await manager.init(projectName, {
            preserveExisting: true,
            scannedAgents: scanResult.agents,
            scannedMeta: scanResult.projectMeta,
          });
        } else {
          logger.info('프로젝트 분석 실패 — 기본 에이전트를 사용합니다.');
          await manager.init(projectName, { preserveExisting: true });
        }
      } else {
        await manager.init(projectName, { preserveExisting: isExistingProject });
      }

      console.log();
      logger.success(`PerpetualEngine가 설정되었습니다: ${projectRoot}`);
      logger.step(`다음 단계:`);
      if (!isExistingProject) {
        logger.dim(`  cd ${name}`);
      }
      logger.dim(`  perpetual-engine setup    # 회사 비전 및 프로덕트 설정`);
      logger.dim(`  perpetual-engine start    # 에이전트 팀 가동`);
    });
}
