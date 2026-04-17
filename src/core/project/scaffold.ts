import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getProjectPaths } from '../../utils/paths.js';
import { createDefaultConfig, saveConfig } from './config.js';
import { writeYaml } from '../../utils/yaml.js';
import { getDefaultAgentConfigs } from '../agent/agent-defaults.js';
import type { AgentConfig } from '../agent/agent-types.js';

/** 에이전트 이름을 안전한 파일명으로 변환 */
function toSafeFileName(name: string): string {
  return name.toLowerCase().replace(/[/\\:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-');
}

export interface ScaffoldOptions {
  /** true이면 기존 프로젝트 파일(README.md 등)을 덮어쓰지 않음 */
  preserveExisting?: boolean;
  /** 스캔으로 감지된 에이전트 설정 (없으면 기본 에이전트 사용) */
  scannedAgents?: AgentConfig[];
  /** 스캔으로 추출된 프로젝트 메타데이터 */
  scannedMeta?: {
    name: string;
    mission: string;
    techStack: string[];
  };
}

/** 파일이 존재하지 않을 때만 작성 */
async function writeFileIfNotExists(filePath: string, content: string): Promise<void> {
  if (!existsSync(filePath)) {
    await writeFile(filePath, content, 'utf-8');
  }
}

export async function scaffoldProject(
  projectRoot: string,
  projectName: string,
  options?: ScaffoldOptions,
): Promise<void> {
  const paths = getProjectPaths(projectRoot);
  const preserve = options?.preserveExisting ?? false;

  // 디렉토리 구조 생성 (recursive: true이므로 기존 디렉토리와 충돌 없음)
  const dirs = [
    paths.infinitePower,
    paths.agents,
    paths.sessions,
    paths.state,
    paths.messages,
    paths.docs,
    paths.vision,
    paths.meetings,
    paths.decisions,
    paths.planning,
    paths.design,
    paths.designMockups,
    paths.development,
    paths.marketing,
    paths.marketingMockups,
    paths.changelog,
    paths.workspace,
    paths.metricsReports,
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  // config.yaml 생성 (스캔 메타데이터가 있으면 적용)
  const config = createDefaultConfig();
  config.company.name = projectName;
  if (options?.scannedMeta) {
    const meta = options.scannedMeta;
    if (meta.name) config.product.name = meta.name;
    if (meta.mission) config.company.mission = meta.mission;
    if (meta.techStack.length > 0) {
      config.constraints.tech_stack_preference = meta.techStack.join(', ');
    }
  }

  // 에이전트 설정: 스캔 결과가 있으면 사용, 없으면 기본값
  const agentConfigs = options?.scannedAgents ?? getDefaultAgentConfigs();
  config.agents = agentConfigs.map(a =>
    a.role === 'custom' ? toSafeFileName(a.name) : a.role,
  );
  await saveConfig(paths.config, config);

  // 에이전트 yaml 생성
  for (const agent of agentConfigs) {
    const fileName = agent.role === 'custom'
      ? toSafeFileName(agent.name)
      : agent.role;
    const agentPath = path.join(paths.agents, `${fileName}.yaml`);
    await writeYaml(agentPath, agent);
  }

  // 빈 kanban.json 초기화
  await writeFileIfNotExists(
    paths.kanban,
    JSON.stringify({ tasks: [], next_id: 1 }, null, 2),
  );

  // 빈 sprints.json 초기화
  await writeFileIfNotExists(
    paths.sprints,
    JSON.stringify({ sprints: [], current_sprint: null }, null, 2),
  );

  // 빈 metrics.json 초기화
  await writeFileIfNotExists(
    paths.metrics,
    JSON.stringify({ tasks: {} }, null, 2),
  );

  // .gitkeep 파일들 (빈 디렉토리 유지)
  const gitkeepDirs = [
    paths.sessions, paths.state, paths.messages,
    paths.meetings, paths.decisions, paths.planning,
    paths.design, paths.designMockups, paths.development,
    paths.marketing, paths.marketingMockups, paths.changelog,
    paths.workspace, paths.metricsReports,
  ];
  for (const dir of gitkeepDirs) {
    await writeFileIfNotExists(path.join(dir, '.gitkeep'), '');
  }

  // README 생성 - 기존 프로젝트면 덮어쓰지 않음
  if (preserve) {
    await writeFileIfNotExists(
      path.join(projectRoot, 'README.md'),
      `# ${projectName}\n\nPowered by [PerpetualEngine](https://github.com/perpetual-engine) - AI 에이전트 스타트업 프레임워크\n\n## 시작하기\n\n\`\`\`bash\nperpetual-engine setup   # 회사 비전 및 프로덕트 설정\nperpetual-engine start   # 에이전트 팀 가동 + 대시보드\n\`\`\`\n`,
    );
  } else {
    await writeFile(
      path.join(projectRoot, 'README.md'),
      `# ${projectName}\n\nPowered by [PerpetualEngine](https://github.com/perpetual-engine) - AI 에이전트 스타트업 프레임워크\n\n## 시작하기\n\n\`\`\`bash\nperpetual-engine setup   # 회사 비전 및 프로덕트 설정\nperpetual-engine start   # 에이전트 팀 가동 + 대시보드\n\`\`\`\n`,
      'utf-8',
    );
  }
}
