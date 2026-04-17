import { watch } from 'chokidar';
import { ProjectManager } from '../project/project-manager.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { SessionManager } from '../session/session-manager.js';
import { KanbanManager } from '../state/kanban.js';
import { SprintManager } from '../state/sprint.js';
import { WorkflowEngine } from './workflow-engine.js';
import { PromptBuilder } from '../agent/prompt-builder.js';
import { MessageQueue, type Message } from '../messaging/message-queue.js';
import { MeetingCoordinator } from '../messaging/meeting.js';
import { MetricsManager } from '../metrics/metrics-store.js';
import { ConsultantFactory, type ConsultantAgent, type ConsultantRequest } from '../agent/consultant-factory.js';
import { DashboardServer } from '../../dashboard/server.js';
import { getProjectPaths } from '../../utils/paths.js';
import { logger } from '../../utils/logger.js';
import type { Task } from '../state/types.js';
import type { ProjectConfig } from '../project/config.js';
import type { AgentConfig } from '../agent/agent-types.js';
import type { FSWatcher } from 'chokidar';

/**
 * Orchestrator 주입 옵션.
 * 테스트에서 tmux/Claude CLI 실행을 Mock 어댑터로 대체하거나,
 * 대시보드 포트를 임의로 지정하거나, keepAlive 루프를 끌 때 사용한다.
 */
export interface OrchestratorOptions {
  /** 사용자 지정 SessionManager — 테스트에서 MockTmuxAdapter 를 주입할 때 사용 */
  sessionManager?: SessionManager;
  /** 대시보드 리스닝 포트 (기본 3000) */
  dashboardPort?: number;
  /** false 면 대시보드 서버를 시작하지 않는다 */
  dashboardEnabled?: boolean;
  /** false 면 start() 가 keepAlive 루프에 진입하지 않고 즉시 반환한다 */
  keepAlive?: boolean;
  /** CEO 에이전트를 start 시점에 자동 기동하지 않는다 (테스트 격리용) */
  autoStartCeo?: boolean;
  /** WorkflowEngine 의 세션 완료 폴링 간격(ms). 테스트에서 짧게 주입한다 */
  workflowPollInterval?: number;
}

export class Orchestrator {
  private projectRoot: string;
  private projectManager: ProjectManager;
  private agentRegistry: AgentRegistry;
  private sessionManager: SessionManager;
  private kanban: KanbanManager;
  private sprintManager: SprintManager;
  private workflowEngine!: WorkflowEngine;
  private config!: ProjectConfig;
  private dashboard: DashboardServer | null = null;
  private messageQueue!: MessageQueue;
  private meetingCoordinator!: MeetingCoordinator;
  private consultantFactory: ConsultantFactory = new ConsultantFactory();
  /** 활성 자문 에이전트 추적 (ID → ConsultantAgent) */
  private activeConsultants: Map<string, ConsultantAgent> = new Map();
  private watcher: FSWatcher | null = null;
  private messageWatcher: FSWatcher | null = null;
  private processingTasks: Set<string> = new Set();
  private workflowAborters: Map<string, AbortController> = new Map();
  private processedMessages: Set<string> = new Set();
  private running = false;

  private readonly dashboardPort: number;
  private readonly dashboardEnabled: boolean;
  private readonly keepAliveEnabled: boolean;
  private readonly autoStartCeoEnabled: boolean;
  private readonly workflowPollInterval: number | undefined;

  constructor(projectRoot: string, options?: OrchestratorOptions) {
    this.projectRoot = projectRoot;
    const paths = getProjectPaths(projectRoot);
    this.projectManager = new ProjectManager(projectRoot);
    this.agentRegistry = new AgentRegistry(paths.agents);
    this.sessionManager = options?.sessionManager ?? new SessionManager();
    this.kanban = new KanbanManager(paths.kanban);
    this.sprintManager = new SprintManager(paths.sprints);

    this.dashboardPort = options?.dashboardPort ?? 3000;
    this.dashboardEnabled = options?.dashboardEnabled ?? true;
    this.keepAliveEnabled = options?.keepAlive ?? true;
    this.autoStartCeoEnabled = options?.autoStartCeo ?? true;
    this.workflowPollInterval = options?.workflowPollInterval;
  }

