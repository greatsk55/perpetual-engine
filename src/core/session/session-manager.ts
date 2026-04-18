import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { TmuxAdapter } from './tmux-adapter.js';
import { tryAutoInstallTmux } from './tmux-installer.js';
import { PromptBuilder } from '../agent/prompt-builder.js';
import type { AgentConfig, AgentSession, AgentStatus } from '../agent/agent-types.js';
import type { Task } from '../state/types.js';
import type { ProjectConfig } from '../project/config.js';
import { logger } from '../../utils/logger.js';

/**
 * tmux `new-session` 은 명령어 인자 길이가 약 16KB 를 넘으면 "command too long" 으로 거절한다.
 * 그보다 짧은 임계에서 스크립트 파일로 넘겨 실행한다.
 */
const TMUX_CMD_THRESHOLD = 8 * 1024;

export class SessionManager {
  private tmux: TmuxAdapter;
  private promptBuilder: PromptBuilder;
  private activeSessions: Map<string, AgentSession> = new Map();
  private projectRoot = '';

  constructor(tmux?: TmuxAdapter) {
    this.tmux = tmux ?? new TmuxAdapter();
    this.promptBuilder = new PromptBuilder();
  }

  setProjectRoot(root: string): void {
    this.projectRoot = root;
  }

  private getLogDir(): string {
    return this.projectRoot ? path.join(this.projectRoot, '.perpetual-engine', 'sessions') : '';
  }

  /**
   * tmux 세션을 생성한다. 명령어가 tmux 한도를 넘을 것 같으면
   * 자동으로 셸 스크립트 파일에 기록하고 스크립트 경로만 tmux 에 전달한다.
   */
  private async createTmuxSession(sessionName: string, fullCmd: string): Promise<void> {
    if (fullCmd.length <= TMUX_CMD_THRESHOLD) {
      await this.tmux.createSession(sessionName, fullCmd);
      return;
    }

    const logDir = this.getLogDir();
    if (!logDir) {
      // projectRoot 가 없는 경로 — 최후의 보루로 그대로 시도
      await this.tmux.createSession(sessionName, fullCmd);
      return;
    }

    await mkdir(logDir, { recursive: true });
    const scriptPath = path.join(logDir, `${sessionName}.sh`);
    // set -e 는 claude 가 실패해도 tee 는 돌도록 끄고, 파이프 상태는 PIPESTATUS 로 보존한다
    const script = `#!/usr/bin/env bash\n${fullCmd}\n`;
    await writeFile(scriptPath, script, 'utf-8');
    await chmod(scriptPath, 0o755);
    await this.tmux.createSession(sessionName, `bash '${scriptPath}'`);
  }

  async checkPrerequisites(): Promise<void> {
    try {
      await this.tmux.checkInstalled();
      return;
    } catch (originalErr) {
      logger.warn('tmux 가 설치되어 있지 않습니다. 자동 설치를 시도합니다...');
      const result = await tryAutoInstallTmux();
      if (result.succeeded) {
        logger.success(`tmux 자동 설치 완료 (${result.method})`);
        await this.tmux.checkInstalled();
        return;
      }
      if (result.attempted) {
        logger.error(`tmux 자동 설치 실패: ${result.message ?? '알 수 없는 오류'}`);
      } else if (result.message) {
        logger.info(result.message);
      }
      throw originalErr;
    }
  }

