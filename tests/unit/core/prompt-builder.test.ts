import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../../../src/core/agent/prompt-builder.js';
import { projectConfigSchema } from '../../../src/core/project/config.js';
import type { AgentConfig } from '../../../src/core/agent/agent-types.js';

const baseAgent: AgentConfig = {
  name: '테스트 에이전트',
  role: 'cto',
  description: '테스트용',
  responsibilities: [],
  rules: [],
  skills: [],
  can_create_sub_agents: false,
  max_sub_agents: 0,
  reports_to: null,
  collaborates_with: [],
  system_prompt_template: '당신은 CTO 입니다.',
  meeting_permissions: { can_schedule: true, can_participate: true, required_meetings: [] },
};

describe('PromptBuilder 언어 룰 주입', () => {
  it('config.localization.language_name 을 시스템 프롬프트에 반영한다', () => {
    const config = projectConfigSchema.parse({
      localization: { language: 'en', language_name: 'English' },
    });
    const builder = new PromptBuilder();
    const prompt = builder.buildSystemPrompt({ agent: baseAgent, config });
    expect(prompt).toContain('## 사용 언어');
    expect(prompt).toContain('English');
  });

  it('localization 미지정 시 기본 한국어로 폴백된다', () => {
    const config = projectConfigSchema.parse({});
    const builder = new PromptBuilder();
    const prompt = builder.buildSystemPrompt({ agent: baseAgent, config });
    expect(prompt).toContain('한국어 (Korean)');
  });

  it('진실성 룰도 함께 주입된다', () => {
    const config = projectConfigSchema.parse({});
    const builder = new PromptBuilder();
    const prompt = builder.buildSystemPrompt({ agent: baseAgent, config });
    expect(prompt).toContain('## 진실성 원칙');
  });

  it('언어 룰이 진실성/메트릭스 룰보다 먼저 위치한다', () => {
    const config = projectConfigSchema.parse({});
    const builder = new PromptBuilder();
    const prompt = builder.buildSystemPrompt({ agent: baseAgent, config });
    const langIdx = prompt.indexOf('## 사용 언어');
    const truthIdx = prompt.indexOf('## 진실성 원칙');
    const metricsIdx = prompt.indexOf('## 메트릭스 기반 기획 원칙');
    expect(langIdx).toBeGreaterThan(-1);
    expect(langIdx).toBeLessThan(truthIdx);
    expect(truthIdx).toBeLessThan(metricsIdx);
  });

  it('세션 시작 맥락 로딩 규칙이 역할명과 함께 주입된다', () => {
    const config = projectConfigSchema.parse({});
    const builder = new PromptBuilder();
    const prompt = builder.buildSystemPrompt({ agent: baseAgent, config });
    expect(prompt).toContain('## 세션 시작 필수 맥락 로딩');
    // 역할명이 템플릿에 치환되어 들어가야 한다 (동적 경로·필터링에 사용됨)
    expect(prompt).toMatch(/assignee === "cto"/);
    expect(prompt).toContain('맥락 로딩 완료:');
    // 진실성 다음, 메트릭스 이전에 위치해야 한다
    const truthIdx = prompt.indexOf('## 진실성 원칙');
    const bootIdx = prompt.indexOf('## 세션 시작 필수 맥락 로딩');
    const metricsIdx = prompt.indexOf('## 메트릭스 기반 기획 원칙');
    expect(truthIdx).toBeLessThan(bootIdx);
    expect(bootIdx).toBeLessThan(metricsIdx);
  });
});

describe('PromptBuilder 페이즈별 룰', () => {
  it('phaseName 미지정 시 페이즈 룰을 주입하지 않는다', () => {
    const config = projectConfigSchema.parse({});
    const builder = new PromptBuilder();
    const prompt = builder.buildSystemPrompt({ agent: baseAgent, config });
    expect(prompt).not.toContain('development-plan 페이즈 규칙');
    expect(prompt).not.toContain('development-component 페이즈 규칙');
  });

  it('development-plan 페이즈는 매니페스트 산출 룰을 주입한다', () => {
    const config = projectConfigSchema.parse({});
    const builder = new PromptBuilder();
    const prompt = builder.buildSystemPrompt({
      agent: baseAgent,
      config,
      phaseName: 'development-plan',
    });
    expect(prompt).toContain('## development-plan 페이즈 규칙');
    expect(prompt).toContain('components.json');
    expect(prompt).toContain('tech-stack.md');
    expect(prompt).toContain('코드를 한 줄도 구현하지 않는다');
  });

  it('development-component 페이즈는 5종 테스트 + 컴포넌트 컨텍스트를 주입한다', () => {
    const config = projectConfigSchema.parse({});
    const builder = new PromptBuilder();
    const prompt = builder.buildSystemPrompt({
      agent: baseAgent,
      config,
      phaseName: 'development-component',
      componentSpec: {
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
    });
    expect(prompt).toContain('## development-component 페이즈 규칙');
    // 5종 테스트 키워드가 모두 등장해야 한다
    expect(prompt).toContain('| unit |');
    expect(prompt).toContain('| ui |');
    expect(prompt).toContain('| snapshot |');
    expect(prompt).toContain('| integration |');
    expect(prompt).toContain('| e2e |');
    // 컴포넌트 컨텍스트 주입
    expect(prompt).toContain('LoginButton');
    expect(prompt).toContain('login-button');
    expect(prompt).toContain('workspace/tests/e2e/login-button.spec.ts');
  });

  it('development-integrate 페이즈는 통합 룰을 주입한다', () => {
    const config = projectConfigSchema.parse({});
    const builder = new PromptBuilder();
    const prompt = builder.buildSystemPrompt({
      agent: baseAgent,
      config,
      phaseName: 'development-integrate',
    });
    expect(prompt).toContain('## development-integrate 페이즈 규칙');
    expect(prompt).toContain('새 컴포넌트를 만들지 않는다');
  });

  it('비-development 페이즈에는 페이즈 룰이 주입되지 않는다', () => {
    const config = projectConfigSchema.parse({});
    const builder = new PromptBuilder();
    const prompt = builder.buildSystemPrompt({
      agent: baseAgent,
      config,
      phaseName: 'planning',
    });
    expect(prompt).not.toContain('development-plan 페이즈 규칙');
    expect(prompt).not.toContain('development-component 페이즈 규칙');
    expect(prompt).not.toContain('development-integrate 페이즈 규칙');
  });
});
