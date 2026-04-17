import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { ProjectManager } from '../../src/core/project/project-manager.js';
import { MessageQueue } from '../../src/core/messaging/message-queue.js';
import { MeetingCoordinator } from '../../src/core/messaging/meeting.js';
import { ConsultantFactory } from '../../src/core/agent/consultant-factory.js';
import { AgentRegistry } from '../../src/core/agent/agent-registry.js';
import { getProjectPaths } from '../../src/utils/paths.js';
import { TestProject, sleep } from './helpers/test-project.js';

/**
 * 메시징 + 회의 + 자문 전문가 E2E — 오케스트레이터 없이
 * 저수준 컴포넌트만 조합해 전체 메시지 플로우가 파일 기반으로
 * 끝까지 돌아가는지 검증한다.
 */
describe('E2E — 메시징 / 회의 / 자문 전문가', () => {
  let project: TestProject;

  beforeEach(async () => {
    project = await TestProject.create('ip-e2e-msg');
    await new ProjectManager(project.root).init('msg-test');
  });

  afterEach(async () => {
    await project.cleanup();
  });

  it('MessageQueue 는 send → getAll → getUnread → markAsRead 순으로 상태가 전이된다', async () => {
    const paths = getProjectPaths(project.root);
    const queue = new MessageQueue(paths.messages);

    const msg1 = await queue.send({
      from: 'investor',
      to: 'ceo',
      type: 'directive',
      content: '랜딩페이지를 먼저 만들어주세요',
    });

    await sleep(2);
    await queue.send({
      from: 'investor',
      to: 'all',
      type: 'info',
      content: '회사 소개 문서 업데이트됨',
    });

    const all = await queue.getAll();
    expect(all).toHaveLength(2);

    const ceoUnread = await queue.getUnread('ceo');
    expect(ceoUnread).toHaveLength(2); // directive + all broadcast

    await queue.markAsRead(msg1.id);

    const ceoAfter = await queue.getUnread('ceo');
    expect(ceoAfter).toHaveLength(1);
    expect(ceoAfter[0].type).toBe('info');
  });

  it('MeetingCoordinator 는 agenda 생성 후 회의록과 결정문을 Markdown 으로 저장한다', async () => {
    const coordinator = new MeetingCoordinator(project.root);
    const paths = getProjectPaths(project.root);

    const agenda = await coordinator.createAgenda({
      type: 'issue_discussion',
      title: 'API Rate Limiting 전략',
      participants: ['cto', 'po', 'qa'],
      topics: ['현재 Rate Limit으로 인한 사용자 불만', '요금제별 차등 정책'],
    });

    expect(agenda.id).toBeTruthy();
    expect(agenda.participants).toEqual(['cto', 'po', 'qa']);

    const minutesPath = await coordinator.saveMinutes({
      id: 'minutes-1',
      agenda_id: agenda.id,
      type: 'issue_discussion',
      title: 'API Rate Limiting 전략',
      date: '2026-04-17',
      participants: ['cto', 'po', 'qa'],
      discussions: [
        { speaker: 'cto', content: '기술적으로 tier 별 분리 가능합니다' },
        { speaker: 'po', content: 'Free 플랜은 분당 10회로 제한합시다' },
      ],
      decisions: ['Free: 10/min, Pro: 100/min, Enterprise: 1000/min'],
      action_items: [
        { task_id: 'TASK-30', assignee: 'cto', description: 'Rate limiter 미들웨어 구현' },
      ],
    });

    expect(existsSync(minutesPath)).toBe(true);
    expect(minutesPath.startsWith(paths.meetings)).toBe(true);

    const decisionPath = await coordinator.saveDecision({
      title: 'Rate Limit 정책 확정',
      context: '사용자 피드백을 반영한 차등 정책 필요',
      decision: 'Free 10/min, Pro 100/min, Enterprise 1000/min',
      reasoning: '원가 구조와 VOC 분석 결과',
      decided_by: 'cto',
      meeting_id: agenda.id,
    });

    expect(existsSync(decisionPath)).toBe(true);
    expect(decisionPath.startsWith(paths.decisions)).toBe(true);
  });

  it('ConsultantFactory 는 expertise 자유 서술만으로 전문가 AgentConfig 를 생성한다', async () => {
    const factory = new ConsultantFactory();

    const consultant = factory.create({
      expertise: 'GDPR 및 한국 개인정보보호법 전문 변호사',
      context: '유럽 사용자 데이터 수집을 앞두고 있음',
      questions: [
        'GDPR 준수를 위해 필수적인 조치는?',
        '한국 개인정보보호법과의 주요 차이점은?',
      ],
      requested_by: 'ceo',
      related_task_id: 'TASK-5',
    });

    expect(consultant.id).toMatch(/^consultant-/);
    expect(consultant.config.role).toBe('custom');
    expect(consultant.config.name).toContain('GDPR');
    expect(consultant.config.system_prompt_template).toContain('GDPR 준수');
    expect(consultant.disposed).toBe(false);
    expect(consultant.expertise).toBe('GDPR 및 한국 개인정보보호법 전문 변호사');
  });

  it('AgentRegistry 는 에페메럴 자문가를 등록/해제할 수 있다', async () => {
    const paths = getProjectPaths(project.root);
    const registry = new AgentRegistry(paths.agents);
    await registry.load();

    const baselineRoles = registry.getRoles().length;

    const factory = new ConsultantFactory();
    const consultant = factory.create({
      expertise: '시리즈A 재무 전문가',
      context: '첫 라운드 준비',
      questions: ['Term sheet 에서 주의할 항목은?'],
      requested_by: 'ceo',
    });

    registry.registerEphemeral(consultant.id, consultant.config);

    const afterRegister = registry.getAll();
    expect(afterRegister.find(a => a.name === consultant.config.name)).toBeDefined();
    expect(registry.getRoles().length).toBeGreaterThanOrEqual(baselineRoles);

    registry.unregisterEphemeral(consultant.id);

    const afterUnregister = registry.getAll();
    expect(afterUnregister.find(a => a.name === consultant.config.name)).toBeUndefined();
  });

  it('투자자 메시지 → 파일 → 큐 로 비동기 전달되는 전체 파이프라인', async () => {
    const paths = getProjectPaths(project.root);
    const queue = new MessageQueue(paths.messages);

    // 여러 투자자 지시를 연속 송신 — MessageQueue 는 파일명에 ms 타임스탬프를 쓰므로 간격을 둔다
    await queue.send({ from: 'investor', to: 'all', type: 'directive', content: '랜딩 먼저' });
    await sleep(2);
    await queue.send({ from: 'investor', to: 'cto', type: 'request', content: 'DB 스키마 리뷰' });
    await sleep(2);
    await queue.send({ from: 'investor', to: 'po', type: 'info', content: '경쟁사 벤치마크 결과' });

    // 메시지 디렉토리에 실제 파일이 생성된다
    const files = await readdir(paths.messages);
    const jsons = files.filter(f => f.endsWith('.json'));
    expect(jsons.length).toBe(3);

    // 새 MessageQueue 인스턴스로 다시 읽어도 정렬된 상태로 복원된다
    const fresh = new MessageQueue(paths.messages);
    const all = await fresh.getAll();
    expect(all).toHaveLength(3);
    expect(all.map(m => m.content)).toEqual([
      '랜딩 먼저',
      'DB 스키마 리뷰',
      '경쟁사 벤치마크 결과',
    ]);
  });

  it('회의 초대 메시지 페이로드는 JSON 으로 영속화되고 파싱 가능해야 한다', async () => {
    // 회의 초대 실패 이슈 (CLAUDE.md 기록 참고) — content 가 객체 문자열이면 parse 가능해야 함
    const paths = getProjectPaths(project.root);
    const queue = new MessageQueue(paths.messages);

    const invitePayload = {
      title: 'Rate Limiting 전략',
      type: 'issue_discussion',
      participantRoles: ['cto', 'po', 'qa'],
      topics: ['정책 결정'],
      relatedTaskIds: ['TASK-30'],
    };

    await queue.send({
      from: 'ceo',
      to: 'orchestrator',
      type: 'meeting_invite',
      content: JSON.stringify(invitePayload),
    });

    const all = await queue.getAll();
    const invite = all.find(m => m.type === 'meeting_invite');
    expect(invite).toBeDefined();

    const parsed = JSON.parse(invite!.content as string);
    expect(parsed.title).toBe('Rate Limiting 전략');
    expect(parsed.participantRoles).toEqual(['cto', 'po', 'qa']);
  });
});