  async startAgent(params: {
    agent: AgentConfig;
    config: ProjectConfig;
    task?: Task;
    contextDocs?: string[];
    kanbanSummary?: string;
    projectRoot: string;
    message?: string;
    /**
     * 이 세션이 "완료" 로 간주되려면 반드시 생성되어야 할 산출물 파일 경로들.
     * WorkflowEngine 이 checkOutputs 로 검증하는 경로와 동일해야 한다 — 여기서 명시하지 않으면
     * 에이전트가 의미 있는 파일명(예: mvp-core-features.md)으로 저장해 산출물 검증이 계속 실패한다.
     */
    expectedOutputs?: string[];
    /** 페이즈 완료 조건 문구 (Phase.completionCriteria) */
    completionCriteria?: string;
  }): Promise<AgentSession> {
    const { agent, config, task, contextDocs, kanbanSummary, projectRoot, message, expectedOutputs, completionCriteria } = params;
    const sessionName = agent.role;

    // 이미 실행 중인지 확인
    if (await this.tmux.hasSession(sessionName)) {
      const existing = this.activeSessions.get(agent.role);
      if (existing) return existing;
    }

    // 시스템 프롬프트 조립
    const systemPrompt = this.promptBuilder.buildSystemPrompt({
      agent,
      config,
      task,
      contextDocs,
      kanbanSummary,
    });

    // Claude Code CLI 명령어 구성
    const sessionId = randomUUID();
    const escapedPrompt = systemPrompt.replace(/'/g, "'\\''");

    // 태스크 지시 메시지 구성
    let taskInstruction = '';
    if (message) {
      taskInstruction = `[투자자 지시] ${message}\n\n위 지시를 수행하세요. 필요하면 kanban.json에 태스크를 생성하고, docs/ 에 결과를 문서화하세요.`;
    } else if (task) {
      taskInstruction = `태스크 ${task.id}: ${task.title}\n\n${task.description}\n\n수용 기준:\n${task.acceptance_criteria.map(c => `- ${c}`).join('\n')}`;
    } else {
      taskInstruction = `docs/vision/ 문서를 읽고 첫 스프린트를 계획하세요. kanban.json에 태스크를 생성하세요.`;
    }

    // 산출물 경로는 반드시 정확히 이 경로로 생성되어야 워크플로우가 "완료" 로 판정한다.
    // 에이전트가 의미 있는 이름을 붙여도 경로가 다르면 재시도 루프에 빠진다.
    if (expectedOutputs && expectedOutputs.length > 0) {
      const outputsList = expectedOutputs.map(p => `- ${p}`).join('\n');
      taskInstruction += `\n\n## 필수 산출물 (파일명 정확히)\n워크플로우가 완료로 판정하려면 아래 경로에 파일을 **정확히 이 이름으로** 생성해야 한다. 의미가 잘 드러나는 이름을 별도로 쓰고 싶다면 이 파일 안에서 섹션 제목으로 표현하고, 추가 파일은 옆에 두어도 되지만 **아래 경로의 파일은 반드시 존재해야 한다**:\n${outputsList}`;
    }
    if (completionCriteria) {
      taskInstruction += `\n\n## 완료 조건\n${completionCriteria}`;
    }

    const claudeCmdParts = [
      'claude',
      `--append-system-prompt '${escapedPrompt}'`,
      `--session-id ${sessionId}`,
      `--dangerously-skip-permissions`,
      `--add-dir '${projectRoot}'`,
    ];

    // 에이전트가 필요로 하는 MCP 서버 연결
    const mcpConfigArg = this.buildMcpConfigArg(agent, config);
    if (mcpConfigArg) {
      claudeCmdParts.push(mcpConfigArg);
    }

    claudeCmdParts.push(`-p '${taskInstruction.replace(/'/g, "'\\''")}'`);
    const claudeCmd = claudeCmdParts.join(' ');

    // 로그 파일 경로
    this.projectRoot = projectRoot;
    const logFile = path.join(this.getLogDir(), `${sessionName}.log`);

    // tmux 세션에서 Claude Code 실행 (stdout을 로그 파일로 저장)
    const fullCmd = `cd '${projectRoot}' && ${claudeCmd} 2>&1 | tee '${logFile}'`;
    await this.createTmuxSession(sessionName, fullCmd);

    const session: AgentSession = {
      role: agent.role,
      sessionName,
      status: 'working',
      currentTask: task?.id,
      startedAt: new Date().toISOString(),
    };

    this.activeSessions.set(agent.role, session);
    return session;
  }

  async stopAgent(role: string): Promise<void> {
    await this.tmux.killSession(role);
    this.activeSessions.delete(role);
  }

  async stopAll(): Promise<void> {
    await this.tmux.killAllSessions();
    this.activeSessions.clear();
  }

  async getRunningAgents(): Promise<AgentSession[]> {
    const sessions = await this.tmux.listSessions();
    const result: AgentSession[] = [];

    for (const [role, session] of this.activeSessions) {
      const isRunning = sessions.some(s => s.includes(role));
      if (isRunning) {
        result.push(session);
      } else {
        // 세션이 종료됨
        session.status = 'idle';
        this.activeSessions.delete(role);
      }
    }

    return result;
  }

  async isAgentRunning(role: string): Promise<boolean> {
    return this.tmux.hasSession(role);
  }

  async getAgentLog(role: string, lines = 100): Promise<string> {
    const logDir = this.getLogDir();
    if (!logDir) return '';
    const logFile = path.join(logDir, `${role}.log`);
    try {
      const content = await readFile(logFile, 'utf-8');
      // 마지막 N줄만 반환
      const allLines = content.split('\n');
      return allLines.slice(-lines).join('\n');
    } catch {
      // 로그 파일이 없으면 tmux pane 시도
      return this.tmux.capturePane(role, lines);
    }
  }

  /**
   * 에이전트의 required_mcp_tools와 프로젝트의 mcp_servers 설정을 매칭하여
   * Claude Code CLI의 --mcp-config 인자를 생성한다.
   */
  private buildMcpConfigArg(agent: AgentConfig, config: ProjectConfig): string | null {
    const requiredTools = agent.required_mcp_tools;
    if (!requiredTools?.length) return null;

    const mcpServers = config.mcp_servers;
    if (!mcpServers || Object.keys(mcpServers).length === 0) {
      logger.warn(`[${agent.role}] MCP 도구 필요: ${requiredTools.join(', ')} — 하지만 mcp_servers 설정이 없습니다`);
      return null;
    }

    const matched: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
    for (const tool of requiredTools) {
      const server = mcpServers[tool];
      if (server) {
        matched[tool] = { command: server.command, args: server.args };
        if (Object.keys(server.env).length > 0) {
          matched[tool].env = server.env;
        }
      } else {
        logger.warn(`[${agent.role}] MCP 서버 '${tool}'이 mcp_servers에 정의되지 않았습니다`);
      }
    }

    if (Object.keys(matched).length === 0) return null;

    const mcpConfig = { mcpServers: matched };
    const configJson = JSON.stringify(mcpConfig).replace(/'/g, "'\\''");
    return `--mcp-config '${configJson}'`;
  }

  async pauseAgent(role: string): Promise<void> {
    // Ctrl+C 전송
    await this.tmux.sendKeys(role, 'C-c');
    const session = this.activeSessions.get(role);
    if (session) session.status = 'paused';
  }

  /**
   * 에페메럴(일시적) 에이전트 세션 시작.
   * 고유 sessionName으로 ���행되며, 완료 후 자동 정리된다.
   */
  async startEphemeralAgent(params: {
    sessionName: string;
    agent: AgentConfig;
    config: ProjectConfig;
    contextDocs?: string[];
    kanbanSummary?: string;
    projectRoot: string;
    message: string;
  }): Promise<AgentSession> {
    const { sessionName, agent, config, contextDocs, kanbanSummary, projectRoot, message } = params;

    // ���스템 프롬프트 조립
    const systemPrompt = this.promptBuilder.buildSystemPrompt({
      agent,
      config,
      contextDocs,
      kanbanSummary,
    });

    const sessionId = randomUUID();
    const escapedPrompt = systemPrompt.replace(/'/g, "'\\''");
    const taskInstruction = `[자문 요청] ${message}\n\n위 질문에 대해 전문가로서 답변하세요. 답변은 docs/decisions/ 에 문서화하세요.`;

    const claudeCmd = [
      'claude',
      `--append-system-prompt '${escapedPrompt}'`,
      `--session-id ${sessionId}`,
      `--dangerously-skip-permissions`,
      `--add-dir '${projectRoot}'`,
      `-p '${taskInstruction.replace(/'/g, "'\\''")}'`,
    ].join(' ');

    this.projectRoot = projectRoot;
    const logFile = path.join(this.getLogDir(), `${sessionName}.log`);

    const fullCmd = `cd '${projectRoot}' && ${claudeCmd} 2>&1 | tee '${logFile}'`;
    await this.createTmuxSession(sessionName, fullCmd);

    const session: AgentSession = {
      role: sessionName,
      sessionName,
      status: 'working',
      startedAt: new Date().toISOString(),
    };

    this.activeSessions.set(sessionName, session);
    return session;
  }

  /**
   * 다중 에이전트 회의 시작.
   * 회의 주최자(initiator)를 하나의 세션으로 실행하되,
   * 참여자 목록과 안건을 시스템 프롬프트에 주입하여
   * 다른 에이전트의 관점을 반영한 회의를 진행하게 한다.
   */
  async startMeetingSession(params: {
    meetingId: string;
    initiator: AgentConfig;
    participants: AgentConfig[];
    consultants?: Array<{ id: string; config: AgentConfig }>;
    config: ProjectConfig;
    agenda: string;
    kanbanSummary?: string;
    projectRoot: string;
  }): Promise<AgentSession> {
    const { meetingId, initiator, participants, consultants, config, agenda, kanbanSummary, projectRoot } = params;

    const participantNames = participants.map(p => p.name).join(', ');
    const consultantNames = consultants?.map(c => c.config.name).join(', ') ?? '';

    // 참여자들의 역할/책임 정보를 컨텍스트로 주입
    const participantContext = participants.map(p =>
      `### ${p.name} (${p.role})\n- 역할: ${p.description}\n- 책임: ${p.responsibilities.join(', ')}`
    ).join('\n\n');

    const consultantContext = consultants?.map(c =>
      `### ${c.config.name}\n- 역할: ${c.config.description}\n- ID: ${c.id}`
    ).join('\n\n') ?? '';

    const meetingPrompt = `\n\n## 회의 정보
- 회의 ID: ${meetingId}
- 참여자: ${participantNames}${consultantNames ? `, ${consultantNames} (자문)` : ''}

## 참여자 역할
${participantContext}
${consultantContext ? `\n## 자문 전문가\n${consultantContext}` : ''}

## 회의 안건
${agenda}

## 회의 진행 규칙
1. 각 참여자의 관점에서 안건을 검토하고 의견을 ��리한다
2. 모든 참여자의 역할과 책임을 고려하여 균형 잡힌 논의를 한다
3. ${consultants?.length ? '자문 전문가의 의견을 적극 반영한다\n4. ' : ''}회의 결과를 docs/meetings/에 회의록으로 문서화한다
${consultants?.length ? '5' : '4'}. 결정사항은 docs/decisions/에 기록한다
${consultants?.length ? '6' : '5'}. 액션 아이템을 kanban.json에 태스크로 등록한다`;

    const systemPrompt = this.promptBuilder.buildSystemPrompt({
      agent: initiator,
      config,
      kanbanSummary,
    }) + meetingPrompt;

    const sessionName = `meeting-${meetingId}`;
    const sessionId = randomUUID();
    const escapedPrompt = systemPrompt.replace(/'/g, "'\\''");

    const taskInstruction = `회의를 진행하세요.\n\n안건:\n${agenda}\n\n참여자: ${participantNames}${consultantNames ? `, ${consultantNames}` : ''}\n\n각 참여자의 관점을 반영하여 논의하고, 결정사항과 액션 아이템을 도출하세요.`;

    const claudeCmd = [
      'claude',
      `--append-system-prompt '${escapedPrompt}'`,
      `--session-id ${sessionId}`,
      `--dangerously-skip-permissions`,
      `--add-dir '${projectRoot}'`,
      `-p '${taskInstruction.replace(/'/g, "'\\''")}'`,
    ].join(' ');

    this.projectRoot = projectRoot;
    const logFile = path.join(this.getLogDir(), `${sessionName}.log`);

    const fullCmd = `cd '${projectRoot}' && ${claudeCmd} 2>&1 | tee '${logFile}'`;
    await this.createTmuxSession(sessionName, fullCmd);

    const session: AgentSession = {
      role: sessionName,
      sessionName,
      status: 'working',
      startedAt: new Date().toISOString(),
    };

    this.activeSessions.set(sessionName, session);
    return session;
  }
}
