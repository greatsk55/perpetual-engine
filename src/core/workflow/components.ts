import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * 컴포넌트 단위 개발(`development-*` 페이즈) 의 SSOT.
 *
 * `development-plan` 페이즈에서 CTO 가 작성하고,
 * `development-component` 페이즈에서 워크플로우 엔진이 컴포넌트마다 페이즈를 펼치는 데 사용한다.
 *
 * 작성 위치: `docs/development/feature-<task-slug>/components.json`
 */
export interface ComponentManifest {
  version: 1;
  /** 이 매니페스트가 속한 태스크 ID — kanban.json 의 task.id 와 일치해야 한다 */
  task_id: string;
  /** CTO 가 정한 기술 스택. unit/ui 두 종 테스트 도구는 필수, 나머지는 선택. */
  tech_stack: ComponentTechStack;
  /** 구현할 컴포넌트 목록. 의존성 순서대로 정렬되어 있어야 한다. */
  components: ComponentSpec[];
}

/**
 * 테스트 러너 정의.
 *
 * - 문자열 형태: 도구 이름만 — 워크플로우 엔진이 자동 실행하지 않는다(파일 존재 검증만).
 * - 객체 형태: `tool` 과 `command` 모두 명시 — 엔진이 `command` 를 Bash 로 실행해서
 *   종료코드 0 일 때만 페이즈를 통과시킨다. 실패 시 같은 페이즈로 자동 재시도한다.
 */
export type TestRunner = string | { tool: string; command: string };

export interface ComponentTechStack {
  /** UI/구현 프레임워크 (예: "react+vite", "svelte+kit", "nextjs", "vue3") */
  framework: string;
  /**
   * 테스트 도구. unit + ui 는 반드시 있어야 한다 (TDD 최소 단위).
   * snapshot/integration/e2e 는 선택 — 작성하기로 한 종류만 채운다.
   *
   * `command` 가 있으면 워크플로우 엔진이 Bash 로 실제 실행해서 통과 여부를 검증한다.
   * 따라서 가능하면 객체 형태로 적는다.
   */
  test_runners: {
    unit: TestRunner;
    ui: TestRunner;
    snapshot?: TestRunner;
    integration?: TestRunner;
    e2e?: TestRunner;
  };
  /** 부가 메모 (런타임, 패키지 매니저, 빌드 도구 등) */
  notes?: string;
}

/** 5종 테스트 카테고리 키 */
export type TestKind = 'unit' | 'ui' | 'snapshot' | 'integration' | 'e2e';
export const REQUIRED_TEST_KINDS: TestKind[] = ['unit', 'ui'];
export const OPTIONAL_TEST_KINDS: TestKind[] = ['snapshot', 'integration', 'e2e'];
export const ALL_TEST_KINDS: TestKind[] = [...REQUIRED_TEST_KINDS, ...OPTIONAL_TEST_KINDS];

export interface ComponentSpec {
  /** 사람이 읽는 이름 (예: "LoginButton") */
  name: string;
  /** 파일/디렉토리에 쓰일 슬러그 (예: "login-button"). a-z0-9- 만 허용. */
  slug: string;
  /** 이 컴포넌트의 책임 한 문장 */
  description: string;
  /** 구현 산출 파일/디렉토리 경로 (workspace/ 기준 상대경로). 빈 배열 금지. */
  implementation_paths: string[];
  /**
   * 테스트 파일 경로. unit + ui 는 필수, 나머지는 선택.
   * 워크플로우 엔진은 작성하기로 한 종류(키가 존재하는 종류)에 한해 파일 존재를 검증한다.
   */
  test_paths: {
    unit: string;
    ui: string;
    snapshot?: string;
    integration?: string;
    e2e?: string;
  };
  /** 이 컴포넌트가 의존하는 다른 컴포넌트의 slug 목록 (정렬 힌트용, 강제 아님) */
  dependencies?: string[];
}

/**
 * 매니페스트 타입가드.
 *
 * CLAUDE.md 룰: 에이전트가 쓰는 JSON 은 읽는 쪽에서 가드한다 — 자유 형식으로 덮어써도
 * 워크플로우 엔진이 크래시하지 않도록 좁힌다.
 */
export function isComponentManifest(value: unknown): value is ComponentManifest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.task_id !== 'string' || v.task_id.length === 0) return false;
  if (!isComponentTechStack(v.tech_stack)) return false;
  if (!Array.isArray(v.components) || v.components.length === 0) return false;
  for (const c of v.components) {
    if (!isComponentSpec(c)) return false;
  }
  // slug 중복 금지 — 컴포넌트 페이즈 이름 충돌을 방지
  const slugs = new Set<string>();
  for (const c of v.components as ComponentSpec[]) {
    if (slugs.has(c.slug)) return false;
    slugs.add(c.slug);
  }
  return true;
}

