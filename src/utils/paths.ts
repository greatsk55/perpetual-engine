import path from 'node:path';
import { existsSync } from 'node:fs';

export const INFINITE_POWER_DIR = '.perpetual-engine';
export const CONFIG_FILE = 'config.yaml';
export const KANBAN_FILE = 'kanban.json';
export const SPRINTS_FILE = 'sprints.json';
export const METRICS_FILE = 'metrics.json';

export function getProjectPaths(projectRoot: string) {
  const ipDir = path.join(projectRoot, INFINITE_POWER_DIR);
  return {
    root: projectRoot,
    infinitePower: ipDir,
    config: path.join(ipDir, CONFIG_FILE),
    agents: path.join(ipDir, 'agents'),
    sessions: path.join(ipDir, 'sessions'),
    state: path.join(ipDir, 'state'),
    messages: path.join(ipDir, 'messages'),
    kanban: path.join(projectRoot, KANBAN_FILE),
    sprints: path.join(projectRoot, SPRINTS_FILE),
    metrics: path.join(projectRoot, 'metrics.json'),
    metricsReports: path.join(projectRoot, 'docs', 'metrics'),
    docs: path.join(projectRoot, 'docs'),
    vision: path.join(projectRoot, 'docs', 'vision'),
    meetings: path.join(projectRoot, 'docs', 'meetings'),
    decisions: path.join(projectRoot, 'docs', 'decisions'),
    planning: path.join(projectRoot, 'docs', 'planning'),
    design: path.join(projectRoot, 'docs', 'design'),
    designMockups: path.join(projectRoot, 'docs', 'design', 'mockups'),
    development: path.join(projectRoot, 'docs', 'development'),
    marketing: path.join(projectRoot, 'docs', 'marketing'),
    marketingMockups: path.join(projectRoot, 'docs', 'marketing', 'mockups'),
    changelog: path.join(projectRoot, 'docs', 'changelog'),
    workspace: path.join(projectRoot, 'workspace'),
  };
}

export function isPerpetualEngineProject(dir: string): boolean {
  const ipDir = path.join(dir, INFINITE_POWER_DIR);
  return existsSync(ipDir);
}