  /** 테스트용 접근자 — 내부 상태 검증에 쓰인다 */
  getInternals() {
    return {
      agentRegistry: this.agentRegistry,
      sessionManager: this.sessionManager,
      kanban: this.kanban,
      sprintManager: this.sprintManager,
      messageQueue: this.messageQueue,
      meetingCoordinator: this.meetingCoordinator,
      activeConsultants: this.activeConsultants,
      dashboard: this.dashboard,
    };
  }

  async start(): Promise<void> {
    logger.info('PerpetualEngine 시작 중...');

    // 1. 설정 로드
    this.config = await this.projectManager.loadConfig();
    logger.step('설정 로드 완료');

    // 2. 에이전트 레지스트리 로드
    await this.agentRegistry.load();
    logger.step(`에이전트 ${this.agentRegistry.getRoles().length}명 로드 완료`);

    // 3. tmux 확인
    try {
      await this.sessionManager.checkPrerequisites();
      logger.step('tmux 확인 완료');
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }

    // 4. 메시지 큐 + 메트릭스 매니저 + 워크플로우 엔진 초기화
    const paths = getProjectPaths(this.projectRoot);
    this.messageQueue = new MessageQueue(paths.messages);
    this.meetingCoordinator = new MeetingCoordinator(this.projectRoot);
    const metricsManager = new MetricsManager(paths.metrics);
    this.workflowEngine = new WorkflowEngine({
      sessionManager: this.sessionManager,
      agentRegistry: this.agentRegistry,
      kanban: this.kanban,
      config: this.config,
      projectRoot: this.projectRoot,
      metricsManager,
      pollInterval: this.workflowPollInterval,
    });

    this.running = true;

    // 5. 대시보드 서버 시작
    if (this.dashboardEnabled) {
      this.dashboard = new DashboardServer(this.projectRoot, this.dashboardPort, {
        sessionManager: this.sessionManager,
      });
      await this.dashboard.start();
    }

    // 6. CEO 에이전트 시작 (초기 스프린트 계획)
    if (this.autoStartCeoEnabled) {
      await this.startCEO();
    }

    // 7. 파일 워처 시작 (kanban.json 변경 감지)
    this.startWatcher();

    // 8. 메시지 워처 시작 (messages/ 디렉토리 감지)
    this.startMessageWatcher();

    // 9. 기존 todo 태스크 초기 스캔 (워처는 변경만 감지하므로 기존 태스크 처리 필요)
    try {
      await this.processNewTasks();
    } catch (err) {
      logger.error(`초기 태스크 스캔 오류: ${(err as Error).message}`);
    }

    logger.success('PerpetualEngine가 시작되었습니다!');
    if (this.autoStartCeoEnabled) {
      logger.info('CEO 에이전트가 스프린트를 계획하고 있습니다...');
    }
    logger.dim('Ctrl+C로 종료하거나 perpetual-engine stop 명령어를 사용하세요.');

    // 프로세스 유지
    if (this.keepAliveEnabled) {
      await this.keepAlive();
    }
  }

  async stop(): Promise<void> {
    logger.info('PerpetualEngine 종료 중...');
    this.running = false;

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    if (this.messageWatcher) {
      await this.messageWatcher.close();
      this.messageWatcher = null;
    }

    if (this.dashboard) {
      await this.dashboard.stop();
      this.dashboard = null;
    }

    // 진행 중인 모든 워크플로우에 중단 신호를 보낸다
    for (const aborter of this.workflowAborters.values()) aborter.abort();

    // 세션을 먼저 종료해 워크플로우 루프가 다음 폴링에서 깨어나게 한다
    await this.sessionManager.stopAll();

    // 진행 중인 워크플로우가 자연스럽게 drain 되도록 잠시 대기
    await this.drainProcessingTasks();

    this.workflowAborters.clear();

    logger.success('모든 에이전트가 종료되었습니다.');
  }

