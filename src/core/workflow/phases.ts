import type { AgentRole } from '../agent/agent-types.js';
import type { WorkflowPhase, TaskStatus } from '../state/types.js';
import {
  type ComponentManifest,
  type ComponentSpec,
  componentExpectedOutputs,
  manifestPath,
  techStackDocPath,
} from './components.js';

export interface Phase {
  /**
   * 페이즈의 정식 이름. development-component 처럼 컴포넌트마다 인스턴스화되는 페이즈는
   * 모두 같은 name 을 공유한다 (instanceKey 로 구분).
   */
  name: WorkflowPhase;
  /**
   * 같은 name 을 가진 페이즈가 여러 번 등장할 때 인스턴스를 구분하는 키.
   * 정적 페이즈는 비워두고, development-component 만 컴포넌트 slug 를 채운다.
   * 재시도 횟수 추적·로그 식별에 쓰인다.
   */
  instanceKey?: string;
  /** 이 페이즈에 진입할 때 칸반 보드에 표시할 상태 */
  taskStatus: TaskStatus;
  leadAgent: AgentRole;
  participantAgents: AgentRole[];
  inputDocPaths: string[];
  outputDocPaths: string[];
  completionCriteria: string;
  /**
   * 다음으로 진행할 페이즈의 이름. 동적 펼침 후에는 워크플로우 엔진이
   * `phases[i+1]` 으로 직접 진행하므로 정적 nextPhase 는 참고용이다.
   */
  nextPhase: WorkflowPhase | null;
  /** 실패 시 재진입할 페이즈. 같은 페이즈로 재시도하려면 자기 자신을 지정. */
  onFailure?: WorkflowPhase;
  /**
   * 이 페이즈의 세션 최대 대기 시간(ms).
   * 미설정 시 [DEFAULT_PHASE_TIMEOUT_MS] 사용.
   */
  timeoutMs?: number;
  /** 컴포넌트 페이즈일 때 어떤 컴포넌트를 다루는지 (프롬프트 빌더용) */
  componentContext?: ComponentSpec;
}

/** 미설정 페이즈의 기본 타임아웃 — 10분 */
export const DEFAULT_PHASE_TIMEOUT_MS = 10 * 60 * 1000;

function planningDocPath(slug: string): string {
  return `docs/planning/feature-${slug}.md`;
}
function designDocPath(slug: string): string {
  return `docs/design/feature-${slug}.md`;
}
function developmentDocPath(slug: string): string {
  return `docs/development/feature-${slug}.md`;
}

/**
 * 정적(컴포넌트 펼침 전) 페이즈를 반환한다.
 * `development-plan` 까지 포함하고, `development-component` / `development-integrate` 는
 * 매니페스트가 생긴 뒤 [buildPhases] 가 동적으로 추가한다.
 */
