import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isComponentManifest,
  componentExpectedOutputs,
  manifestPath,
  techStackDocPath,
  readComponentManifest,
  type ComponentManifest,
} from '../../../src/core/workflow/components.js';

const validManifest: ComponentManifest = {
  version: 1,
  task_id: 'TASK-1',
  tech_stack: {
    framework: 'react+vite',
    test_runners: {
      unit: 'vitest',
      ui: '@testing-library/react',
      snapshot: 'vitest snapshot',
      integration: 'vitest + msw',
      e2e: 'playwright',
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
        snapshot: 'workspace/src/__tests__/__snapshots__/LoginButton.snap',
        integration: 'workspace/tests/integration/login-button.test.ts',
        e2e: 'workspace/tests/e2e/login-button.spec.ts',
      },
    },
  ],
};

describe('isComponentManifest 가드', () => {
  it('유효한 매니페스트를 통과시킨다', () => {
    expect(isComponentManifest(validManifest)).toBe(true);
  });

  it('null/undefined/원시값을 거부한다', () => {
    expect(isComponentManifest(null)).toBe(false);
    expect(isComponentManifest(undefined)).toBe(false);
    expect(isComponentManifest('foo')).toBe(false);
    expect(isComponentManifest(42)).toBe(false);
  });

  it('version != 1 을 거부한다', () => {
    expect(isComponentManifest({ ...validManifest, version: 2 })).toBe(false);
  });

  it('task_id 누락을 거부한다', () => {
    const { task_id: _omit, ...rest } = validManifest;
    expect(isComponentManifest(rest)).toBe(false);
  });

  it('5종 test_runners 중 하나라도 누락되면 거부한다', () => {
    const broken = JSON.parse(JSON.stringify(validManifest));
    delete broken.tech_stack.test_runners.snapshot;
    expect(isComponentManifest(broken)).toBe(false);
  });

  it('컴포넌트의 5종 test_paths 중 하나라도 누락되면 거부한다', () => {
    const broken = JSON.parse(JSON.stringify(validManifest));
    delete broken.components[0].test_paths.e2e;
    expect(isComponentManifest(broken)).toBe(false);
  });

  it('implementation_paths 가 비면 거부한다', () => {
    const broken = JSON.parse(JSON.stringify(validManifest));
    broken.components[0].implementation_paths = [];
    expect(isComponentManifest(broken)).toBe(false);
  });

  it('컴포넌트가 0개면 거부한다', () => {
    expect(isComponentManifest({ ...validManifest, components: [] })).toBe(false);
  });

  it('slug 가 a-z0-9- 외 문자를 포함하면 거부한다', () => {
    const broken = JSON.parse(JSON.stringify(validManifest));
    broken.components[0].slug = 'Login_Button';
    expect(isComponentManifest(broken)).toBe(false);
  });

  it('컴포넌트 slug 가 중복되면 거부한다', () => {
    const dup = JSON.parse(JSON.stringify(validManifest));
    dup.components.push({ ...dup.components[0] });
    expect(isComponentManifest(dup)).toBe(false);
  });
});

describe('componentExpectedOutputs', () => {
  it('구현 경로 + 5종 테스트 경로를 모두 반환한다', () => {
    const outputs = componentExpectedOutputs(validManifest.components[0]);
    expect(outputs).toEqual([
      'workspace/src/LoginButton.tsx',
      'workspace/src/__tests__/LoginButton.test.ts',
      'workspace/src/__tests__/LoginButton.ui.test.tsx',
      'workspace/src/__tests__/__snapshots__/LoginButton.snap',
      'workspace/tests/integration/login-button.test.ts',
      'workspace/tests/e2e/login-button.spec.ts',
    ]);
  });
});

describe('manifestPath / techStackDocPath', () => {
  it('태스크 슬러그 기반 경로를 반환한다', () => {
    expect(manifestPath('task-1')).toBe('docs/development/feature-task-1/components.json');
    expect(techStackDocPath('task-1')).toBe('docs/development/feature-task-1/tech-stack.md');
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
      writeFileSync(target, JSON.stringify(validManifest));
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
      const broken = { ...validManifest, version: 99 };
      writeFileSync(target, JSON.stringify(broken));
      expect(await readComponentManifest(dir, 't')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
