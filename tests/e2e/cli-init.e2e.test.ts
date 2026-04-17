import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { ProjectManager } from '../../src/core/project/project-manager.js';
import { getProjectPaths, isPerpetualEngineProject } from '../../src/utils/paths.js';
import { loadConfig } from '../../src/core/project/config.js';
import { readYaml } from '../../src/utils/yaml.js';
import { TestProject } from './helpers/test-project.js';

/**
 * CLI `init` 파이프라인 E2E 테스트.
 *
 * CLI 핸들러는 Commander 에 묶여 있으므로, 여기서는 핸들러가 호출하는
 * `ProjectManager.init()` 을 직접 호출해 스캐폴딩 결과를 검증한다.
 * (CLI argv 파싱 검증은 별도 단위 테스트 몫)
 */
describe('E2E — init 파이프라인', () => {
  let project: TestProject;

  beforeEach(async () => {
    project = await TestProject.create('ip-e2e-init');
  });

  afterEach(async () => {
    await project.cleanup();
  });

  it('새 프로젝트를 초기화하면 표준 디렉토리·파일을 모두 만든다', async () => {
    const manager = new ProjectManager(project.root);
    await manager.init('My Startup');

    const paths = getProjectPaths(project.root);

    for (const dir of [
      paths.infinitePower,
      paths.agents,
      paths.sessions,
      paths.messages,
      paths.vision,
      paths.meetings,
      paths.decisions,
      paths.planning,
      paths.design,
      paths.development,
      paths.marketing,
      paths.changelog,
      paths.workspace,
    ]) {
      expect(existsSync(dir), `디렉토리 누락: ${dir}`).toBe(true);
    }

    expect(existsSync(paths.config)).toBe(true);
    expect(existsSync(paths.kanban)).toBe(true);
    expect(existsSync(paths.sprints)).toBe(true);

    expect(isPerpetualEngineProject(project.root)).toBe(true);
  });

  it('config.yaml 에 프로젝트 이름과 기본값이 기록된다', async () => {
    const manager = new ProjectManager(project.root);
    await manager.init('ACME Corp');

    const config = await loadConfig(getProjectPaths(project.root).config);

    expect(config.company.name).toBe('ACME Corp');
    expect(config.constraints.tech_stack_preference).toBeDefined();
    expect(config.constraints.deploy_target).toBeDefined();
  });

  it('kanban.json / sprints.json 가 올바른 초기 스키마로 생성된다', async () => {
    const manager = new ProjectManager(project.root);
    await manager.init('init-test');

    const kanban = await project.readJson<{ tasks: unknown[]; next_id: number }>('kanban.json');
    const sprints = await project.readJson<{ sprints: unknown[]; current_sprint: unknown }>('sprints.json');

    expect(kanban.tasks).toEqual([]);
    expect(kanban.next_id).toBe(1);
    expect(sprints.sprints).toEqual([]);
    expect(sprints.current_sprint).toBeNull();
  });

  it('기본 에이전트 6명(CEO/CTO/PO/Designer/QA/Marketer) 이 yaml 로 생성된다', async () => {
    const manager = new ProjectManager(project.root);
    await manager.init('init-test');

    const paths = getProjectPaths(project.root);
    const agentFiles = await readdir(paths.agents);
    const yamls = agentFiles.filter(f => f.endsWith('.yaml'));

    expect(yamls.length).toBeGreaterThanOrEqual(6);

    const roles = new Set<string>();
    for (const file of yamls) {
      const agent = await readYaml<{ role: string }>(path.join(paths.agents, file));
      roles.add(agent.role);
    }

    for (const expected of ['ceo', 'cto', 'po', 'designer', 'qa', 'marketer']) {
      expect(roles.has(expected), `${expected} 에이전트가 없음`).toBe(true);
    }
  });

  it('preserveExisting=true 인 경우 기존 README 를 덮어쓰지 않는다', async () => {
    const { writeFile, mkdir, readFile } = await import('node:fs/promises');
    await mkdir(project.root, { recursive: true });
    const readmePath = path.join(project.root, 'README.md');
    await writeFile(readmePath, '# My Existing Project\n', 'utf-8');

    const manager = new ProjectManager(project.root);
    await manager.init('existing', { preserveExisting: true });

    const content = await readFile(readmePath, 'utf-8');
    expect(content).toContain('My Existing Project');
  });
});
