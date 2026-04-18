import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MetricsManager } from '../../../src/core/metrics/metrics-store.js';

describe('MetricsManager — 레거시/자유 형식 엔트리 방어', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ip-metrics-${Date.now()}-${Math.random()}`);
    await mkdir(tmpDir, { recursive: true });
    filePath = path.join(tmpDir, 'metrics.json');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('tasks 엔트리에 plan/evaluations 이 없어도 크래시하지 않는다', async () => {
    // CEO 에이전트가 자유 서술로 쓴 실제 관측 스키마 재현
    await writeFile(filePath, JSON.stringify({
      tasks: {
        '1': { status: 'completed', metrics_achieved: {} },
        '2': { status: 'in_progress', metrics_progress: {} },
      },
    }));
    const m = new MetricsManager(filePath);

    await expect(m.getTasksNeedingEvaluation()).resolves.toEqual([]);
    await expect(m.getTaskMetrics('1')).resolves.toBeNull();
  });

  it('최상위 tasks 자체가 없는 파일도 안전하게 처리한다', async () => {
    await writeFile(filePath, JSON.stringify({ sprint: {} }));
    const m = new MetricsManager(filePath);
    await expect(m.getTasksNeedingEvaluation()).resolves.toEqual([]);
  });

  it('정상 스키마 + 측정 종료일 도래 시에만 평가 대상으로 반환한다', async () => {
    const past = '2020-01-01T00:00:00.000Z';
    const future = '2999-01-01T00:00:00.000Z';
    await writeFile(filePath, JSON.stringify({
      tasks: {
        expired: {
          plan: {
            hypothesis: 'h',
            metrics: [],
            measurement_start: past,
            measurement_end: past,
            checkpoints: [],
          },
          evaluations: [],
        },
        active: {
          plan: {
            hypothesis: 'h',
            metrics: [],
            measurement_start: past,
            measurement_end: future,
            checkpoints: [],
          },
          evaluations: [],
        },
        malformed: { status: 'done' },
      },
    }));
    const m = new MetricsManager(filePath);
    const ids = await m.getTasksNeedingEvaluation();
    expect(ids).toEqual(['expired']);
  });
});
