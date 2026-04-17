import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentConfig, AgentRole } from '../agent/agent-types.js';
import { getSkillsForRole } from '../agent/agent-skills.js';
import { logger } from '../../utils/logger.js';
import { detectTechStack, type DetectedTechStack } from './detectors/tech-stack-detector.js';
import { detectDocs, type DetectedDocs } from './detectors/docs-detector.js';
import { recommendAgents } from './detectors/agent-recommender.js';

/** CLAUDE.md에서 파싱된 에이전트 정보 */
interface ScannedAgent {
  name: string;
  title: string;
  role: AgentRole;
  scope: string;
  keywords: string[];
  subAgents: string[];
  rulesFile?: string;
  isAdvisor: boolean;
}

/** 스캔 결과 */
export interface ScanResult {
  agents: AgentConfig[];
  projectMeta: {
    name: string;
    mission: string;
    techStack: string[];
    workflow: string;
  };
  /** 감지된 기술 스택 상세 */
  detectedTechStack: DetectedTechStack;
  /** 감지된 문서 정보 */
  detectedDocs: DetectedDocs;
  /** 스캔 방식 */
  scanMode: 'claude-md' | 'auto-detect';
  /** 스캔 요약 */
  summary: string;
  /** 에이전트 추천 이유 */
  reasoning: string[];
}

/** 표준 역할 매핑 */
const ROLE_MAP: Record<string, AgentRole> = {
  ceo: 'ceo',
  cto: 'cto',
  po: 'po',
  designer: 'designer',
  qa: 'qa',
  marketer: 'marketer',
  '최고경영자': 'ceo',
  '최고기술책임자': 'cto',
  '프로덕트오너': 'po',
  '프로덕트 오너': 'po',
  '디자이너': 'designer',
  '프로덕트 디자이너': 'designer',
  '품질보증': 'qa',
  '마케터': 'marketer',
};

/**
 * 기존 프로젝트를 스캔하여 에이전트 설정을 자동 생성합니다.
 *
 * 두 가지 모드로 동작합니다:
 * 1. CLAUDE.md에 에이전트 정의가 있으면 → 해당 정의를 파싱 + 기술 스택으로 보강
 * 2. 에이전트 정의가 없으면 → 기술 스택 + 문서 + 프로젝트 구조로 에이전트 자동 추천
 */
export async function scanExistingProject(projectRoot: string): Promise<ScanResult | null> {
  logger.info('프로젝트 분석 중...');

  // 1단계: 기술 스택 감지 (항상 실행)
  logger.dim('  기술 스택 감지 중...');
  const techStack = await detectTechStack(projectRoot);
  const techSummary = formatTechSummary(techStack);
  if (techSummary) {
    logger.dim(`  감지됨: ${techSummary}`);
  }

  // 2단계: 문서/워크플로우 감지 (항상 실행)
  logger.dim('  문서 구조 분석 중...');
  const docs = await detectDocs(projectRoot);
  if (docs.domainKeywords.length > 0) {
    logger.dim(`  도메인: ${docs.domainKeywords.join(', ')}`);
  }

  // 3단계: CLAUDE.md에서 에이전트 정의 시도
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    const claudeMd = await readFile(claudeMdPath, 'utf-8');
    const scannedAgents = parseAgentSections(claudeMd);

    if (scannedAgents.length > 0) {
      // 모드 A: CLAUDE.md 기반 에이전트 로드
      logger.info(`CLAUDE.md에서 ${scannedAgents.length}개 에이전트 감지됨`);
      return await buildFromClaudeMd(projectRoot, claudeMd, scannedAgents, techStack, docs);
    }
  }

  // 4단계: CLAUDE.md에 에이전트 없음 → 자동 추천
  if (techStack.languages.length === 0 && techStack.frameworks.length === 0) {
    logger.warn('기술 스택을 감지하지 못했습니다. 기본 에이전트를 사용합니다.');
    return null;
  }

  logger.info('CLAUDE.md 에이전트 미감지 → 프로젝트 분석 기반 자동 추천');
  return buildFromAutoDetect(projectRoot, techStack, docs);
}

// ─── 모드 A: CLAUDE.md 기반 ───────────────────────────────────

async function buildFromClaudeMd(
  projectRoot: string,
  claudeMd: string,
  scannedAgents: ScannedAgent[],
  techStack: DetectedTechStack,
  docs: DetectedDocs,
): Promise<ScanResult> {
  const agentConfigs: AgentConfig[] = [];
  const reasoning: string[] = [];

  for (const scanned of scannedAgents) {
    const rulesContent = await loadRulesFile(projectRoot, scanned);
    const config = buildAgentConfig(scanned, rulesContent, techStack);
    agentConfigs.push(config);
    reasoning.push(`[CLAUDE.md] ${scanned.name} (${scanned.role === 'custom' ? '커스텀' : scanned.role})`);
  }

  const meta = parseProjectMeta(claudeMd, techStack, docs);
  const standardCount = agentConfigs.filter(a => a.role !== 'custom').length;
  const customCount = agentConfigs.filter(a => a.role === 'custom').length;

  return {
    agents: agentConfigs,
    projectMeta: meta,
    detectedTechStack: techStack,
    detectedDocs: docs,
    scanMode: 'claude-md',
    summary: `CLAUDE.md 기반: 표준 ${standardCount}명 + 커스텀 ${customCount}명`,
    reasoning,
  };
}

