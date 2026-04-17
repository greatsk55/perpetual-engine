import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { AgentConfig } from '../agent/agent-types.js';
import type { Task, WorkflowPhase } from '../state/types.js';
import { getProjectPaths } from '../../utils/paths.js';

export class ContextManager {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  getContextDocs(agent: AgentConfig, task: Task, phase: WorkflowPhase): string[] {
    const docs: string[] = [];

    // 공통 컨텍스트: vision 문서
    docs.push('docs/vision/company-goal.md');
    docs.push('docs/vision/product-vision.md');

    const taskSlug = String(task.id).toLowerCase().replace(/[^a-z0-9]/g, '-');

    // 페이즈별 입력 문서
    switch (phase) {
      case 'design':
        docs.push(`docs/planning/feature-${taskSlug}.md`);
        // 디자인 시스템 SSOT 3종
        docs.push('docs/design/system/design-system.md');
        docs.push('docs/design/system/tokens.css');
        docs.push('docs/design/system/components.css');
        // 시스템 프리뷰
        docs.push('docs/design/mockups/system/preview.html');
        break;
      case 'development':
        docs.push(`docs/planning/feature-${taskSlug}.md`);
        docs.push(`docs/design/feature-${taskSlug}.md`);
        // 디자인 시스템 + 해당 피처 목업 (CTO 가 구현 시안으로 참조)
        docs.push('docs/design/system/design-system.md');
        docs.push('docs/design/system/tokens.css');
        docs.push('docs/design/system/components.css');
        docs.push(...this.findFeatureMockups(taskSlug));
        break;
      case 'testing':
        docs.push(`docs/planning/feature-${taskSlug}.md`);
        docs.push(`docs/development/feature-${taskSlug}.md`);
        docs.push(...this.findFeatureMockups(taskSlug));
        break;
      case 'deployment':
      case 'documentation':
        docs.push(`docs/planning/feature-${taskSlug}.md`);
        docs.push(`docs/design/feature-${taskSlug}.md`);
        docs.push(`docs/development/feature-${taskSlug}.md`);
        break;
    }

    // 존재하는 문서만 필터
    return docs.filter(d => existsSync(path.join(this.projectRoot, d)));
  }

  /**
   * docs/design/mockups/{feature}/ 하위의 *.html + meta.json 경로들을 반환.
   * feature 이름이 task slug 로 시작하거나 포함하면 매칭.
   */
  private findFeatureMockups(taskSlug: string): string[] {
    const paths = getProjectPaths(this.projectRoot);
    const result: string[] = [];
    let features: string[];
    try {
      features = readdirSync(paths.designMockups, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    } catch {
      return result;
    }
    for (const feature of features) {
      if (feature === 'system') continue;
      const match = taskSlug.includes(feature) || feature.includes(taskSlug);
      if (!match) continue;
      const dir = path.join(paths.designMockups, feature);
      let files: string[];
      try {
        files = readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (f.endsWith('.html') || f === 'meta.json') {
          result.push(path.relative(this.projectRoot, path.join(dir, f)));
        }
      }
    }
    return result;
  }
}