function isTestRunner(value: unknown): value is TestRunner {
  if (typeof value === 'string') return value.length > 0;
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.tool === 'string' && v.tool.length > 0 &&
    typeof v.command === 'string' && v.command.length > 0
  );
}

function isComponentTechStack(value: unknown): value is ComponentTechStack {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.framework !== 'string' || v.framework.length === 0) return false;
  const r = v.test_runners as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return false;
  for (const key of REQUIRED_TEST_KINDS) {
    if (!isTestRunner(r[key])) return false;
  }
  for (const key of OPTIONAL_TEST_KINDS) {
    if (r[key] !== undefined && !isTestRunner(r[key])) return false;
  }
  return true;
}

function isComponentSpec(value: unknown): value is ComponentSpec {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || v.name.length === 0) return false;
  if (typeof v.slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(v.slug)) return false;
  if (typeof v.description !== 'string') return false;
  if (!Array.isArray(v.implementation_paths) || v.implementation_paths.length === 0) return false;
  if (!v.implementation_paths.every(p => typeof p === 'string' && p.length > 0)) return false;
  const t = v.test_paths as Record<string, unknown> | undefined;
  if (!t || typeof t !== 'object') return false;
  for (const key of REQUIRED_TEST_KINDS) {
    if (typeof t[key] !== 'string' || (t[key] as string).length === 0) return false;
  }
  for (const key of OPTIONAL_TEST_KINDS) {
    if (t[key] !== undefined && (typeof t[key] !== 'string' || (t[key] as string).length === 0)) {
      return false;
    }
  }
  if (v.dependencies !== undefined) {
    if (!Array.isArray(v.dependencies)) return false;
    if (!v.dependencies.every(d => typeof d === 'string')) return false;
  }
  return true;
}

/**
 * 매니페스트 파일 경로. development-plan 페이즈가 이 경로에 정확히 작성해야 한다.
 */
export function manifestPath(taskSlug: string): string {
  return `docs/development/feature-${taskSlug}/components.json`;
}

/**
 * 기술 스택 문서 경로. CTO 가 사람용 설명을 작성한다.
 */
export function techStackDocPath(taskSlug: string): string {
  return `docs/development/feature-${taskSlug}/tech-stack.md`;
}

/**
 * 테스트 실행 출력이 저장되는 파일 경로 (재시도 세션이 보고 수정하도록).
 */
export function componentTestOutputPath(taskSlug: string, componentSlug: string): string {
  return `docs/development/feature-${taskSlug}/components/${componentSlug}.test-output.md`;
}

/**
 * 컴포넌트가 작성하기로 선언한 테스트 종류만 반환.
 * 워크플로우 엔진이 산출물 검증 + 테스트 실행 대상을 결정할 때 사용한다.
 */
export function declaredTestKinds(spec: ComponentSpec): TestKind[] {
  const kinds: TestKind[] = [];
  for (const k of ALL_TEST_KINDS) {
    if (spec.test_paths[k]) kinds.push(k);
  }
  return kinds;
}

/**
 * `development-component` 페이즈의 모든 산출 경로 (구현 + 작성하기로 한 테스트들).
 * Phase.outputDocPaths 가 이 경로들을 그대로 반환한다.
 *
 * unit/ui 는 필수라 항상 포함된다. snapshot/integration/e2e 는 선언된 것만 검증.
 */
export function componentExpectedOutputs(spec: ComponentSpec): string[] {
  const tests = declaredTestKinds(spec).map(k => spec.test_paths[k] as string);
  return [...spec.implementation_paths, ...tests];
}

/**
 * 매니페스트를 디스크에서 읽고 가드를 통과하면 반환. 실패 시 null.
 *
 * 의도적으로 throw 하지 않는다 — 호출자가 "있으면 컴포넌트 펼침, 없으면 development-plan 재시도"
 * 분기를 깔끔히 쓸 수 있도록.
 */
export async function readComponentManifest(
  projectRoot: string,
  taskSlug: string,
): Promise<ComponentManifest | null> {
  const fullPath = path.join(projectRoot, manifestPath(taskSlug));
  let raw: string;
  try {
    raw = await readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isComponentManifest(parsed) ? parsed : null;
}

/**
 * 테스트 러너에서 실행 명령어를 추출한다. 문자열 형태(도구명만)이면 null.
 */
export function getRunnerCommand(runner: TestRunner | undefined): string | null {
  if (!runner) return null;
  if (typeof runner === 'string') return null;
  return runner.command;
}

/**
 * 컴포넌트가 실제 실행 가능한 테스트(명령어가 있는 것)의 종류 목록.
 * 워크플로우 엔진은 이 목록만 Bash 로 실행해서 통과 여부를 검증한다.
 */
export function executableTestKinds(
  manifest: ComponentManifest,
  spec: ComponentSpec,
): TestKind[] {
  const result: TestKind[] = [];
  for (const k of declaredTestKinds(spec)) {
    if (getRunnerCommand(manifest.tech_stack.test_runners[k])) {
      result.push(k);
    }
  }
  return result;
}
