import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  runComponentTests,
  persistTestOutput,
} from '../../../src/core/workflow/test-runner.js';
import {
  componentTestOutputPath,
  type ComponentManifest,
  type ComponentSpec,
} from '../../../src/core/workflow/components.js';

function makeManifest(unitCmd: string, uiCmd: string): ComponentManifest {
  return {
    version: 1,
    task_id: 'TASK-T',
    tech_stack: {
      framework: 'react+vite',
      test_runners: {
        unit: { tool: 'vitest', command: unitCmd },
        ui: { tool: 'rtl', command: uiCmd },
      },
    },
    components: [
      {
        name: 'Btn',
        slug: 'btn',
        description: 'b',
        implementation_paths: ['src/Btn.tsx'],
        test_paths: {
          unit: 'src/__tests__/Btn.test.ts',
          ui: 'src/__tests__/Btn.ui.test.tsx',
        },
      },
    ],
  };
}

describe('runComponentTests', () => {
  it('모든 명령이 성공하면 allPassed=true 와 결과 2건 반환', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pe-runner-'));
    try {
      const manifest = makeManifest('true', 'true');
      const spec = manifest.components[0];
      const result = await runComponentTests({ projectRoot: dir, manifest, spec });
      expect(result.allPassed).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results.map(r => r.kind)).toEqual(['unit', 'ui']);
      for (const r of result.results) {
        expect(r.passed).toBe(true);
        expect(r.exitCode).toBe(0);
      }
      expect(result.markdown).toContain('✅ 모두 통과');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('첫 명령이 실패하면 거기서 멈추고 allPassed=false', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pe-runner-'));
    try {
      const manifest = makeManifest('false', 'true');
      const spec = manifest.components[0];
      const result = await runComponentTests({ projectRoot: dir, manifest, spec });
      expect(result.allPassed).toBe(false);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].kind).toBe('unit');
      expect(result.results[0].passed).toBe(false);
      expect(result.markdown).toContain('❌ 실패');
      expect(result.markdown).toContain('## 다음 행동');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('command 가 없는 종류는 실행을 건너뛰고 (모든 종류가 그렇다면) allPassed=true', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pe-runner-'));
    try {
      // tech_stack.test_runners 가 모두 도구명 문자열만 — 자동 실행 대상 0개
      const manifest: ComponentManifest = {
        version: 1,
        task_id: 'T',
        tech_stack: {
          framework: 'x',
          test_runners: { unit: 'vitest', ui: 'rtl' },
        },
        components: [
          {
            name: 'A',
            slug: 'a',
            description: 'a',
            implementation_paths: ['src/A.tsx'],
            test_paths: {
              unit: 'src/A.test.ts',
              ui: 'src/A.ui.test.tsx',
            },
          },
        ],
      };
      const spec = manifest.components[0];
      const result = await runComponentTests({ projectRoot: dir, manifest, spec });
      expect(result.allPassed).toBe(true);
      expect(result.results).toHaveLength(0);
      expect(result.markdown).toContain('자동 실행을 건너뛰었습니다');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('명령이 타임아웃을 초과하면 timedOut=true 와 실패', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pe-runner-'));
    try {
      const manifest = makeManifest('sleep 5', 'true');
      const spec = manifest.components[0];
      const result = await runComponentTests({
        projectRoot: dir,
        manifest,
        spec,
        timeoutMsPerTest: 200,
      });
      expect(result.allPassed).toBe(false);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].timedOut).toBe(true);
      expect(result.results[0].passed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AbortSignal 이 미리 abort 되어 있으면 즉시 종료한다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pe-runner-'));
    try {
      const manifest = makeManifest('true', 'true');
      const spec = manifest.components[0];
      const ac = new AbortController();
      ac.abort();
      const result = await runComponentTests({
        projectRoot: dir, manifest, spec, signal: ac.signal,
      });
      // 최소한 무한 대기로 빠지지 않는다 — 결과는 0건 또는 실패한 1건
      expect(result.allPassed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('persistTestOutput', () => {
  it('마크다운 결과를 정확한 경로에 저장한다', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pe-runner-'));
    try {
      const manifest = makeManifest('true', 'true');
      const spec: ComponentSpec = manifest.components[0];
      const result = await runComponentTests({ projectRoot: dir, manifest, spec });
      const rel = await persistTestOutput(dir, 'task-t', result);
      expect(rel).toBe(componentTestOutputPath('task-t', spec.slug));
      const full = path.join(dir, rel);
      expect(existsSync(full)).toBe(true);
      const body = readFileSync(full, 'utf-8');
      expect(body).toContain('컴포넌트 `btn` 테스트 실행 결과');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