  /**
   * processingTasks 가 비워질 때까지 짧게 대기.
   * 테스트·재시작 시 비동기 워크플로우가 파일시스템을 만지는 중에
   * 디렉토리가 삭제되는 race 를 방지한다.
   */
  private async drainProcessingTasks(maxWaitMs = 1500): Promise<void> {
    const start = Date.now();
    while (this.processingTasks.size > 0 && Date.now() - start < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  private async startCEO(): Promise<void> {
    const ceoAgent = this.agentRegistry.get('ceo');
    if (!ceoAgent) {
      logger.error('CEO 에이전트를 찾을 수 없습니다.');
      return;
    }

    const allTasks = await this.kanban.getAllTasks();
    const builder = new PromptBuilder();
    const kanbanSummary = builder.buildKanbanSummary(allTasks);

    await this.sessionManager.startAgent({
      agent: ceoAgent,
      config: this.config,
      contextDocs: ['docs/vision/company-goal.md', 'docs/vision/product-vision.md'],
      kanbanSummary,
      projectRoot: this.projectRoot,
    });
  }

  private startWatcher(): void {
    const paths = getProjectPaths(this.projectRoot);

    this.watcher = watch(paths.kanban, {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', async () => {
      if (!this.running) return;

      try {
        await this.processNewTasks();
      } catch (err) {
        logger.error(`태스크 처리 오류: ${(err as Error).message}`);
      }
    });
  }

  private async processNewTasks(): Promise<void> {
    const tasks = await this.kanban.getAllTasks();

    // backlog 또는 todo 상태이면서 아직 처리 중이 아닌 태스크
    const pendingTasks = tasks.filter(
      t => (t.status === 'backlog' || t.status === 'todo') && !this.processingTasks.has(t.id),
    );

    for (const task of pendingTasks) {
      // 의존성 확인
      const depsCompleted = await this.checkDependencies(task, tasks);
      if (!depsCompleted) continue;

      this.processingTasks.add(task.id);
      logger.info(`새 태스크 감지: ${task.id} - ${task.title}`);

      // 비동기로 워크플로우 실행 (병렬)
      const aborter = new AbortController();
      this.workflowAborters.set(task.id, aborter);
      this.workflowEngine.runWorkflow(task, aborter.signal).then(() => {
        this.processingTasks.delete(task.id);
        this.workflowAborters.delete(task.id);
      }).catch(err => {
        logger.error(`[${task.id}] 워크플로우 실패: ${(err as Error).message}`);
        this.processingTasks.delete(task.id);
        this.workflowAborters.delete(task.id);
      });
    }
  }

  private async checkDependencies(task: Task, allTasks: Task[]): Promise<boolean> {
    if (task.dependencies.length === 0) return true;

    for (const depId of task.dependencies) {
      const dep = allTasks.find(t => t.id === depId);
      if (!dep || dep.status !== 'done') return false;
    }
    return true;
  }

  private startMessageWatcher(): void {
    const paths = getProjectPaths(this.projectRoot);

    this.messageWatcher = watch(paths.messages, {
      persistent: true,
      ignoreInitial: true,
    });

    this.messageWatcher.on('add', async (filePath) => {
      if (!this.running || !filePath.endsWith('.json')) return;

      try {
        await this.processNewMessages();
      } catch (err) {
        logger.error(`메시지 처리 오류: ${(err as Error).message}`);
      }
    });
  }

  private async processNewMessages(): Promise<void> {
    const messages = await this.messageQueue.getAll();
    const unread = messages.filter(m => !m.read && !this.processedMessages.has(m.id));

    for (const msg of unread) {
      this.processedMessages.add(msg.id);
      await this.messageQueue.markAsRead(msg.id);

      // 자문 요청 메시지 처리
      if (msg.type === 'consultation_request') {
        await this.handleConsultationRequest(msg);
        continue;
      }

      // 회의 ���대 메시지 처리 (다중 참여자)
      if (msg.type === 'meeting_invite') {
        await this.handleMeetingInvite(msg);
        continue;
      }

      // 일반 메시지: 대상 에이전트에게 전달
      const targetRole = msg.to === 'all' ? 'ceo' : msg.to;
      const agent = this.agentRegistry.get(targetRole);
      if (!agent) {
        logger.error(`메시지 대상 에이전트 없음: ${targetRole}`);
        continue;
      }

      logger.info(`메시지 전달: "${msg.content}" → ${targetRole}`);

      const allTasks = await this.kanban.getAllTasks();
      const builder = new PromptBuilder();
      const kanbanSummary = builder.buildKanbanSummary(allTasks);

      if (await this.sessionManager.isAgentRunning(targetRole)) {
        await this.sessionManager.stopAgent(targetRole);
      }

      await this.sessionManager.startAgent({
        agent,
        config: this.config,
        contextDocs: ['docs/vision/company-goal.md', 'docs/vision/product-vision.md'],
        kanbanSummary,
        projectRoot: this.projectRoot,
        message: msg.content,
      });
    }
  }

  /**
   * 자문 요청 메시지를 파싱하고 자문 에이전트를 생성한다.
   * 메시지 content는 JSON 형식의 ConsultantRequest를 기대한다.
   */
  private async handleConsultationRequest(msg: Message): Promise<void> {
    try {
      const request: ConsultantRequest = typeof msg.content === 'string'
        ? JSON.parse(msg.content)
        : msg.content;
      logger.info(`자문 요청 수신: "${request.expertise}" (요청자: ${request.requested_by})`);
      await this.spawnConsultant(request);
    } catch (err) {
      logger.error(`자문 요청 파싱 실패: ${(err as Error).message}`);
    }
  }

  /**
   * 회의 초대 메시지를 파싱하고 다중 참여자 회의를 시작한다.
   * 메시지 content는 JSON 형식의 회의 설정을 기대한다.
   */
  private async handleMeetingInvite(msg: Message): Promise<void> {
    try {
      const meetingConfig = (typeof msg.content === 'string'
        ? JSON.parse(msg.content)
        : msg.content) as {
        title: string;
        type: 'issue_discussion' | 'consultation' | 'tech_design_review' | 'design_review' | 'sprint_planning' | 'emergency';
        participantRoles: string[];
        topics: string[];
        relatedTaskIds?: string[];
        consultantRequests?: ConsultantRequest[];
        initiatorRole?: string;
        requested_by?: string;
      };

      // 에이전트가 MessageQueue.send() 를 거치지 않고 파일을 직접 만들 때 from 이 비는 경우가 있어
      // content 내부 필드에서 주최자를 추론한다. 마지막 보루로 ceo 를 사용한다.
      const initiatorRole =
        msg.from ||
        meetingConfig.initiatorRole ||
        meetingConfig.requested_by ||
        'ceo';
      if (!msg.from) {
        logger.warn(`회의 초대에 from 필드가 없음 → ${initiatorRole} 로 추론 (msg id=${msg.id ?? '미확인'})`);
      }

      await this.startMultiAgentMeeting({
        ...meetingConfig,
        initiatorRole,
      });
    } catch (err) {
      logger.error(`회의 초대 파싱 실패: ${(err as Error).message}`);
    }
  }

  // ========== 태스크 강제 제어 ==========

  /**
   * 태스크를 강제로 실행한다.
   * 현재 상태·의존성을 무시하고 즉시 워크플로우를 시작한다.
   */
  async forceRunTask(taskId: string): Promise<void> {
    const task = await this.kanban.forceStart(taskId);
    logger.info(`[${taskId}] 강제 실행: ${task.title}`);

    if (this.processingTasks.has(taskId)) {
      logger.warn(`[${taskId}] 이미 처리 중 — 기존 워크플로우가 계속됩니다`);
      return;
    }

    this.processingTasks.add(taskId);

    const aborter = new AbortController();
    this.workflowAborters.set(taskId, aborter);
    this.workflowEngine.runWorkflow(task, aborter.signal).then(() => {
      this.processingTasks.delete(taskId);
      this.workflowAborters.delete(taskId);
    }).catch(err => {
      logger.error(`[${taskId}] 워크플로우 실패: ${(err as Error).message}`);
      this.processingTasks.delete(taskId);
      this.workflowAborters.delete(taskId);
    });
  }

  /**
   * 태스크를 일시 중단한다.
   * 실행 중인 에이전트 세션을 종료하고 상태를 suspended로 전환한다.
   */
  async suspendTask(taskId: string, reason?: string): Promise<void> {
    const task = await this.kanban.getTask(taskId);
    if (!task) throw new Error(`태스크를 찾을 수 없습니다: ${taskId}`);

    // 실행 중인 에이전트 세션 종료
    if (task.status === 'in_progress' && task.assignee) {
      const isRunning = await this.sessionManager.isAgentRunning(task.assignee);
      if (isRunning) {
        await this.sessionManager.stopAgent(task.assignee);
        logger.step(`[${taskId}] ${task.assignee} 에이전트 세션 종료`);
      }
    }

    // 진행 중인 워크플로우 중단
    this.workflowAborters.get(taskId)?.abort();
    this.workflowAborters.delete(taskId);

    // 처리 목록에서 제거
    this.processingTasks.delete(taskId);

    // 상태 전환
    const updated = await this.kanban.suspendTask(taskId, reason);
    logger.info(`[${taskId}] 일시 중단: ${updated.title}${reason ? ` (사유: ${reason})` : ''}`);
  }

  /**
   * 중단된 태스크를 재개한다.
   * 이전 상태로 복원하고, todo/backlog이면 워크플로우가 자동으로 픽업한다.
   */
  async resumeTask(taskId: string): Promise<void> {
    const updated = await this.kanban.resumeTask(taskId);
    logger.info(`[${taskId}] 재개: ${updated.title} → ${updated.status}`);
  }

  // ========== 자문 전문가 에이전트 ==========

  /**
   * 자문 전문가 에이전트를 생성하고 세션을 시작한다.
   * 목적 완수 후 disposeConsultant()로 소멸시켜야 한다.
   */
  async spawnConsultant(request: ConsultantRequest): Promise<ConsultantAgent> {
    const consultant = this.consultantFactory.create(request);

    // 레지스트리에 에페메럴로 등록
    this.agentRegistry.registerEphemeral(consultant.id, consultant.config);
    this.activeConsultants.set(consultant.id, consultant);

    logger.info(`자문 에이전트 생성: ${consultant.config.name} (${consultant.id})`);

    // 칸반 현황 생성
    const allTasks = await this.kanban.getAllTasks();
    const builder = new PromptBuilder();
    const kanbanSummary = builder.buildKanbanSummary(allTasks);

    // 에페메럴 세션 시작
    await this.sessionManager.startEphemeralAgent({
      sessionName: consultant.id,
      agent: consultant.config,
      config: this.config,
      contextDocs: ['docs/vision/company-goal.md', 'docs/vision/product-vision.md'],
      kanbanSummary,
      projectRoot: this.projectRoot,
      message: `${request.context}\n\n질문:\n${request.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
    });

    // 세션 완료 감시 → 자동 소멸
    this.watchConsultantCompletion(consultant.id);

    return consultant;
  }

  /**
   * 자문 에이전트 세션 완료를 감시하고, 완료 시 자동 소멸시킨다.
   */
  private watchConsultantCompletion(consultantId: string): void {
    const pollInterval = 5000;
    const maxWait = 300000; // 5분
    const startTime = Date.now();

    const check = async () => {
      if (!this.running) return;

      const isRunning = await this.sessionManager.isAgentRunning(consultantId);
      if (!isRunning) {
        await this.disposeConsultant(consultantId);
        return;
      }

      if (Date.now() - startTime > maxWait) {
        logger.warn(`[${consultantId}] 자문 타임아웃 → 강제 소멸`);
        await this.sessionManager.stopAgent(consultantId);
        await this.disposeConsultant(consultantId);
        return;
      }

      setTimeout(check, pollInterval);
    };

    setTimeout(check, pollInterval);
  }

  /**
   * 자문 에이전트를 소멸시킨다.
   * 세션 종료 + 레지스트리 해제 + 추적 맵 정리.
   */
  async disposeConsultant(consultantId: string): Promise<void> {
    const consultant = this.activeConsultants.get(consultantId);
    if (!consultant) return;

    // 세션이 아직 살아있으면 종료
    if (await this.sessionManager.isAgentRunning(consultantId)) {
      await this.sessionManager.stopAgent(consultantId);
    }

    // 레지스트리에서 해제
    this.agentRegistry.unregisterEphemeral(consultantId);
    consultant.disposed = true;
    this.activeConsultants.delete(consultantId);

    logger.info(`자문 에이전트 소멸: ${consultant.config.name} (${consultantId})`);
  }

  /** 활성 자문 에이전트 목록 */
  getActiveConsultants(): ConsultantAgent[] {
    return Array.from(this.activeConsultants.values());
  }

  // ========== 다중 참여자 회의 ==========

  /**
   * 이슈에 대해 유관 에이전트들이 참여하는 회의를 개최한다.
   * 선택적으로 자문 전문가 에이전트를 생성하여 참여시킬 수 있다.
   */
  async startMultiAgentMeeting(params: {
    title: string;
    type: 'issue_discussion' | 'consultation' | 'tech_design_review' | 'design_review' | 'sprint_planning' | 'emergency';
    initiatorRole: string;
    participantRoles: string[];
    topics: string[];
    relatedTaskIds?: string[];
    consultantRequests?: ConsultantRequest[];
  }): Promise<{ meetingId: string; consultants: ConsultantAgent[] }> {
    const { title, type, initiatorRole, participantRoles, topics, relatedTaskIds, consultantRequests } = params;

    // 주최자 에이전트
    const initiator = this.agentRegistry.get(initiatorRole);
    if (!initiator) throw new Error(`주최자 에이전트를 찾을 수 없습니다: ${initiatorRole}`);

    // 참여 에이전트들 조회
    const participants: AgentConfig[] = [];
    for (const role of participantRoles) {
      const agent = this.agentRegistry.get(role);
      if (agent) participants.push(agent);
    }

    // 자문 전문가 에이전트 생성 (요청이 있으면)
    const consultants: ConsultantAgent[] = [];
    if (consultantRequests) {
      for (const req of consultantRequests) {
        const consultant = this.consultantFactory.create(req);
        this.agentRegistry.registerEphemeral(consultant.id, consultant.config);
        this.activeConsultants.set(consultant.id, consultant);
        consultants.push(consultant);
        logger.info(`회의 자문 에이전트 생성: ${consultant.config.name} (${consultant.id})`);
      }
    }

    // 회의 아젠다 생성
    const agenda = await this.meetingCoordinator.createAgenda({
      type,
      title,
      participants: [initiatorRole, ...participantRoles, ...consultants.map(c => c.id)],
      topics,
    });

    // 칸반 현황
    const allTasks = await this.kanban.getAllTasks();
    const builder = new PromptBuilder();
    const kanbanSummary = builder.buildKanbanSummary(allTasks);

    // 관련 태스크 정보 안건에 추가
    let agendaText = `# ${title}\n\n## 안건\n${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

    if (relatedTaskIds && relatedTaskIds.length > 0) {
      const relatedTasks = allTasks.filter(t => relatedTaskIds.includes(t.id));
      agendaText += `\n\n## 관련 태스크\n`;
      for (const t of relatedTasks) {
        agendaText += `- ${t.id}: ${t.title} (상태: ${t.status}, 담당: ${t.assignee}, 우선순위: ${t.priority})\n`;
        if (t.description) agendaText += `  설명: ${t.description}\n`;
      }
    }

    // 회의 세션 시작
    await this.sessionManager.startMeetingSession({
      meetingId: agenda.id,
      initiator,
      participants,
      consultants: consultants.map(c => ({ id: c.id, config: c.config })),
      config: this.config,
      agenda: agendaText,
      kanbanSummary,
      projectRoot: this.projectRoot,
    });

    logger.info(`회의 시작: "${title}" (참여자: ${participantRoles.join(', ')}${consultants.length > 0 ? `, 자문: ${consultants.map(c => c.config.name).join(', ')}` : ''})`);

    // 회의 완료 후 자문 에이전트 자동 소멸 감시
    if (consultants.length > 0) {
      this.watchMeetingCompletion(agenda.id, consultants);
    }

    return { meetingId: agenda.id, consultants };
  }

  /**
   * 회의 세션 완료를 감시하고, 자문 에이전트를 소멸시킨다.
   */
  private watchMeetingCompletion(meetingId: string, consultants: ConsultantAgent[]): void {
    const sessionName = `meeting-${meetingId}`;
    const pollInterval = 5000;
    const maxWait = 600000; // 10분
    const startTime = Date.now();

    const check = async () => {
      if (!this.running) return;

      const isRunning = await this.sessionManager.isAgentRunning(sessionName);
      if (!isRunning || Date.now() - startTime > maxWait) {
        // 회의 종료 → 자문 에이전트 소멸
        for (const consultant of consultants) {
          await this.disposeConsultant(consultant.id);
        }
        if (Date.now() - startTime > maxWait) {
          logger.warn(`회의 ${meetingId} 타임아웃`);
          await this.sessionManager.stopAgent(sessionName);
        }
        return;
      }

      setTimeout(check, pollInterval);
    };

    setTimeout(check, pollInterval);
  }

  private async keepAlive(): Promise<void> {
    return new Promise((resolve) => {
      const onExit = async () => {
        await this.stop();
        resolve();
      };

      process.on('SIGINT', onExit);
      process.on('SIGTERM', onExit);
    });
  }
}
