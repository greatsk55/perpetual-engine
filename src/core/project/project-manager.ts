import { existsSync } from 'node:fs';
import path from 'node:path';
import { scaffoldProject, type ScaffoldOptions } from './scaffold.js';
import { loadConfig, saveConfig, type ProjectConfig } from './config.js';
import { getProjectPaths } from '../../utils/paths.js';
import { ProjectNotFoundError } from '../../utils/errors.js';
import type { AgentConfig } from '../agent/agent-types.js';

export interface InitOptions extends ScaffoldOptions {
  /** 스캔으로 감지된 에이전트 설정 */
  scannedAgents?: AgentConfig[];
  /** 스캔으로 추출된 프로젝트 메타데이터 */
  scannedMeta?: { name: string; mission: string; techStack: string[] };
}

export class ProjectManager {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  get paths() {
    return getProjectPaths(this.projectRoot);
  }

  async init(projectName: string, options?: InitOptions): Promise<void> {
    await scaffoldProject(this.projectRoot, projectName, options);
  }

  async loadConfig(): Promise<ProjectConfig> {
    this.ensureProject();
    return loadConfig(this.paths.config);
  }

  async saveConfig(config: ProjectConfig): Promise<void> {
    this.ensureProject();
    await saveConfig(this.paths.config, config);
  }

  exists(): boolean {
    return existsSync(this.paths.infinitePower);
  }

  private ensureProject(): void {
    if (!this.exists()) {
      throw new ProjectNotFoundError(this.projectRoot);
    }
  }
}
