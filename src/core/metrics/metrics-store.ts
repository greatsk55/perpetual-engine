import { FileStore } from '../state/file-store.js';
import type {
  MetricsStore,
  TaskMetrics,
  MetricsPlan,
  MetricsEvaluation,
} from './types.js';

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

  /** 특정 태스크의 메트릭스 조회 */
  async getTaskMetrics(taskId: string): Promise<TaskMetrics | null> {
    const data = await this.getAll();
    return data.tasks[taskId] ?? null;
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

    for (const [taskId, metrics] of Object.entries(data.tasks)) {
      const { plan, evaluations } = metrics;

      // 이미 최종 평가가 끝났으면 스킵
      if (evaluations.some(e => e.type === 'final')) continue;

      // 측정 종료일이 지났으면 최종 평가 필요
      if (plan.measurement_end <= now) {
        result.push(taskId);
        continue;
      }

      // 체크포인트 도래 확인
      const evaluatedCheckpoints = new Set(
        evaluations.filter(e => e.type === 'checkpoint').map(e => e.evaluated_at.slice(0, 10)),
      );
      const dueCheckpoints = plan.checkpoints.filter(
        cp => cp <= now && !evaluatedCheckpoints.has(cp.slice(0, 10)),
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
