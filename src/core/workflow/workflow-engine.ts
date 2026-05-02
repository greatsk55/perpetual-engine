import {
  buildPhases,
  findPhase,
  phaseInstanceKey,
  resolvePhaseAlias,
  DEFAULT_PHASE_TIMEOUT_MS,
  type Phase,
} from './phases.js';
import { readComponentManifest, type ComponentManifest } from './components.js';
import { runComponentTests, persistTestOutput } from './test-runner.js';
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
    const taskSlug = String(task.id).toLowerCase().replace(/[^a-z0-9]/g, '-');
    const startPhase: WorkflowPhase = resolvePhaseAlias(task.phase) ?? 'planning';

    // 매니페스트는 development-plan 이 산출하므로 시작 시점에는 없을 수 있다.
    // 페이즈 배열은 매니페스트 유무에 따라 동적으로 펼쳐진다.
    let manifest = await readComponentManifest(this.projectRoot, taskSlug);
    let phases = buildPhases(taskSlug, manifest);

    // 시작 페이즈를 페이즈 배열에서 찾아 인덱스로 진입한다.
    // 동일 name 의 페이즈가 여러 개일 수 있으므로 (development-component) 처음 인스턴스를 사용.
    let cursor = findPhase(phases, startPhase)?.index ?? 0;

    let workflowSucceeded = false;
    const retryCount: Map<string, number> = new Map();

    const aborted = () => signal?.aborted === true;

    try {
      while (cursor < phases.length) {
        if (aborted()) break;
        const phase = phases[cursor];

        // 재시도 횟수 체크 — 컴포넌트 페이즈는 instanceKey 가 다르면 별도로 카운트
        const retryKey = phaseInstanceKey(phase);
        const attempts = retryCount.get(retryKey) ?? 0;
        if (attempts >= WorkflowEngine.MAX_PHASE_RETRIES) {
          logger.error(`[${task.id}] ${retryKey} 최대 재시도 횟수(${WorkflowEngine.MAX_PHASE_RETRIES}) 초과`);
          break;
        }
        retryCount.set(retryKey, attempts + 1);

        const labelSuffix = phase.instanceKey ? `(${phase.instanceKey})` : '';
        logger.step(
          `[${task.id}] ${phase.name}${labelSuffix} 페이즈 시작 (담당: ${phase.leadAgent})` +
            (attempts > 0 ? ` [재시도 ${attempts}/${WorkflowEngine.MAX_PHASE_RETRIES}]` : ''),
        );

        await this.kanban.updateTaskPhase(task.id, phase.name, phase.leadAgent);
        if (aborted()) break;
        await this.kanban.moveTask(task.id, phase.taskStatus);
        if (aborted()) break;

        const success = await this.executePhase(task, phase, signal, manifest, taskSlug);
        if (aborted()) break;

        if (success) {
          logger.success(`[${task.id}] ${phase.name}${labelSuffix} 페이즈 완료`);

          // development-plan 직후 매니페스트가 새로 생겼다면 페이즈 배열을 재구축해서
          // development-component (N개) + development-integrate 를 펼친다.
          if (phase.name === 'development-plan' && !manifest) {
            const fresh = await readComponentManifest(this.projectRoot, taskSlug);
            if (fresh) {
              manifest = fresh;
              phases = buildPhases(taskSlug, manifest);
              const next = findPhase(phases, 'development-component');
              cursor = next ? next.index : cursor + 1;
              logger.info(
                `[${task.id}] 컴포넌트 매니페스트 로드 — ${manifest.components.length}개 컴포넌트로 페이즈 펼침`,
              );
              continue;
            }
            logger.warn(`[${task.id}] development-plan 완료했으나 매니페스트 누락 — 다음 페이즈로 직진`);
          }

          cursor += 1;
          if (cursor >= phases.length) {
            workflowSucceeded = true;
          }
        } else if (phase.onFailure) {
          logger.warn(`[${task.id}] ${phase.name}${labelSuffix} 실패 → ${phase.onFailure} 로 재시도`);
          // 재시도는 같은 instance 로 재진입한다.
          const retryTarget = findPhase(phases, phase.onFailure, phase.instanceKey)
            ?? findPhase(phases, phase.onFailure);
          if (!retryTarget) {
            logger.error(`[${task.id}] ${phase.onFailure} 페이즈를 찾을 수 없어 회귀 불가`);
            break;
          }
          cursor = retryTarget.index;
        } else {
          logger.error(`[${task.id}] ${phase.name}${labelSuffix} 실패, 회귀 불가`);
          break;
        }
      }
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

  private async executePhase(
    task: Task,
    phase: Phase,
    signal?: AbortSignal,
    manifest?: ComponentManifest | null,
    taskSlug?: string,
  ): Promise<boolean> {
    const agent = this.agentRegistry.get(phase.leadAgent);
    if (!agent) {
      logger.error(`에이전트를 찾을 수 없습니다: ${phase.leadAgent}`);
      return false;
    }

    // 칸반 현황 생성
    const allTasks = await this.kanban.getAllTasks();
    const { PromptBuilder } = await import('../agent/prompt-builder.js');
    const builder = new PromptBuilder();
    const kanbanSummary = builder.buildKanbanSummary(allTasks);

    // 에이전트 세션 시작 — 산출물 경로/완료 조건을 명시해 파일명 불일치로 인한 재시도 루프 방지
    await this.sessionManager.startAgent({
      agent,
      config: this.config,
      task,
      contextDocs: phase.inputDocPaths,
      kanbanSummary,
      projectRoot: this.projectRoot,
      expectedOutputs: phase.outputDocPaths,
      completionCriteria: phase.completionCriteria,
      phaseName: phase.name,
      componentSpec: phase.componentContext,
    });

    // 세션 완료 대기 (폴링) — 페이즈별 타임아웃 적용
    const timeoutMs = phase.timeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS;
    const completed = await this.waitForCompletion(agent.role, timeoutMs, signal);
    if (!completed) return false;
    if (signal?.aborted) return false;

    // 산출물 존재 여부 검증
    if (phase.outputDocPaths.length > 0) {
      const missing = await this.checkOutputs(phase.outputDocPaths);
      if (missing.length > 0) {
        const label = phase.instanceKey ? `${phase.name}(${phase.instanceKey})` : phase.name;
        logger.error(`[${task.id}] ${label} 산출물 누락: ${missing.join(', ')}`);
        return false;
      }
    }

    // development-component 페이즈는 산출물 검증을 통과해도 실제 테스트 실행으로
    // 한 번 더 검증한다. tech_stack.test_runners 에 command 가 정의된 종류만 실행하고,
    // 모든 실행 대상이 통과해야 페이즈 완료로 인정한다. 실패하면 결과를
    // docs/development/feature-<slug>/components/<comp>.test-output.md 에 기록해
    // 다음 재시도 세션이 inputDocPaths 로 받아 보고 수정할 수 있게 한다.
    if (
      phase.name === 'development-component' &&
      phase.componentContext &&
      manifest &&
      taskSlug
    ) {
      const label = `${phase.name}(${phase.instanceKey})`;
      logger.step(`[${task.id}] ${label} 테스트 실행 검증 시작`);
      try {
        const result = await runComponentTests({
          projectRoot: this.projectRoot,
          manifest,
          spec: phase.componentContext,
          signal,
        });
        // 결과는 통과/실패 무관하게 항상 파일로 남긴다 — 다음 세션이 보도록.
        const outputPath = await persistTestOutput(this.projectRoot, taskSlug, result);
        if (result.allPassed) {
          if (result.results.length === 0) {
            logger.warn(
              `[${task.id}] ${label} test_runners 에 command 가 없어 자동 실행을 건너뜀 — ` +
              `다음 development-plan 에서 command 를 추가하면 실행 검증됨`,
            );
          } else {
            logger.success(
              `[${task.id}] ${label} 테스트 ${result.results.length}건 모두 통과 (리포트: ${outputPath})`,
            );
          }
          return true;
        }
        const failed = result.results.filter(r => !r.passed).map(r => r.kind).join(', ');
        logger.error(
          `[${task.id}] ${label} 테스트 실패 (${failed}) — 동일 페이즈 자동 재시도 (리포트: ${outputPath})`,
        );
        return false;
      } catch (err) {
        logger.error(`[${task.id}] ${label} 테스트 실행 중 예외: ${(err as Error).message}`);
        return false;
      }
    }

    return true;
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
