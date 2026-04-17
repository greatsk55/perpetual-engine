import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectManager } from '../../core/project/project-manager.js';
import { runSetupPrompts } from '../utils/prompts.js';
import { logger } from '../../utils/logger.js';
import { getProjectPaths } from '../../utils/paths.js';

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('대화형 초기 설정 (회사 비전 및 프로덕트 설정)')
    .action(async () => {
      const projectRoot = process.cwd();
      const manager = new ProjectManager(projectRoot);

      if (!manager.exists()) {
        logger.error('PerpetualEngine 프로젝트가 아닙니다. 먼저 perpetual-engine init <name> 으로 프로젝트를 생성하세요.');
        process.exit(1);
      }

      logger.info('회사 및 프로덕트 설정을 시작합니다...\n');

      const answers = await runSetupPrompts();
      const config = await manager.loadConfig();

      // config 업데이트
      config.localization.language = answers.language;
      config.localization.language_name = answers.languageName;
      config.company.name = answers.companyName;
      config.company.mission = answers.companyMission;
      config.product.name = answers.productName;
      config.product.description = answers.productDescription;
      config.product.target_users = answers.targetUsers;
      config.product.core_value = answers.coreValue;
      config.constraints.tech_stack_preference = answers.techStackPreference;
      config.constraints.deploy_target = answers.deployTarget;

      await manager.saveConfig(config);

      // vision 문서 생성
      const paths = getProjectPaths(projectRoot);

      await writeFile(
        path.join(paths.vision, 'company-goal.md'),
        `# ${answers.companyName} - 회사 목표\n\n## 미션\n${answers.companyMission}\n\n## 핵심 가치\n${answers.coreValue}\n\n---\n*이 문서는 모든 에이전트의 의사결정 기준이 됩니다.*\n`,
        'utf-8',
      );

      await writeFile(
        path.join(paths.vision, 'product-vision.md'),
        `# ${answers.productName} - 프로덕트 비전\n\n## 개요\n${answers.productDescription}\n\n## 타겟 사용자\n${answers.targetUsers}\n\n## 핵심 가치\n${answers.coreValue}\n\n## 기술 스택\n- 선호: ${answers.techStackPreference}\n- 배포: ${answers.deployTarget}\n\n---\n*이 문서는 PO와 CTO의 기획/개발 기준이 됩니다.*\n`,
        'utf-8',
      );

      logger.success('설정이 완료되었습니다!');
      logger.step('다음 단계:');
      logger.dim('  perpetual-engine start    # 에이전트 팀 가동 + 대시보드');
    });
}
