import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isComponentManifest,
  componentExpectedOutputs,
  declaredTestKinds,
  executableTestKinds,
  manifestPath,
  techStackDocPath,
  componentTestOutputPath,
  readComponentManifest,
  type ComponentManifest,
} from '../../../src/core/workflow/components.js';

const minimalManifest: ComponentManifest = {
  version: 1,
  task_id: 'TASK-1',
  tech_stack: {
    framework: 'react+vite',
    test_runners: {
      unit: { tool: 'vitest', command: 'npx vitest run --reporter=basic' },
      ui: { tool: '@testing-library/react', command: 'npx vitest run --reporter=basic' },
    },
  },
  components: [
    {
      name: 'LoginButton',
      slug: 'login-button',
      description: '로그인 버튼',
      implementation_paths: ['workspace/src/LoginButton.tsx'],
      test_paths: {
        unit: 'workspace/src/__tests__/LoginButton.test.ts',
        ui: 'workspace/src/__tests__/LoginButton.ui.test.tsx',
      },
    },
  ],
};

const fullManifest: ComponentManifest = {
  ...minimalManifest,
  tech_stack: {
    framework: 'react+vite',
    test_runners: {
      unit: { tool: 'vitest', command: 'npx vitest run' },
      ui: { tool: 'rtl', command: 'npx vitest run --testNamePattern=ui' },
      snapshot: { tool: 'vitest', command: 'npx vitest run -t snapshot' },
      integration: { tool: 'vitest+msw', command: 'npx vitest run integration' },
      e2e: { tool: 'playwright', command: 'npx playwright test' },
    },
  },
  components: [
    {
      ...minimalManifest.components[0],
      test_paths: {
        unit: 'workspace/src/__tests__/LoginButton.test.ts',
        ui: 'workspace/src/__tests__/LoginButton.ui.test.tsx',
        snapshot: 'workspace/src/__tests__/__snapshots__/LoginButton.snap',
        integration: 'workspace/tests/integration/login-button.test.ts',
        e2e: 'workspace/tests/e2e/login-button.spec.ts',
      },
    },
  ],
};

describe('isComponentManifest 가드', () => {
  it('unit + ui 만 있는 최소 매니페스트를 통과시킨다', () => {
    expect(isComponentManifest(minimalManifest)).toBe(true);
  });

  it('5종 모두 있는 매니페스트도 통과시킨다', () => {
    expect(isComponentManifest(fullManifest)).toBe(true);
  });

  it('test_runners 가 문자열(도구명만) 형식이어도 허용한다 (옛 형식 하위 호환)', () => {
    const legacy = JSON.parse(JSON.stringify(minimalManifest));
    legacy.tech_stack.test_runners.unit = 'vitest';
    legacy.tech_stack.test_runners.ui = '@testing-library/react';
    expect(isComponentManifest(legacy)).toBe(true);
  });

  it('null/undefined/원시값을 거부한다', () => {
    expect(isComponentManifest(null)).toBe(false);
    expect(isComponentManifest(undefined)).toBe(false);
    expect(isComponentManifest('foo')).toBe(false);
    expect(isComponentManifest(42)).toBe(false);
  });

  it('version != 1 을 거부한다', () => {
    expect(isComponentManifest({ ...minimalManifest, version: 2 })).toBe(false);
  });

  it('task_id 누락을 거부한다', () => {
    const { task_id: _omit, ...rest } = minimalManifest;
    expect(isComponentManifest(rest)).toBe(false);
  });

  it('test_runners 의 unit 이 누락되면 거부한다', () => {
    const broken = JSON.parse(JSON.stringify(minimalManifest));
    delete broken.tech_stack.test_runners.unit;
    expect(isComponentManifest(broken)).toBe(false);
  });

  it('test_runners 의 ui 가 누락되면 거부한다', () => {
    const broken = JSON.parse(JSON.stringify(minimalManifest));
    delete broken.tech_stack.test_runners.ui;
    expect(isComponentManifest(broken)).toBe(false);
  });

  it('선택 test_runners 가 잘못된 타입이면 거부한다', () => {
    const broken = JSON.parse(JSON.stringify(minimalManifest));
    broken.tech_stack.test_runners.snapshot = 42;
    expect(isComponentManifest(broken)).toBe(false);
  });

  it('컴포넌트의 unit/ui 중 하나라도 누락되면 거부한다', () => {
    const broken = JSON.parse(JSON.stringify(minimalManifest));
    delete broken.components[0].test_paths.unit;
    expect(isComponentManifest(broken)).toBe(false);
  });

  it('선택 test_paths 가 빈 문자열이면 거부한다', () => {
    const broken = JSON.parse(JSON.stringify(minimalManifest));
    broken.components[0].test_paths.snapshot = '';
    expect(isComponentManifest(broken)).toBe(false);
  });

  it('implementation_paths 가 비면 거부한다', () => {
    const broken = JSON.parse(JSON.stringify(minimalManifest));
    broken.components[0].implementation_paths = [];
    expect(isComponentManifest(broken)).toBe(false);
  });

  it('컴포넌트가 0개면 거부한다', () => {
    expect(isComponentManifest({ ...minimalManifest, components: [] })).toBe(false);
  });

  it('slug 가 a-z0-9- 외 문자를 포함하면 거부한다', () => {
    const broken = JSON.parse(JSON.stringify(minimalManifest));
    broken.components[0].slug = 'Login_Button';
    expect(isComponentManifest(broken)).toBe(false);
  });

  it('컴포넌트 slug 가 중복되면 거부한다', () => {
    const dup = JSON.parse(JSON.stringify(minimalManifest));
    dup.components.push({ ...dup.components[0] });
    expect(isComponentManifest(dup)).toBe(false);
  });
});