function buildStaticPhases(taskSlug: string): Phase[] {
  return [
    {
      name: 'planning',
      taskStatus: 'in_progress',
      leadAgent: 'po',
      participantAgents: ['ceo', 'cto'],
      inputDocPaths: ['docs/vision/company-goal.md', 'docs/vision/product-vision.md'],
      outputDocPaths: [planningDocPath(taskSlug)],
      completionCriteria: '기획 문서가 docs/planning/에 생성되고 수용 기준이 명확히 정의됨',
      nextPhase: 'design',
      onFailure: 'planning',
      timeoutMs: 10 * 60 * 1000,
    },
    {
      name: 'design',
      taskStatus: 'in_progress',
      leadAgent: 'designer',
      participantAgents: ['po'],
      inputDocPaths: [
        planningDocPath(taskSlug),
        'docs/design/system/design-system.md',
        'docs/design/system/tokens.css',
        'docs/design/system/components.css',
      ],
      outputDocPaths: [designDocPath(taskSlug), `docs/design/mockups/${taskSlug}/`],
      completionCriteria:
        '디자인 시스템(docs/design/system/tokens.css + components.css + design-system.md)이 존재하고, 피처 시안이 시스템 토큰/컴포넌트만 참조하는 HTML + meta.json 으로 docs/design/mockups/<feature>/ 에 생성됨 (시스템이 없다면 이번 페이즈에서 먼저 부트스트랩; 리터럴 색상/px 금지)',
      nextPhase: 'development-plan',
      onFailure: 'design',
      timeoutMs: 12 * 60 * 1000,
    },
    {
      name: 'development-plan',
      taskStatus: 'in_progress',
      leadAgent: 'cto',
      participantAgents: [],
      inputDocPaths: [
        planningDocPath(taskSlug),
        designDocPath(taskSlug),
        'docs/design/system/design-system.md',
        'docs/design/system/tokens.css',
        'docs/design/system/components.css',
        `docs/design/mockups/${taskSlug}/`,
      ],
      outputDocPaths: [techStackDocPath(taskSlug), manifestPath(taskSlug)],
      completionCriteria: [
        `정확히 다음 두 파일이 생성되어야 한다:`,
        `1) ${techStackDocPath(taskSlug)} — 사람용 기술 스택 설명 + 5종 테스트 도구 선택 근거`,
        `2) ${manifestPath(taskSlug)} — 워크플로우 엔진이 파싱하는 컴포넌트 매니페스트(JSON, version=1)`,
        `매니페스트는 src/core/workflow/components.ts 의 ComponentManifest 스키마를 정확히 따라야 한다.`,
        `각 컴포넌트는 implementation_paths(>=1) 와 5종 test_paths(unit/ui/snapshot/integration/e2e) 를 모두 명시해야 한다.`,
        `slug 는 a-z0-9- 만 사용. 컴포넌트는 의존성 순서대로 정렬한다.`,
        `이 페이즈에서는 코드를 구현하지 않는다 — 분해와 계획만 산출한다.`,
      ].join('\n'),
      nextPhase: 'development-component',
      onFailure: 'development-plan',
      timeoutMs: 15 * 60 * 1000,
    },
  ];
}

/**
 * 매니페스트가 있을 때 컴포넌트 페이즈와 통합 페이즈를 반환한다.
 * 컴포넌트 1개당 development-component 페이즈 1개가 펼쳐진다.
 */
function buildComponentPhases(taskSlug: string, manifest: ComponentManifest): Phase[] {
  const componentPhases: Phase[] = manifest.components.map((spec, idx, arr) => {
    const isLast = idx === arr.length - 1;
    return {
      name: 'development-component',
      instanceKey: spec.slug,
      taskStatus: 'in_progress',
      leadAgent: 'cto',
      participantAgents: [],
      inputDocPaths: [
        techStackDocPath(taskSlug),
        manifestPath(taskSlug),
        designDocPath(taskSlug),
        `docs/design/mockups/${taskSlug}/`,
        ...(spec.dependencies ?? []).map(dep =>
          // 의존 컴포넌트가 이미 산출한 구현 파일들을 참조용으로 노출
          `docs/development/feature-${taskSlug}/components/${dep}.md`,
        ),
      ],
      outputDocPaths: componentExpectedOutputs(spec),
      completionCriteria: [
        `컴포넌트 "${spec.name}" (slug: ${spec.slug}) 만 구현한다 — 다른 컴포넌트는 건드리지 않는다.`,
        `구현 파일: ${spec.implementation_paths.join(', ')}`,
        `5종 테스트를 모두 작성하고 통과시킨다 (도구는 tech-stack.md 의 test_runners 사용):`,
        `- unit: ${spec.test_paths.unit}`,
        `- ui: ${spec.test_paths.ui}`,
        `- snapshot: ${spec.test_paths.snapshot}`,
        `- integration: ${spec.test_paths.integration}`,
        `- e2e: ${spec.test_paths.e2e}`,
        `5종 중 하나라도 누락되면 컴포넌트는 미완료다.`,
      ].join('\n'),
      nextPhase: isLast ? 'development-integrate' : 'development-component',
      onFailure: 'development-component',
      timeoutMs: 15 * 60 * 1000,
      componentContext: spec,
    };
  });

  const integratePhase: Phase = {
    name: 'development-integrate',
    taskStatus: 'in_progress',
    leadAgent: 'cto',
    participantAgents: [],
    inputDocPaths: [techStackDocPath(taskSlug), manifestPath(taskSlug)],
    outputDocPaths: [developmentDocPath(taskSlug)],
    completionCriteria: [
      `모든 컴포넌트를 통합하고 전체 통합 빌드/테스트가 통과해야 한다.`,
      `최종 산출물: ${developmentDocPath(taskSlug)} — 통합 결과 요약, 빌드/테스트 결과, 미해결 이슈 목록.`,
      `tech-stack.md 의 통합 테스트 도구로 컴포넌트 간 상호작용을 검증한다.`,
    ].join('\n'),
    nextPhase: 'testing',
    onFailure: 'development-integrate',
    timeoutMs: 15 * 60 * 1000,
  };

  return [...componentPhases, integratePhase];
}

