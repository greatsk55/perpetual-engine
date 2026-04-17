import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { readYaml } from '../../utils/yaml.js';
import type { AgentConfig, AgentRole } from './agent-types.js';

export class AgentRegistry {
  private agentsDir: string;
  private agents: Map<string, AgentConfig> = new Map();
  /** 임시(에페메럴) 에이전트 — 자문 등 일회성 에이전트용 */
  private ephemeralAgents: Map<string, AgentConfig> = new Map();

  constructor(agentsDir: string) {
    this.agentsDir = agentsDir;
  }

  async load(): Promise<void> {
    this.agents.clear();
    const files = await readdir(this.agentsDir);
    const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

    for (const file of yamlFiles) {
      const filePath = path.join(this.agentsDir, file);
      const config = await readYaml<AgentConfig>(filePath);
      this.agents.set(config.role, config);
    }
  }

  get(role: string): AgentConfig | undefined {
    return this.agents.get(role) ?? this.ephemeralAgents.get(role);
  }

  getAll(): AgentConfig[] {
    return [
      ...Array.from(this.agents.values()),
      ...Array.from(this.ephemeralAgents.values()),
    ];
  }

  /** 상시 에이전트 역할 목록 (에페메럴 제외) */
  getRoles(): string[] {
    return Array.from(this.agents.keys());
  }

  /** 에페메럴 에이전트 포함 전체 역할 목록 */
  getAllRoles(): string[] {
    return [...this.agents.keys(), ...this.ephemeralAgents.keys()];
  }

  has(role: string): boolean {
    return this.agents.has(role) || this.ephemeralAgents.has(role);
  }

  /**
   * 임시 에이전트 등록.
   * 자문 전문가 등 일회성 에이전트를 고유 ID로 등록한다.
   * 기존 상시 에이전트와 키가 충돌하지 않도록 고유 ID를 사용해야 한다.
   */
  registerEphemeral(id: string, config: AgentConfig): void {
    this.ephemeralAgents.set(id, config);
  }

  /**
   * 임시 에이전트 해제(소멸).
   * 목적 완수 후 호출하여 레지스트리에서 제거한다.
   */
  unregisterEphemeral(id: string): boolean {
    return this.ephemeralAgents.delete(id);
  }

  /** 현재 등록된 에페메럴 에이전트 목록 */
  getEphemeralAgents(): Array<{ id: string; config: AgentConfig }> {
    return Array.from(this.ephemeralAgents.entries()).map(([id, config]) => ({ id, config }));
  }

  /** 에페메럴 에이전트 존재 여부 */
  hasEphemeral(id: string): boolean {
    return this.ephemeralAgents.has(id);
  }
}
