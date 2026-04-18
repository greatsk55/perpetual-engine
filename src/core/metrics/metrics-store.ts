import { FileStore } from '../state/file-store.js';
import type {
  MetricsStore,
  TaskMetrics,
  MetricsPlan,
  MetricsEvaluation,
} from './types.js';

/**
 * `metrics.json` 엔트리가 MetricsManager 가 기대하는 `{ plan, evaluations }` 스키마인지 확인.
 * 에이전트가 자유 형식(예: `{ status, metrics_achieved }`)으로 기록한 레거시/손상 데이터는
 * false 를 반환해서 평가 루틴이 크래시하지 않도록 한다.
 */
function isTaskMetrics(value: unknown): value is TaskMetrics {
  if (!value || typeof value !== 'object') return false;
  const v = value as { plan?: unknown; evaluations?: unknown };
  if (!v.plan || typeof v.plan !== 'object') return false;
  const plan = v.plan as { metrics?: unknown; checkpoints?: unknown };
  if (!Array.isArray(plan.metrics)) return false;
  if (!Array.isArray(plan.checkpoints)) return false;
  if (!Array.isArray(v.evaluations)) return false;
  return true;
}

export class MetricsManager {
  private store: FileStore<MetricsStore>;

  constructor(filePath: string) {
    this.store = new FileStore<MetricsStore>(filePath);
  }

  /** 메트릭스 저장소 전체 읽기 */
  async getAll(): Promise<MetricsStore> {
    try {
      return await this.store.read();
    } catch {
      return { tasks: {} };
    }
  }

  /** 특정 태스크의 메트릭스 조회 (스키마 불일치 엔트리는 null 로 취급) */
  async getTaskMetrics(taskId: string): Promise<TaskMetrics | null> {
    const data = await this.getAll();
    const entry = data.tasks?.[taskId];
    if (!entry) return null;
    if (!isTaskMetrics(entry)) return null;
    return entry;
  }

  /** 태스크에 메트릭스 계획 등록 */
  async setPlan(taskId: string, plan: MetricsPlan): Promise<void> {
    await this.store.update((data) => {
      if (!data.tasks[taskId]) {
        data.tasks[taskId] = { plan, evaluations: [] };
      } else {
        data.tasks[taskId].plan = plan;
      }
      return data;
    });
  }

  /** 평가 결과 추가 */
  async addEvaluation(taskId: string, evaluation: MetricsEvaluation): Promise<void> {
    await this.store.update((data) => {
      if (!data.tasks[taskId]) {
        throw new Error(`태스크 ${taskId}에 메트릭스 계획이 없습니다. 먼저 setPlan을 호출하세요.`);
      }
      data.tasks[taskId].evaluations.push(evaluation);
      return data;
    });
  }

  /** 평가가 필요한 태스크 목록 (체크포인트 또는 종료일 도래) */
  async getTasksNeedingEvaluation(): Promise<string[]> {
    const data = await this.getAll();
    const now = new Date().toISOString();
    const result: string[] = [];
    const tasks = data.tasks ?? {};

    for (const [taskId, metrics] of Object.entries(tasks)) {
      // 에이전트가 프레임워크 스키마(plan/evaluations) 밖으로 자유 서술한 경우를 방어.
      // MetricsManager 는 { plan, evaluations } 형태만 평가 대상으로 본다.
      if (!isTaskMetrics(metrics)) continue;

      const { plan, evaluations } = metrics;

      // 이미 최종 평가가 끝났으면 스킵
      if (evaluations.some(e => e?.type === 'final')) continue;

      // 측정 종료일이 지났으면 최종 평가 필요
      if (plan.measurement_end && plan.measurement_end <= now) {
        result.push(taskId);
        continue;
      }

      // 체크포인트 도래 확인
      const evaluatedCheckpoints = new Set(
        evaluations
          .filter(e => e?.type === 'checkpoint' && typeof e.evaluated_at === 'string')
          .map(e => e.evaluated_at.slice(0, 10)),
      );
      const dueCheckpoints = plan.checkpoints.filter(
        cp => typeof cp === 'string' && cp <= now && !evaluatedCheckpoints.has(cp.slice(0, 10)),
      );
      if (dueCheckpoints.length > 0) {
        result.push(taskId);
      }
    }

    return result;
  }

  /** 특정 태스크의 최신 평가 결과 조회 */
  async getLatestEvaluation(taskId: string): Promise<MetricsEvaluation | null> {
    const metrics = await this.getTaskMetrics(taskId);
    if (!metrics || metrics.evaluations.length === 0) return null;
    return metrics.evaluations[metrics.evaluations.length - 1];
  }

  /** 메트릭스 계획이 있는 모든 태스크 ID 반환 */
  async getTrackedTaskIds(): Promise<string[]> {
    const data = await this.getAll();
    return Object.keys(data.tasks);
  }
}
