import { describe, it, expect } from 'vitest';
import {
  buildPhases,
  resolvePhaseAlias,
  findPhase,
  phaseInstanceKey,
  DEFAULT_PHASE_TIMEOUT_MS,
} from '../../../src/core/workflow/phases.js';
import type { ComponentManifest } from '../../../src/core/workflow/components.js';

const manifest: ComponentManifest = {
  version: 1,
  task_id: 'TASK-9',
  tech_stack: {
    framework: 'react+vite',
    test_runners: {
      unit: { tool: 'vitest', command: 'npx vitest run' },
      ui: { tool: 'rtl', command: 'npx vitest run --testNamePattern=ui' },
    },
  },
  components: [
    {
      name: 'Button',
      slug: 'button',
      description: '재사용 버튼',
      implementation_paths: ['workspace/src/Button.tsx'],
      test_paths: {
        unit: 'workspace/src/__tests__/Button.test.ts',
        ui: 'workspace/src/__tests__/Button.ui.test.tsx',
      },
    },
    {
      name: 'Form',
      slug: 'form',
      description: '폼 컨테이너',
      implementation_paths: ['workspace/src/Form.tsx'],
      test_paths: {
        unit: 'workspace/src/__tests__/Form.test.ts',
        ui: 'workspace/src/__tests__/Form.ui.test.tsx',
      },
      dependencies: ['button'],
    },
  ],
};

describe('resolvePhaseAlias', () => {
  it('옛 development 값을 development-plan 으로 매핑한다', () => {
    expect(resolvePhaseAlias('development')).toBe('development-plan');
  });
  it('새 페이즈 값은 그대로 반환한다', () => {
    expect(resolvePhaseAlias('development-component')).toBe('development-component');
    expect(resolvePhaseAlias('planning')).toBe('planning');
  });
  it('null/undefined 는 null', () => {
    expect(resolvePhaseAlias(null)).toBeNull();
    expect(resolvePhaseAlias(undefined)).toBeNull();
  });
});

describe('buildPhases (매니페스트 없음)', () => {
  const phases = buildPhases('task-9', null);

  it('development 단계가 development-plan 까지만 포함된다', () => {
    const names = phases.map(p => p.name);
    expect(names).toContain('development-plan');
    expect(names).not.toContain('development-component');
    expect(names).not.toContain('development-integrate');
  });

  it('정적 페이즈 순서: planning → design → development-plan → testing → deployment → documentation', () => {
    const names = phases.map(p => p.name);
    expect(names).toEqual([
      'planning',
      'design',
      'development-plan',
      'testing',
      'deployment',
      'documentation',
    ]);
  });

  it('모든 페이즈에 timeoutMs 가 정의되어 있거나 DEFAULT 보다 길지 않다', () => {
    for (const p of phases) {
      const t = p.timeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS;
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(60 * 60 * 1000);
    }
  });
});

describe('buildPhases (매니페스트 있음)', () => {
  const phases = buildPhases('task-9', manifest);

  it('컴포넌트 수만큼 development-component 페이즈가 펼쳐진다', () => {
    const components = phases.filter(p => p.name === 'development-component');
    expect(components).toHaveLength(2);
    expect(components.map(p => p.instanceKey)).toEqual(['button', 'form']);
  });

  it('development-component 다음에 development-integrate 가 단 1개 있다', () => {
    const integrates = phases.filter(p => p.name === 'development-integrate');
    expect(integrates).toHaveLength(1);
  });

  it('마지막 컴포넌트의 nextPhase 는 development-integrate 이고, 중간은 development-component', () => {
    const components = phases.filter(p => p.name === 'development-component');
    expect(components[0].nextPhase).toBe('development-component');
    expect(components[1].nextPhase).toBe('development-integrate');
  });

  it('development-component 페이즈의 outputDocPaths 는 구현 + 작성된 테스트만 (unit+ui 만 있는 경우 3개)', () => {
    const buttonPhase = phases.find(
      p => p.name === 'development-component' && p.instanceKey === 'button',
    )!;
    expect(buttonPhase.outputDocPaths).toHaveLength(3);
    expect(buttonPhase.outputDocPaths).toContain('workspace/src/Button.tsx');
    expect(buttonPhase.outputDocPaths).toContain('workspace/src/__tests__/Button.test.ts');
    expect(buttonPhase.outputDocPaths).toContain('workspace/src/__tests__/Button.ui.test.tsx');
  });

  it('development-component 페이즈의 inputDocPaths 에 직전 시도의 테스트 출력 파일이 포함된다', () => {
    const buttonPhase = phases.find(
      p => p.name === 'development-component' && p.instanceKey === 'button',
    )!;
    expect(buttonPhase.inputDocPaths).toContain(
      'docs/development/feature-task-9/components/button.test-output.md',
    );
  });

  it('development-component 페이즈에 componentContext 가 주입된다', () => {
    const formPhase = phases.find(
      p => p.name === 'development-component' && p.instanceKey === 'form',
    )!;
    expect(formPhase.componentContext?.name).toBe('Form');
    expect(formPhase.componentContext?.dependencies).toEqual(['button']);
  });
});

describe('findPhase / phaseInstanceKey', () => {
  const phases = buildPhases('t', manifest);

  it('이름만으로 첫 인스턴스를 찾는다', () => {
    const f = findPhase(phases, 'development-component');
    expect(f?.phase.instanceKey).toBe('button');
  });

  it('instanceKey 로 특정 인스턴스를 찾는다', () => {
    const f = findPhase(phases, 'development-component', 'form');
    expect(f?.phase.instanceKey).toBe('form');
  });

  it('phaseInstanceKey 는 컴포넌트 페이즈를 분리해 추적한다', () => {
    const buttonPhase = phases.find(
      p => p.name === 'development-component' && p.instanceKey === 'button',
    )!;
    const planPhase = phases.find(p => p.name === 'development-plan')!;
    expect(phaseInstanceKey(buttonPhase)).toBe('development-component::button');
    expect(phaseInstanceKey(planPhase)).toBe('development-plan');
  });
});
