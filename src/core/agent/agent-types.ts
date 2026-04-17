export type AgentRole = 'ceo' | 'cto' | 'po' | 'designer' | 'qa' | 'marketer' | 'custom';
export type AgentStatus = 'idle' | 'working' | 'waiting' | 'paused' | 'stopped';

export interface AgentSkill {
  /** 스킬 이름 (Claude Code slash command 또는 커스텀 스킬) */
  name: string;
  /** 스킬 설명 */
  description: string;
  /** 언제 이 스킬을 사용해야 하는지 */
  when_to_use: string;
}

export interface AgentConfig {
  name: string;
  role: AgentRole;
  description: string;
  responsibilities: string[];
  rules: string[];
  skills: AgentSkill[];
  required_mcp_tools?: string[];
  can_create_sub_agents: boolean;
  max_sub_agents: number;
  reports_to: string;
  collaborates_with: string[];
  system_prompt_template: string;
  meeting_permissions: {
    can_schedule: boolean;
    can_participate: boolean;
    required_meetings: string[];
  };
}

export interface AgentSession {
  role: string;
  sessionName: string;
  status: AgentStatus;
  currentTask?: string;
  startedAt: string;
}
