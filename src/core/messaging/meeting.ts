import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { getProjectPaths } from '../../utils/paths.js';

export type MeetingType =
  | 'sprint_planning'
  | 'backlog_grooming'
  | 'tech_design_review'
  | 'design_review'
  | 'deployment'
  | 'marketing_strategy'
  | 'emergency'
  | 'retrospective'
  | 'issue_discussion'
  | 'consultation';

export interface MeetingAgenda {
  id: string;
  type: MeetingType;
  title: string;
  /** 회의 참여 에��전트 역할 목록 (복수) */
  participants: string[];
  topics: string[];
  /** 연관 태스크/이슈 ID (있을 경우) */
  related_task_ids?: string[];
  /** 자문 에이전트가 참여하는 경우 해당 ID 목록 */
  consultant_ids?: string[];
  created_at: string;
}

export interface MeetingMinutes {
  id: string;
  agenda_id: string;
  type: MeetingType;
  title: string;
  date: string;
  participants: string[];
  /** 자문 전문가 참여자 (있을 경우) */
  consultants?: Array<{ id: string; domain: string; name: string }>;
  discussions: Array<{
    speaker: string;
    content: string;
  }>;
  decisions: string[];
  action_items: Array<{
    task_id?: string;
    assignee: string;
    description: string;
  }>;
}

export class MeetingCoordinator {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async createAgenda(params: {
    type: MeetingType;
    title: string;
    participants: string[];
    topics: string[];
  }): Promise<MeetingAgenda> {
    const agenda: MeetingAgenda = {
      id: nanoid(),
      type: params.type,
      title: params.title,
      participants: params.participants,
      topics: params.topics,
      created_at: new Date().toISOString(),
    };

    return agenda;
  }

  async saveMinutes(minutes: MeetingMinutes): Promise<string> {
    const paths = getProjectPaths(this.projectRoot);
    await mkdir(paths.meetings, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const slug = minutes.title.toLowerCase().replace(/[^a-z0-9가-힣]/g, '-').replace(/-+/g, '-');
    const filename = `${date}-${slug}.md`;
    const filePath = path.join(paths.meetings, filename);

    const markdown = this.formatMinutesAsMarkdown(minutes);
    await writeFile(filePath, markdown, 'utf-8');

    return filePath;
  }

  async saveDecision(decision: {
    title: string;
    context: string;
    decision: string;
    reasoning: string;
    decided_by: string;
    meeting_id: string;
  }): Promise<string> {
    const paths = getProjectPaths(this.projectRoot);
    await mkdir(paths.decisions, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const slug = decision.title.toLowerCase().replace(/[^a-z0-9가-힣]/g, '-').replace(/-+/g, '-');
    const filename = `${date}-${slug}.md`;
    const filePath = path.join(paths.decisions, filename);

    const markdown = `# 의사결정: ${decision.title}

- **일시**: ${date}
- **결정자**: ${decision.decided_by}
- **회의**: ${decision.meeting_id}

## 배경
${decision.context}

## 결정
${decision.decision}

## 근거
${decision.reasoning}
`;

    await writeFile(filePath, markdown, 'utf-8');
    return filePath;
  }

  private formatMinutesAsMarkdown(minutes: MeetingMinutes): string {
    let md = `# ${minutes.title}

- **일시**: ${minutes.date}
- **유형**: ${minutes.type}
- **참여자**: ${minutes.participants.join(', ')}

## 논의 내용
`;

    for (const disc of minutes.discussions) {
      md += `\n### ${disc.speaker}:\n${disc.content}\n`;
    }

    if (minutes.decisions.length > 0) {
      md += `\n## 결정사항\n`;
      for (const d of minutes.decisions) {
        md += `- ${d}\n`;
      }
    }

    if (minutes.action_items.length > 0) {
      md += `\n## 액션 아이템\n`;
      for (const item of minutes.action_items) {
        const taskRef = item.task_id ? ` [${item.task_id}]` : '';
        md += `- ${item.assignee}: ${item.description}${taskRef}\n`;
      }
    }

    return md;
  }
}
