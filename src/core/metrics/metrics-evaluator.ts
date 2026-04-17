import { nanoid } from 'nanoid';
import type {
  MetricDefinition,
  MetricResult,
  MetricsEvaluation,
  EvaluationVerdict,
  EvaluationAction,
  MetricsPlan,
} from './types.js';

/**
 * 메트릭스 평가기.
 *
 * 기획의 측정 지표를 기반으로 달성도를 계산하고
 * 자동으로 판정(verdict)과 다음 행동(action)을 결정한다.
 *
 * 판정 기준:
 * - exceeded (>=120%): 목표 초과 → scale_up
 * - achieved (>=100%): 목표 달성 → maintain
 * - improving (>=60%): 개선 중 → iterate
 * - stagnant (>=30%): 정체 → pivot
 * - failed (<30%): 실패 → kill
 */
export class MetricsEvaluator {
  /**
   * 단일 지표의 달성률 계산.
   * direction에 따라 계산 방식이 달라진다.
   */
  calculateAchievement(metric: MetricDefinition, actual: number): number {
    const { baseline, target, direction } = metric;
    const range = Math.abs(target - baseline);

    // baseline과 target이 같으면 목표 자체가 없는 것 (100% 반환)
    if (range === 0) return 100;

    if (direction === 'higher') {
      // 높을수록 좋음: (실제 - baseline) / (target - baseline) * 100
      const progress = actual - baseline;
      const goal = target - baseline;
      return (progress / goal) * 100;
    } else {
      // 낮을수록 좋음: (baseline - 실제) / (baseline - target) * 100
      const progress = baseline - actual;
      const goal = baseline - target;
      return (progress / goal) * 100;
    }
  }

  /** 전체 지표의 가중 평균 달성률 (균등 가중) */
  calculateOverallAchievement(results: MetricResult[]): number {
    if (results.length === 0) return 0;
    const sum = results.reduce((acc, r) => acc + r.achievement_rate, 0);
    return Math.round((sum / results.length) * 100) / 100;
  }

  /** 달성률로부터 판정 결정 */
  getVerdict(overallAchievement: number): EvaluationVerdict {
    if (overallAchievement >= 120) return 'exceeded';
    if (overallAchievement >= 100) return 'achieved';
    if (overallAchievement >= 60) return 'improving';
    if (overallAchievement >= 30) return 'stagnant';
    return 'failed';
  }

  /** 판정으로부터 다음 행동 결정 */
  getAction(verdict: EvaluationVerdict, type: 'checkpoint' | 'final'): EvaluationAction {
    // 중간 체크포인트에서는 더 관대하게 판단 (아직 시간이 남았으므로)
    if (type === 'checkpoint') {
      switch (verdict) {
        case 'exceeded': return 'scale_up';
        case 'achieved': return 'maintain';
        case 'improving': return 'iterate';
        case 'stagnant': return 'iterate'; // 중간에는 pivot 대신 한번 더 기회
        case 'failed': return 'pivot';     // 중간에는 kill 대신 pivot
      }
    }

    // 최종 평가는 엄격하게
    switch (verdict) {
      case 'exceeded': return 'scale_up';
      case 'achieved': return 'maintain';
      case 'improving': return 'iterate';
      case 'stagnant': return 'pivot';
      case 'failed': return 'kill';
    }
  }

  /** 판정별 한국어 설명 생성 */
  generateReasoning(
    verdict: EvaluationVerdict,
    action: EvaluationAction,
    results: MetricResult[],
    plan: MetricsPlan,
    type: 'checkpoint' | 'final',
  ): string {
    const lines: string[] = [];
    const typeLabel = type === 'checkpoint' ? '중간 평가' : '최종 평가';

    lines.push(`## ${typeLabel} 결과`);
    lines.push(`가설: ${plan.hypothesis}`);
    lines.push('');

    // 지표별 결과
    lines.push('### 지표별 달성도');
    for (const r of results) {
      const matchingDef = plan.metrics.find(m => m.name === r.name);
      const status = r.achievement_rate >= 100 ? 'PASS' : 'MISS';
      lines.push(
        `- ${r.name}: ${r.actual}${matchingDef?.unit ?? ''} ` +
        `(목표: ${matchingDef?.target ?? '?'}${matchingDef?.unit ?? ''}, ` +
        `달성: ${r.achievement_rate.toFixed(1)}%) [${status}]`,
      );
    }
    lines.push('');

    // 판정 및 행동
    const verdictLabels: Record<EvaluationVerdict, string> = {
      exceeded: '목표 초과 달성',
      achieved: '목표 달성',
      improving: '개선 중 (미달)',
      stagnant: '정체',
      failed: '실패',
    };
    const actionLabels: Record<EvaluationAction, string> = {
      scale_up: '확대 투자 - 더 많은 리소스를 투입하여 성과를 극대화',
      maintain: '현상 유지 - 현재 전략을 유지하며 안정화',
      iterate: '반복 개선 - 방향은 유지하되 실행 방법을 보완',
      pivot: '방향 전환 - 근본적으로 접근 방식을 변경',
      kill: '폐기 - 이 기획을 중단하고 리소스를 다른 곳에 투입',
    };

    lines.push(`### 판정: ${verdictLabels[verdict]}`);
    lines.push(`### 다음 행동: ${actionLabels[action]}`);

    return lines.join('\n');
  }

  /** 전체 평가 수행 */
  evaluate(params: {
    taskId: string;
    plan: MetricsPlan;
    actuals: Array<{ name: string; actual: number }>;
    type: 'checkpoint' | 'final';
  }): MetricsEvaluation {
    const { taskId, plan, actuals, type } = params;

    // 각 지표 결과 계산
    const results: MetricResult[] = actuals.map(({ name, actual }) => {
      const def = plan.metrics.find(m => m.name === name);
      if (!def) {
        return { name, actual, achievement_rate: 0 };
      }
      const achievement_rate = this.calculateAchievement(def, actual);
      return { name, actual, achievement_rate: Math.round(achievement_rate * 100) / 100 };
    });

    const overall = this.calculateOverallAchievement(results);
    const verdict = this.getVerdict(overall);
    const action = this.getAction(verdict, type);
    const reasoning = this.generateReasoning(verdict, action, results, plan, type);

    return {
      id: `eval-${nanoid(8)}`,
      task_id: taskId,
      evaluated_at: new Date().toISOString(),
      type,
      results,
      overall_achievement: overall,
      verdict,
      action,
      reasoning,
    };
  }
}