describe('declaredTestKinds / componentExpectedOutputs', () => {
  it('최소 매니페스트는 unit + ui 만 검증 대상', () => {
    expect(declaredTestKinds(minimalManifest.components[0])).toEqual(['unit', 'ui']);
    expect(componentExpectedOutputs(minimalManifest.components[0])).toEqual([
      'workspace/src/LoginButton.tsx',
      'workspace/src/__tests__/LoginButton.test.ts',
      'workspace/src/__tests__/LoginButton.ui.test.tsx',
    ]);
  });

  it('전체 매니페스트는 5종 모두 검증 대상', () => {
    expect(declaredTestKinds(fullManifest.components[0])).toEqual([
      'unit', 'ui', 'snapshot', 'integration', 'e2e',
    ]);
    expect(componentExpectedOutputs(fullManifest.components[0])).toHaveLength(6);
  });
});

describe('executableTestKinds', () => {
  it('command 가 있는 종류만 반환한다', () => {
    expect(executableTestKinds(minimalManifest, minimalManifest.components[0]))
      .toEqual(['unit', 'ui']);
  });

  it('도구명 문자열만 있는(command 없는) 종류는 제외된다', () => {
    const legacy = JSON.parse(JSON.stringify(minimalManifest));
    legacy.tech_stack.test_runners.unit = 'vitest';
    expect(executableTestKinds(legacy, legacy.components[0])).toEqual(['ui']);
  });

  it('test_paths 에 키가 없는 선택 테스트는 제외된다', () => {
    // fullManifest 의 tech_stack 에는 5종이 있지만 spec 의 test_paths 에 일부만 있는 경우
    const partial = JSON.parse(JSON.stringify(fullManifest));
    delete partial.components[0].test_paths.snapshot;
    delete partial.components[0].test_paths.e2e;
    expect(executableTestKinds(partial, partial.components[0]))
      .toEqual(['unit', 'ui', 'integration']);
  });
});

describe('경로 헬퍼', () => {
  it('manifestPath / techStackDocPath / componentTestOutputPath', () => {
    expect(manifestPath('task-1')).toBe('docs/development/feature-task-1/components.json');
    expect(techStackDocPath('task-1')).toBe('docs/development/feature-task-1/tech-stack.md');
    expect(componentTestOutputPath('task-1', 'login-button')).toBe(
      'docs/development/feature-task-1/components/login-button.test-output.md',
    );
  });
});

describe('readComponentManifest', () => {
  it('파일이 없으면 null', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pe-comp-'));
    try {
      expect(await readComponentManifest(dir, 'no-such')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('JSON 파싱 실패 시 null', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pe-comp-'));
    try {
      const target = path.join(dir, manifestPath('t'));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, '{ invalid json');
      expect(await readComponentManifest(dir, 't')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('가드 통과 매니페스트는 그대로 반환', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pe-comp-'));
    try {
      const target = path.join(dir, manifestPath('t'));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(minimalManifest));
      const loaded = await readComponentManifest(dir, 't');
      expect(loaded).not.toBeNull();
      expect(loaded?.components[0].slug).toBe('login-button');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('스키마 위반 매니페스트는 null (워크플로우 엔진이 development-plan 재시도하도록)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pe-comp-'));
    try {
      const target = path.join(dir, manifestPath('t'));
      mkdirSync(path.dirname(target), { recursive: true });
      const broken = { ...minimalManifest, version: 99 };
      writeFileSync(target, JSON.stringify(broken));
      expect(await readComponentManifest(dir, 't')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