function buildPostDevelopmentPhases(taskSlug: string): Phase[] {
  return [
    {
      name: 'testing',
      taskStatus: 'testing',
      leadAgent: 'qa',
      participantAgents: [],
      inputDocPaths: [planningDocPath(taskSlug), developmentDocPath(taskSlug)],
      outputDocPaths: [],
      completionCriteria: '모든 테스트가 통과하고 수용 기준이 충족됨 (E2E + 수용 기준 검증 중심)',
      nextPhase: 'deployment',
      onFailure: 'development-component',
      timeoutMs: 15 * 60 * 1000,
    },
    {
      name: 'deployment',
      taskStatus: 'review',
      leadAgent: 'cto',
      participantAgents: ['qa', 'ceo'],
      inputDocPaths: [],
      outputDocPaths: [],
      completionCriteria: '배포가 성공적으로 완료됨',
      nextPhase: 'documentation',
      timeoutMs: 10 * 60 * 1000,
    },
    {
      name: 'documentation',
      taskStatus: 'review',
      leadAgent: 'po',
      participantAgents: ['cto'],
      inputDocPaths: [
        planningDocPath(taskSlug),
        designDocPath(taskSlug),
        developmentDocPath(taskSlug),
      ],
      outputDocPaths: [],
      completionCriteria: '모든 관련 문서가 최신화됨',
      nextPhase: null,
      timeoutMs: 10 * 60 * 1000,
    },
  ];
}

/**
 * 워크플로우 페이즈 배열을 빌드한다.
 *
 * - `manifest` 가 없으면: planning → design → development-plan → (testing/deployment/documentation)
 *   development-plan 까지만 진행 후 워크플로우 엔진이 매니페스트를 읽어 다시 buildPhases 를 호출한다.
 * - `manifest` 가 있으면: planning → design → development-plan → development-component(N개) → development-integrate → testing → ...
 *
 * 옛 `development` 페이즈명은 진입 시 `development-plan` 으로 매핑한다 ([resolvePhaseAlias]).
 */
export function buildPhases(taskSlug: string, manifest: ComponentManifest | null): Phase[] {
  const staticPhases = buildStaticPhases(taskSlug);
  const post = buildPostDevelopmentPhases(taskSlug);
  if (!manifest) {
    return [...staticPhases, ...post];
  }
  return [...staticPhases, ...buildComponentPhases(taskSlug, manifest), ...post];
}

/**
 * 옛 `development` phase 값을 새 분할 페이즈로 매핑한다.
 * 기존에 비정상 종료된 태스크가 phase=development 로 남아있을 때 development-plan 부터 재시작.
 */
export function resolvePhaseAlias(phase: WorkflowPhase | null | undefined): WorkflowPhase | null {
  if (!phase) return null;
  if (phase === 'development') return 'development-plan';
  return phase;
}

/**
 * 페이즈 배열에서 이름과 instanceKey 로 페이즈를 찾는다.
 * instanceKey 가 비어있으면 같은 이름의 첫 페이즈를 반환.
 */
export function findPhase(
  phases: Phase[],
  name: WorkflowPhase,
  instanceKey?: string,
): { phase: Phase; index: number } | undefined {
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (p.name !== name) continue;
    if (instanceKey && p.instanceKey !== instanceKey) continue;
    return { phase: p, index: i };
  }
  return undefined;
}

/**
 * 같은 페이즈 인스턴스를 식별하는 키 — 재시도 카운터 맵의 key 로 쓴다.
 * 같은 name 의 컴포넌트 페이즈들이 별도로 카운트되도록 한다.
 */
export function phaseInstanceKey(phase: Phase): string {
  return phase.instanceKey ? `${phase.name}::${phase.instanceKey}` : phase.name;
}
