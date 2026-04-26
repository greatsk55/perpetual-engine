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
  /**
   * CEO 에이전트를 start 시점에 자동 기동할지 결정한다.
   * - `true` (기본) 또는 `'if-empty'`: 칸반/스프린트가 비어 있을 때만 기동 (최초 부트스트랩 용도).
   *   이미 태스크나 스프린트가 있으면 기동을 건너뛴다 — 재시작 시 중복 계획/덮어쓰기 방지.
   * - `'always'`: 상태와 무관하게 항상 기동 (재계획 강제).
   * - `false`: 절대 기동하지 않음 (테스트 격리·수동 제어).
   */
  autoStartCeo?: boolean | 'if-empty' | 'always';
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
  /**
   * 역할 단위 직렬화 락. taskId → 디스패치 시점의 assignee 역할.
   * tmux 세션명이 역할 기반(`ip-<role>`)이라 같은 역할의 태스크를 동시에 실행하면
   * `duplicate session` 에러가 난다. 한 역할당 태스크 1개만 워크플로우에 진입시킨다.
   */
  private processingRoles: Map<string, string> = new Map();
  private workflowAborters: Map<string, AbortController> = new Map();
  /**
   * 디스패치된 워크플로우 promise 추적. 인터럽트 시 락(processingTasks/processingRoles)을
   * 즉시 풀어 새 메시지 세션이 같은 역할로 진입할 수 있게 하더라도, 원래 워크플로우의
   * 비동기 후처리(파일시스템 쓰기 등)는 여전히 살아있다. stop() 의 drain 단계에서
   * 이 promise 들이 모두 settle 될 때까지 기다려야 cleanup 단계와의 race 를 막을 수 있다.
   */
  private workflowPromises: Set<Promise<void>> = new Set();
  private processedMessages: Set<string> = new Set();
  private running = false;

  private readonly dashboardPort: number;
  private readonly dashboardEnabled: boolean;
  private readonly keepAliveEnabled: boolean;
  private readonly autoStartCeoPolicy: boolean | 'if-empty' | 'always';
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
    this.autoStartCeoPolicy = options?.autoStartCeo ?? true;
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
    const ceoStarted = await this.maybeStartCeo();

    // 7. 파일 워처 시작 (kanban.json 변경 감지)
    this.startWatcher();

    // 8. 메시지 워처 시작 (messages/ 디렉토리 감지)
    this.startMessageWatcher();

    // 9a. 이전 실행에서 in_progress/testing/review 로 남은 고아 태스크를 먼저 재개
    //     (크래시·비정상 종료·옛 버그로 방치된 태스크를 저장된 phase 부터 이어 실행)
    try {
      await this.resumeInFlightTasks();
    } catch (err) {
      logger.error(`고아 태스크 재개 오류: ${(err as Error).message}`);
    }

    // 9b. 기존 todo 태스크 초기 스캔 (워처는 변경만 감지하므로 기존 태스크 처리 필요)
    try {
      await this.processNewTasks();
    } catch (err) {
      logger.error(`초기 태스크 스캔 오류: ${(err as Error).message}`);
    }

    logger.success('PerpetualEngine가 시작되었습니다!');
    if (ceoStarted) {
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
   * processingTasks 가 비워지고 추적 중인 워크플로우 promise 가 settle 될 때까지 짧게 대기.
   * 인터럽트 경로(urgent 메시지)는 락을 즉시 풀고 새 세션을 띄우지만 원래 워크플로우의
   * 비동기 후처리는 살아있다 — promise 까지 기다려야 cleanup 과의 race 를 차단할 수 있다.
   */
  private async drainProcessingTasks(maxWaitMs = 1500): Promise<void> {
    const start = Date.now();
    while (
      (this.processingTasks.size > 0 || this.workflowPromises.size > 0) &&
      Date.now() - start < maxWaitMs
    ) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (this.workflowPromises.size > 0) {
      // 시간 초과 후에도 살아남은 promise 는 settle 까지 기다려준다 (allSettled 는 throw 하지 않음).
      await Promise.allSettled(Array.from(this.workflowPromises));
    }
  }

  /**
   * `autoStartCeo` 정책에 따라 CEO 세션을 조건부로 기동한다.
   * @returns CEO 세션을 실제로 시작했으면 true
   */
  private async maybeStartCeo(): Promise<boolean> {
    const policy = this.autoStartCeoPolicy;
    if (policy === false) return false;

    if (policy === 'always') {
      await this.startCEO();
      return true;
    }

    // 'if-empty' 또는 true (기본): 칸반·스프린트가 모두 비어 있을 때만 기동
    const [tasks, sprints] = await Promise.all([
      this.kanban.getAllTasks(),
      this.sprintManager.getAllSprints(),
    ]);
    if (tasks.length === 0 && sprints.length === 0) {
      await this.startCEO();
      return true;
    }

    logger.info(
      `기존 태스크 ${tasks.length}개, 스프린트 ${sprints.length}개 감지 — CEO 자동 기동 건너뜀 ` +
      `(재계획이 필요하면 \`perpetual-engine start --force-ceo\`)`,
    );
    return false;
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

    const busyRoles = new Set(this.processingRoles.values());

    for (const task of pendingTasks) {
      // 의존성 확인
      const depsCompleted = await this.checkDependencies(task, tasks);
      if (!depsCompleted) continue;

      // 역할 단위 직렬화: 같은 역할(assignee)이 이미 워크플로우를 진행 중이면 대기
      const lockRole = task.assignee;
      if (lockRole && busyRoles.has(lockRole)) {
        logger.step(`[${task.id}] ${lockRole} 작업 중 — 대기`);
        continue;
      }

      this.dispatchWorkflow(task, `새 태스크 감지: ${task.id} - ${task.title}`);
      if (lockRole) busyRoles.add(lockRole);
    }
  }

  /**
   * 서버 기동 시 `in_progress`/`testing`/`review` 상태로 남은 고아 태스크를
   * 저장된 `task.phase` 부터 재개한다. 이전 실행에서 비정상 종료(크래시/Ctrl+C)
   * 되거나, 옛 버그로 false-success 처리된 태스크가 방치되지 않도록 한다.
   *
   * - 실제 tmux 세션이 이미 살아있으면 건드리지 않음 (다른 경로가 처리 중)
   * - 같은 역할 락은 `processNewTasks` 와 동일하게 `processingRoles` 로 직렬화
   * - 기동 시에만 1회 호출 — 런타임 디스패치 경로는 그대로 유지
   */
  private async resumeInFlightTasks(): Promise<void> {
    const tasks = await this.kanban.getAllTasks();
    const resumeStatuses = new Set(['in_progress', 'testing', 'review'] as const);
    const candidates = tasks.filter(
      t => resumeStatuses.has(t.status as 'in_progress' | 'testing' | 'review')
        && !this.processingTasks.has(t.id)
        && t.assignee,
    );

    if (candidates.length === 0) return;

    const busyRoles = new Set(this.processingRoles.values());

    for (const task of candidates) {
      const lockRole = task.assignee!;

      // 실제 tmux 세션이 살아있다면 방치가 아님 — 재개하지 않는다.
      if (await this.sessionManager.isAgentRunning(lockRole)) {
        logger.step(`[${task.id}] ${lockRole} 세션 이미 활성 — 재개 건너뜀`);
        continue;
      }

      if (busyRoles.has(lockRole)) {
        logger.step(`[${task.id}] ${lockRole} 작업 중 — 재개 대기`);
        continue;
      }

      this.dispatchWorkflow(
        task,
        `고아 태스크 재개: ${task.id} - ${task.title} (phase: ${task.phase ?? 'planning'})`,
      );
      busyRoles.add(lockRole);
    }
  }

  /**
   * 공통 디스패치 경로. `processingTasks`/`processingRoles`/`workflowAborters` 를
   * 세팅하고 비동기로 워크플로우를 실행한다. 종료 시 락을 해제하고
   * 대기 중인 태스크가 있으면 다음 스캔을 트리거한다.
   */
  private dispatchWorkflow(task: Task, announceMessage: string): void {
    const lockRole = task.assignee;

    this.processingTasks.add(task.id);
    if (lockRole) {
      this.processingRoles.set(task.id, lockRole);
    }
    logger.info(announceMessage);

    const aborter = new AbortController();
    this.workflowAborters.set(task.id, aborter);
    const release = (): void => {
      this.processingTasks.delete(task.id);
      this.processingRoles.delete(task.id);
      this.workflowAborters.delete(task.id);
      // 락이 풀리면 다음 대기 태스크를 즉시 디스패치 (kanban 파일 이벤트가 누락돼도 진행되도록)
      if (this.running) {
        this.processNewTasks().catch(err => {
          logger.error(`태스크 처리 오류: ${(err as Error).message}`);
        });
      }
    };
    const promise = this.workflowEngine.runWorkflow(task, aborter.signal)
      .then(release)
      .catch(err => {
        logger.error(`[${task.id}] 워크플로우 실패: ${(err as Error).message}`);
        release();
      });
    this.workflowPromises.add(promise);
    promise.finally(() => this.workflowPromises.delete(promise));
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
    // MessageQueue.getAll() 은 priority(urgent 먼저) → created_at 순으로 정렬해 반환한다.
    // 따라서 unread 를 그대로 순회하면 사용자(investor) 가 보낸 urgent 메시지가
    // 백그라운드 자동화 메시지보다 항상 먼저 디스패치된다.
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

      // 회의 초대 메시지 처리 (다중 참여자)
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

      // urgent directive/request 는 진행 중인 동일 역할 워크플로우를 인터럽트해서
      // 즉시 처리한다. 인터럽트된 태스크는 phase 를 보존한 채 todo 로 복구되어
      // 메시지 세션 종료 후 칸반 워처가 픽업하면 저장된 phase 부터 재개된다.
      if (
        msg.priority === 'urgent' &&
        (msg.type === 'directive' || msg.type === 'request')
      ) {
        await this.interruptRoleForUrgentMessage(targetRole, msg);
      }

      const tag = msg.priority === 'urgent' ? ' [urgent]' : '';
      logger.info(`메시지 전달${tag}: "${msg.content}" → ${targetRole}`);

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
   * urgent 사용자 메시지 처리 직전에 호출. 같은 역할로 진행 중인 워크플로우가
   * 있으면 abort 하고 락을 즉시 풀어준다. 태스크 자체는 phase 를 유지한 채
   * `todo` 로 되돌려, 메시지 세션이 끝나면 다음 칸반 이벤트에서 자연스럽게
   * 재픽업되어 저장된 phase 부터 이어 실행된다.
   */
  private async interruptRoleForUrgentMessage(role: string, msg: Message): Promise<void> {
    const activeTaskId = this.findActiveTaskForRole(role);
    if (!activeTaskId) return;

    logger.warn(
      `[urgent] ${role} 진행 중 태스크 ${activeTaskId} 인터럽트 — ` +
      `사용자 메시지 우선 처리 (msg id=${msg.id})`,
    );

    // 1) 진행 중인 워크플로우에 중단 신호 → executePhase 폴링이 다음 tick 에 깨어나 종료된다
    this.workflowAborters.get(activeTaskId)?.abort();

    // 2) 워크플로우의 dispatchWorkflow.release() 콜백이 락을 정리할 때까지 짧게 대기.
    //    이렇게 해야 후속 kanban.moveTask('todo') 가 워크플로우의 마지막 파일시스템
    //    동작과 race 하지 않는다 (인터럽트 후 cleanup ENOENT 의 주된 원인).
    const drainStart = Date.now();
    while (this.workflowAborters.has(activeTaskId) && Date.now() - drainStart < 500) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    // 3) 시간 내 정리되지 않으면 강제로 락 해제 — 메시지 세션이 같은 역할의 tmux 세션을
    //    시작해야 하므로 무한정 기다리지 않는다.
    this.workflowAborters.delete(activeTaskId);
    this.processingTasks.delete(activeTaskId);
    this.processingRoles.delete(activeTaskId);

    // 4) task.phase 는 그대로 두고 status 만 todo 로 복구해 재픽업 가능하게 만든다.
    //    WorkflowEngine 은 abort 시 final 상태 전환을 하지 않으므로 외부가 책임진다.
    try {
      await this.kanban.moveTask(activeTaskId, 'todo');
    } catch (err) {
      logger.error(`인터럽트 중 태스크 상태 복구 실패: ${(err as Error).message}`);
    }
  }

  /** processingRoles 를 역으로 훑어 해당 역할의 활성 태스크 id 를 찾는다. */
  private findActiveTaskForRole(role: string): string | undefined {
    for (const [taskId, lockRole] of this.processingRoles) {
      if (lockRole === role) return taskId;
    }
    return undefined;
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
    if (task.assignee) {
      this.processingRoles.set(taskId, task.assignee);
    }

    const aborter = new AbortController();
    this.workflowAborters.set(taskId, aborter);
    const release = (): void => {
      this.processingTasks.delete(taskId);
      this.processingRoles.delete(taskId);
      this.workflowAborters.delete(taskId);
      if (this.running) {
        this.processNewTasks().catch(err => {
          logger.error(`태스크 처리 오류: ${(err as Error).message}`);
        });
      }
    };
    const promise = this.workflowEngine.runWorkflow(task, aborter.signal)
      .then(release)
      .catch(err => {
        logger.error(`[${taskId}] 워크플로우 실패: ${(err as Error).message}`);
        release();
      });
    this.workflowPromises.add(promise);
    promise.finally(() => this.workflowPromises.delete(promise));
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
    this.processingRoles.delete(taskId);

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