// ─── 모드 B: 자동 감지 기반 ───────────────────────────────────

function buildFromAutoDetect(
  projectRoot: string,
  techStack: DetectedTechStack,
  docs: DetectedDocs,
): ScanResult {
  const { agents, reasoning } = recommendAgents(techStack, docs);

  const meta: ScanResult['projectMeta'] = {
    name: docs.projectDescription.split(/[.!?]/)[0]?.slice(0, 50) || path.basename(projectRoot),
    mission: '',
    techStack: [...techStack.languages, ...techStack.frameworks],
    workflow: docs.workflowKeywords.join(', '),
  };

  const standardCount = agents.filter(a => a.role !== 'custom').length;
  const customCount = agents.filter(a => a.role === 'custom').length;

  return {
    agents,
    projectMeta: meta,
    detectedTechStack: techStack,
    detectedDocs: docs,
    scanMode: 'auto-detect',
    summary: `자동 감지: 표준 ${standardCount}명 + 도메인 자문 ${customCount}명`,
    reasoning,
  };
}

// ─── 기술 스택 요약 포맷 ─────────────────────────────────────

function formatTechSummary(ts: DetectedTechStack): string {
  const parts: string[] = [];
  if (ts.languages.length > 0) parts.push(ts.languages.join(', '));
  if (ts.frameworks.length > 0) parts.push(ts.frameworks.join(', '));
  if (ts.platforms.length > 0) parts.push(`[${ts.platforms.join('/')}]`);
  if (ts.isMonorepo) parts.push('(모노레포)');
  return parts.join(' | ');
}

// ─── CLAUDE.md 에이전트 파싱 ─────────────────────────────────

