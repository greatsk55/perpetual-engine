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
  /** CTO 가 정한 기술 스택. 5종 테스트 도구를 모두 명시해야 한다. */
  tech_stack: ComponentTechStack;
  /** 구현할 컴포넌트 목록. 의존성 순서대로 정렬되어 있어야 한다. */
  components: ComponentSpec[];
}

export interface ComponentTechStack {
  /** UI/구현 프레임워크 (예: "react+vite", "svelte+kit", "nextjs", "vue3") */
  framework: string;
  /** 5종 테스트 도구. 도구 이름은 자유 — CTO 가 결정한 스택에 맞춘다. */
  test_runners: {
    unit: string;
    ui: string;
    snapshot: string;
    integration: string;
    e2e: string;
  };
  /** 부가 메모 (런타임, 패키지 매니저, 빌드 도구 등) */
  notes?: string;
}

export interface ComponentSpec {
  /** 사람이 읽는 이름 (예: "LoginButton") */
  name: string;
  /** 파일/디렉토리에 쓰일 슬러그 (예: "login-button"). a-z0-9- 만 허용. */
  slug: string;
  /** 이 컴포넌트의 책임 한 문장 */
  description: string;
  /** 구현 산출 파일/디렉토리 경로 (workspace/ 기준 상대경로). 빈 배열 금지. */
  implementation_paths: string[];
  /** 5종 테스트 파일 경로 — 각각 정확히 한 경로. 워크플로우가 존재 여부를 검증한다. */
  test_paths: {
    unit: string;
    ui: string;
    snapshot: string;
    integration: string;
    e2e: string;
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

function isComponentTechStack(value: unknown): value is ComponentTechStack {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.framework !== 'string' || v.framework.length === 0) return false;
  const r = v.test_runners as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return false;
  for (const key of ['unit', 'ui', 'snapshot', 'integration', 'e2e'] as const) {
    if (typeof r[key] !== 'string' || (r[key] as string).length === 0) return false;
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
  for (const key of ['unit', 'ui', 'snapshot', 'integration', 'e2e'] as const) {
    if (typeof t[key] !== 'string' || (t[key] as string).length === 0) return false;
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
 * `development-component` 페이즈의 모든 산출 경로 (구현 + 5종 테스트).
 * Phase.outputDocPaths 가 이 경로들을 그대로 반환한다.
 */
export function componentExpectedOutputs(spec: ComponentSpec): string[] {
  return [
    ...spec.implementation_paths,
    spec.test_paths.unit,
    spec.test_paths.ui,
    spec.test_paths.snapshot,
    spec.test_paths.integration,
    spec.test_paths.e2e,
  ];
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
