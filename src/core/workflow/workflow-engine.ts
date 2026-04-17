import { WORKFLOW_PHASES, getPhase, type Phase } from './phases.js';
import { SessionManager } from '../session/session-manager.js';
import { AgentRegistry } from '../agent/agent-registry.js';
import { KanbanManager } from '../state/kanban.js';
import { MetricsManager } from '../metrics/metrics-store.js';
import { MetricsEvaluator } from '../metrics/metrics-evaluator.js';
import type { Task, WorkflowPhase } from '../state/types.js';
import type { ProjectConfig } from '../project/config.js';
import { logger } from '../../utils/logger.js';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export class WorkflowEngine {
  private sessionManager: SessionManager;
  private agentRegistry: AgentRegistry;
  private kanban: KanbanManager;
  private metricsManager: MetricsManager;
  private metricsEvaluator: MetricsEvaluator;
  private config: ProjectConfig;
  private projectRoot: string;
  private pollInterval: number;

  constructor(params: {
    sessionManager: SessionManager;
    agentRegistry: AgentRegistry;
    kanban: KanbanManager;
    config: ProjectConfig;
    projectRoot: string;
    metricsManager?: MetricsManager;
    /** 세션 완료 폴링 간격(ms). 테스트에서 짧게 주입하면 워크플로우가 빠르게 종료된다 */
    pollInterval?: number;
  }) {
    this.sessionManager = params.sessionManager;
    this.agentRegistry = params.agentRegistry;
    this.kanban = params.kanban;
    this.config = params.config;
    this.projectRoot = params.projectRoot;
    this.metricsManager = params.metricsManager ??
      new MetricsManager(path.join(params.projectRoot, 'metrics.json'));
    this.metricsEvaluator = new MetricsEvaluator();
    this.pollInterval = params.pollInterval ?? 5000;
  }

  private static MAX_PHASE_RETRIES = 2;

  async runWorkflow(task: Task, signal?: AbortSignal): Promise<void> {
    const startPhase: WorkflowPhase = task.phase ?? 'planning';
    let currentPhaseName: WorkflowPhase | null = startPhase;
    let workflowSucceeded = false;
    const retryCount: Map<WorkflowPhase, number> = new Map();

    const aborted = () => signal?.aborted === true;

    try {
      while (currentPhaseName) {
        if (aborted()) break;
        const phase = getPhase(currentPhaseName);
        if (!phase) break;

        // 재시도 횟수 체크
        const attempts = retryCount.get(phase.name) ?? 0;
        if (attempts >= WorkflowEngine.MAX_PHASE_RETRIES) {
          logger.error(`[${task.id}] ${phase.name} 최대 재시도 횟수(${WorkflowEngine.MAX_PHASE_RETRIES}) 초과`);
          break;
        }
        retryCount.set(phase.name, attempts + 1);

        logger.step(`[${task.id}] ${phase.name} 페이즈 시작 (담당: ${phase.leadAgent})${attempts > 0 ? ` [재시도 ${attempts}/${WorkflowEngine.MAX_PHASE_RETRIES}]` : ''}`);

        // 태스크 상태 업데이트 (페이즈별 칸반 상태 + 담당 에이전트 반영)
        await this.kanban.updateTaskPhase(task.id, phase.name, phase.leadAgent);
        if (aborted()) break;
        await this.kanban.moveTask(task.id, phase.taskStatus);
        if (aborted()) break;

        const success = await this.executePhase(task, phase, signal);
        if (aborted()) break;

        if (success) {
          logger.success(`[${task.id}] ${phase.name} 페이즈 완료`);
          currentPhaseName = phase.nextPhase;
        } else if (phase.onFailure) {
          logger.warn(`[${task.id}] ${phase.name} 실패 → ${phase.onFailure}로 재시도`);
          currentPhaseName = phase.onFailure;
        } else {
          logger.error(`[${task.id}] ${phase.name} 실패, 회귀 불가`);
          break;
        }
      }

      workflowSucceeded = !aborted();
    } catch (err) {
      logger.error(`[${task.id}] 워크플로우 예외 발생: ${(err as Error).message}`);
    }

    // 중단 신호가 걸렸다면 최종 상태 전환을 하지 않는다 — 외부(suspend/stop)가 상태를 관리한다.
    if (aborted()) {
      logger.info(`[${task.id}] 워크플로우 중단됨`);
      return;
    }

    if (workflowSucceeded) {
      await this.kanban.moveTask(task.id, 'done');
      logger.success(`[${task.id}] 워크플로우 완료`);
      await this.runMetricsCheckIfNeeded();
    } else {
      await this.kanban.moveTask(task.id, 'todo');
      logger.warn(`[${task.id}] 워크플로우 실패 → 태스크를 todo로 복구`);
    }
  }

  /** 메트릭스 평가가 필요한 태스크 확인 및 평가 트리거 */
  async runMetricsCheckIfNeeded(): Promise<void> {
    try {
      const taskIds = await this.metricsManager.getTasksNeedingEvaluation();
      if (taskIds.length === 0) return;

      for (const taskId of taskIds) {
        logger.info(`[${taskId}] 메트릭스 평가 필요 - CEO에게 평가 요청`);

        // CEO 에이전트에게 평가를 수행하도록 지시
        const ceoAgent = this.agentRegistry.get('ceo');
        if (!ceoAgent) continue;

        const metrics = await this.metricsManager.getTaskMetrics(taskId);
        if (!metrics) continue;

        const isFinal = new Date(metrics.plan.measurement_end) <= new Date();
        const evalType = isFinal ? '최종 평가' : '중간 체크포인트 평가';

        const allTasks = await this.kanban.getAllTasks();
        const { PromptBuilder } = await import('../agent/prompt-builder.js');
        const builder = new PromptBuilder();
        const kanbanSummary = builder.buildKanbanSummary(allTasks);

        // CEO 세션에 메트릭스 평가 태스크 전달
        await this.sessionManager.startAgent({
          agent: ceoAgent,
          config: this.config,
          kanbanSummary,
          projectRoot: this.projectRoot,
          message: this.buildMetricsEvalInstruction(taskId, metrics, evalType),
        });
      }
    } catch (err) {
      logger.error(`메트릭스 평가 오류: ${(err as Error).message}`);
    }
  }

  /** 메트릭스 평가 지시 메시지 생성 */
  private buildMetricsEvalInstruction(
    taskId: string,
    metrics: { plan: { hypothesis: string; metrics: Array<{ name: string; unit: string; baseline: number; target: number }> } },
    evalType: string,
  ): string {
    const metricsList = metrics.plan.metrics
      .map(m => `  - ${m.name} (현재 baseline: ${m.baseline}${m.unit}, 목표: ${m.target}${m.unit})`)
      .join('\n');

    return `[메트릭스 ${evalType}] 태스크 ${taskId}

가설: ${metrics.plan.hypothesis}

측정 지표:
${metricsList}

다음을 수행하세요:
1. 각 지표의 현재 실제값을 측정/수집하세요
2. docs/metrics/eval-${taskId}-${new Date().toISOString().slice(0, 10)}.md에 평가 리포트를 작성하세요
3. metrics.json을 업데이트하세요
4. 달성률에 따라 다음 행동(scale_up/maintain/iterate/pivot/kill)을 결정하고 실행하세요
   - iterate: 개선 태스크를 kanban에 추가
   - pivot: 새로운 접근법으로 태스크 재생성
   - kill: 관련 태스크를 done으로 마감하고 사유 문서화`;
  }

  private async executePhase(task: Task, phase: Phase, signal?: AbortSignal): Promise<boolean> {
    const agent = this.agentRegistry.get(phase.leadAgent);
    if (!agent) {
      logger.error(`에이전트를 찾을 수 없습니다: ${phase.leadAgent}`);
      return false;
    }

    const taskSlug = String(task.id).toLowerCase().replace(/[^a-z0-9]/g, '-');
    const contextDocs = phase.inputDocPaths(taskSlug);

    // 칸반 현황 생성
    const allTasks = await this.kanban.getAllTasks();
    const { PromptBuilder } = await import('../agent/prompt-builder.js');
    const builder = new PromptBuilder();
    const kanbanSummary = builder.buildKanbanSummary(allTasks);

    // 에이전트 세션 시작
    await this.sessionManager.startAgent({
      agent,
      config: this.config,
      task,
      contextDocs,
      kanbanSummary,
      projectRoot: this.projectRoot,
    });

    // 세션 완료 대기 (폴링)
    const completed = await this.waitForCompletion(agent.role, undefined, signal);
    if (!completed) return false;
    if (signal?.aborted) return false;

    // 산출물 존재 여부 검증
    const outputPaths = phase.outputDocPaths(taskSlug);
    if (outputPaths.length === 0) return true;

    const missing = await this.checkOutputs(outputPaths);
    if (missing.length === 0) return true;

    logger.error(`[${task.id}] ${phase.name} 산출물 누락: ${missing.join(', ')}`);
    return false;
  }

  private async checkOutputs(docPaths: string[]): Promise<string[]> {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const missing: string[] = [];
    for (const docPath of docPaths) {
      const fullPath = join(this.projectRoot, docPath);
      if (!existsSync(fullPath)) {
        missing.push(docPath);
      }
    }
    return missing;
  }

  private async waitForCompletion(role: string, maxWait = 600000, signal?: AbortSignal): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      if (signal?.aborted) return false;
      const isRunning = await this.sessionManager.isAgentRunning(role);
      if (!isRunning) {
        return true; // 세션 종료 = 작업 완료
      }
      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }

    logger.warn(`[${role}] 타임아웃 (${maxWait / 1000}초)`);
    await this.sessionManager.stopAgent(role);
    return false;
  }
}