function parseAgentSections(content: string): ScannedAgent[] {
  const agents: ScannedAgent[] = [];
  const agentBlockRegex = /^## ([A-Z][A-Z\s]*?)\s*\(([^)]+)\)(?:\s*[—–-]\s*(.+))?$/gm;
  let match: RegExpExecArray | null;

  while ((match = agentBlockRegex.exec(content)) !== null) {
    const englishName = match[1].trim();
    const koreanDesc = match[2].trim();
    const suffix = match[3]?.trim() || '';
    const isAdvisor = suffix.includes('자문') || suffix.includes('advisor');

    const blockStart = match.index + match[0].length;
    const nextSection = content.slice(blockStart).search(/^(?:##\s|---)/m);
    const blockContent = nextSection === -1
      ? content.slice(blockStart)
      : content.slice(blockStart, blockStart + nextSection);

    const scanned = parseAgentBlock(englishName, koreanDesc, blockContent, isAdvisor);
    if (scanned) agents.push(scanned);
  }

  return agents;
}

function parseAgentBlock(
  englishName: string,
  koreanDesc: string,
  block: string,
  isAdvisor: boolean,
): ScannedAgent | null {
  const normalized = englishName.toLowerCase().replace(/\s+/g, '');

  let role: AgentRole = 'custom';
  for (const [key, value] of Object.entries(ROLE_MAP)) {
    if (normalized.includes(key) || koreanDesc.includes(key)) {
      role = value;
      break;
    }
  }

  const scopeMatch = block.match(/[-*]\s*\*{0,2}범위\*{0,2}\s*[:：]\s*(.+)/);
  const scope = scopeMatch?.[1]?.trim() || koreanDesc;

  const keywords: string[] = [];
  const keywordPatterns = [
    /[-*]\s*\*{0,2}(?:핵심|핵심 원칙)\*{0,2}\s*[:：]\s*(.+)/,
    /[-*]\s*\*{0,2}기술 스택\*{0,2}\s*[:：]\s*(.+)/,
    /[-*]\s*\*{0,2}방법론\*{0,2}\s*[:：]\s*(.+)/,
    /[-*]\s*\*{0,2}도구\*{0,2}\s*[:：]\s*(.+)/,
    /[-*]\s*\*{0,2}채널\*{0,2}\s*[:：]\s*(.+)/,
  ];
  for (const pattern of keywordPatterns) {
    const m = block.match(pattern);
    if (m) keywords.push(m[1].trim());
  }

  const subAgentsMatch = block.match(/[-*]\s*\*{0,2}하위 에이전트\*{0,2}\s*[:：]\s*(.+)/);
  const subAgents = subAgentsMatch
    ? subAgentsMatch[1].split(',').map(s => s.trim())
    : [];

  const rulesMatch = block.match(/\[rules\/([^\]]+)\]/);
  const rulesFile = rulesMatch ? `rules/${rulesMatch[1]}` : undefined;

  return { name: englishName, title: koreanDesc, role, scope, keywords, subAgents, rulesFile, isAdvisor };
}

// ─── 에이전트 설정 빌드 ──────────────────────────────────────

async function loadRulesFile(projectRoot: string, scanned: ScannedAgent): Promise<string | null> {
  if (!scanned.rulesFile) return null;
  const filePath = path.join(projectRoot, scanned.rulesFile);
  if (!existsSync(filePath)) return null;
  try {
    const content = await readFile(filePath, 'utf-8');
    logger.dim(`  규칙 파일 로드: ${scanned.rulesFile}`);
    return content;
  } catch {
    return null;
  }
}

function extractRulesFromContent(content: string, maxRules = 10): string[] {
  const rules: string[] = [];
  const listItems = content.match(/^[-*]\s+(.+)/gm) || [];
  for (const item of listItems) {
    const cleaned = item.replace(/^[-*]\s+/, '').trim();
    if (cleaned.length > 10 && !cleaned.startsWith('[') && !cleaned.startsWith('http')) {
      rules.push(cleaned);
    }
    if (rules.length >= maxRules) break;
  }
  if (rules.length < maxRules) {
    const numbered = content.match(/^\d+\.\s+(.+)/gm) || [];
    for (const item of numbered) {
      const cleaned = item.replace(/^\d+\.\s+/, '').trim();
      if (cleaned.length > 10 && !cleaned.startsWith('[') && !cleaned.startsWith('http')) {
        rules.push(cleaned);
      }
      if (rules.length >= maxRules) break;
    }
  }
  return rules;
}

function extractResponsibilities(scope: string, rulesContent: string | null): string[] {
  const responsibilities: string[] = [];
  const scopeParts = scope.split(/[,、]/).map(s => s.trim()).filter(s => s.length > 3);
  responsibilities.push(...scopeParts.slice(0, 5));

  if (rulesContent) {
    const headingBlocks = rulesContent.match(/^##\s+.+\n([\s\S]*?)(?=^##|\z)/gm) || [];
    for (const block of headingBlocks.slice(0, 3)) {
      const firstItem = block.match(/^[-*]\s+(.{10,80})/m);
      if (firstItem && !responsibilities.includes(firstItem[1].trim())) {
        responsibilities.push(firstItem[1].trim());
      }
    }
  }
  return responsibilities.slice(0, 8);
}

function buildAgentConfig(
  scanned: ScannedAgent,
  rulesContent: string | null,
  techStack: DetectedTechStack,
): AgentConfig {
  const responsibilities = extractResponsibilities(scanned.scope, rulesContent);
  const rules = rulesContent ? extractRulesFromContent(rulesContent) : [];
  const hasSubAgents = scanned.subAgents.length > 0;
  const skills = scanned.role !== 'custom' ? getSkillsForRole(scanned.role) : [];
  const systemPrompt = buildSystemPromptFromScan(scanned, rulesContent, techStack);

  return {
    name: scanned.name,
    role: scanned.role,
    description: `${scanned.title} - ${scanned.scope}`,
    responsibilities,
    rules: rules.length > 0 ? rules : [
      `${scanned.scope} 관련 의사결정 수행`,
      '모든 작업 내용을 문서화',
      '관련 에이전트와 협업하여 업무 진행',
    ],
    skills,
    required_mcp_tools: undefined,
    can_create_sub_agents: hasSubAgents,
    max_sub_agents: hasSubAgents ? scanned.subAgents.length : 0,
    reports_to: inferReportsTo(scanned.role),
    collaborates_with: inferCollaborators(scanned.role),
    system_prompt_template: systemPrompt,
    meeting_permissions: {
      can_schedule: ['ceo', 'cto', 'po', 'marketer'].includes(scanned.role),
      can_participate: true,
      required_meetings: inferRequiredMeetings(scanned.role),
    },
  };
}

// ─── 추론 헬퍼 ───────────────────────────────────────────────

function inferCollaborators(role: AgentRole | string): string[] {
  const map: Record<string, string[]> = {
    ceo: ['cto', 'po', 'marketer'],
    cto: ['po', 'designer', 'qa'],
    po: ['ceo', 'cto', 'designer'],
    designer: ['po', 'cto', 'marketer'],
    qa: ['cto', 'po'],
    marketer: ['ceo', 'po', 'designer'],
  };
  return map[role] || ['ceo', 'cto'];
}

function inferReportsTo(role: AgentRole | string): string {
  const map: Record<string, string> = {
    ceo: 'investor', cto: 'ceo', po: 'ceo',
    designer: 'po', qa: 'cto', marketer: 'ceo',
  };
  return map[role] || 'ceo';
}

function inferRequiredMeetings(role: AgentRole | string): string[] {
  const map: Record<string, string[]> = {
    ceo: ['sprint_planning', 'deployment', 'emergency', 'retrospective'],
    cto: ['sprint_planning', 'tech_design_review', 'deployment', 'retrospective'],
    po: ['sprint_planning', 'backlog_grooming', 'design_review', 'retrospective'],
    designer: ['backlog_grooming', 'design_review', 'retrospective'],
    qa: ['deployment', 'retrospective'],
    marketer: ['marketing_strategy', 'retrospective'],
  };
  return map[role] || ['retrospective'];
}

// ─── 시스템 프롬프트 생성 ────────────────────────────────────

function buildSystemPromptFromScan(
  scanned: ScannedAgent,
  rulesContent: string | null,
  techStack: DetectedTechStack,
): string {
  const lines: string[] = [];

  if (scanned.isAdvisor) {
    lines.push(`당신은 "${scanned.title}" 자문 전문가입니다.`);
    lines.push(`전문 분야: ${scanned.scope}`);
    lines.push('');
    lines.push('핵심 규칙:');
    lines.push('1. 요청 시에만 활성화되어 전문 자문을 제공한다');
    lines.push('2. 자문 내용을 명확하고 실행 가능하게 전달한다');
    lines.push('3. 관련 문서를 확인하고 근거 기반으로 조언한다');
  } else {
    lines.push(`당신은 AI 스타트업의 ${scanned.name}(${scanned.title})입니다. ${scanned.scope}을(를) 담당합니다.`);

    // CTO에게 기술 스택 정보 주입
    if (scanned.role === 'cto' && techStack.languages.length > 0) {
      const stack = [...techStack.languages, ...techStack.frameworks].join(', ');
      lines.push('');
      lines.push(`기술 스택: ${stack}`);
      if (techStack.platforms.length > 0) {
        lines.push(`플랫폼: ${techStack.platforms.join(', ')}`);
      }
      if (techStack.isMonorepo) {
        lines.push('구조: 모노레포');
      }
    }

    lines.push('');
    lines.push('핵심 규칙:');
    lines.push('1. 작업 시작 전 관련 문서를 반드시 확인한다');
    lines.push('2. 칸반보드(kanban.json)를 통해 현재 진행 상황을 파악한다');
    lines.push('3. 모든 의사결정과 작업 내용을 문서화한다');
    lines.push('4. 태스크를 가능한 가장 작은 단위로 쪼갠다');
  }

  if (scanned.keywords.length > 0) {
    lines.push('');
    lines.push(`주요 도구/역량: ${scanned.keywords.join(', ')}`);
  }

  if (scanned.subAgents.length > 0) {
    lines.push('');
    lines.push(`하위 에이전트: ${scanned.subAgents.join(', ')}`);
    lines.push('하위 에이전트를 생성하여 병렬 작업이 가능하다');
  }

  if (scanned.rulesFile) {
    lines.push('');
    lines.push(`상세 규칙: ${scanned.rulesFile} 참조`);
  }

  return lines.join('\n');
}

// ─── 프로젝트 메타데이터 추출 ────────────────────────────────

function parseProjectMeta(
  claudeMd: string,
  techStack: DetectedTechStack,
  docs: DetectedDocs,
): ScanResult['projectMeta'] {
  const nameMatch = claudeMd.match(/\*{0,2}서비스명\*{0,2}\s*[:：]\s*\*{0,2}([^*\n]+)/);
  const name = nameMatch?.[1]?.trim() || '';

  const missionMatch = claudeMd.match(/\*{0,2}미션\*{0,2}\s*[:：]\s*(.+)/);
  const mission = missionMatch?.[1]?.trim() || '';

  // CLAUDE.md의 기술 스택 + 감지된 기술 스택 병합
  const techStackSet = new Set<string>();
  const techMatch = claudeMd.match(/\*{0,2}기술 스택\*{0,2}\s*[:：]\s*(.+)/);
  if (techMatch) {
    for (const t of techMatch[1].split(/[/+,]/).map(s => s.trim()).filter(Boolean)) {
      techStackSet.add(t);
    }
  }
  for (const t of [...techStack.languages, ...techStack.frameworks]) {
    techStackSet.add(t);
  }

  const workflowMatch = claudeMd.match(/```\n(.*?→.*?)\n```/s);
  const workflow = workflowMatch?.[1]?.trim() || docs.workflowKeywords.join(', ');

  return {
    name,
    mission,
    techStack: [...techStackSet],
    workflow,
  };
}
