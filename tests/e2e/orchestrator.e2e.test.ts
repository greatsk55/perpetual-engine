import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectManager } from '../../src/core/project/project-manager.js';
import { Orchestrator } from '../../src/core/workflow/orchestrator.js';
import { SessionManager } from '../../src/core/session/session-manager.js';
import { KanbanManager } from '../../src/core/state/kanban.js';
import { MessageQueue } from '../../src/core/messaging/message-queue.js';
import { getProjectPaths } from '../../src/utils/paths.js';
import { TestProject, waitFor, sleep } from './helpers/test-project.js';
import { MockTmuxAdapter, type MockSessionRecord } from './helpers/mock-tmux.js';
import { readFileSync } from 'node:fs';

// 명령이 `bash '/path/script.sh'` 로 래핑되어 있으면 해당 스크립트 파일 내용을 반환.
// tmux 한도(~16KB) 우회를 위해 긴 명령은 자동으로 스크립트 파일로 분리되는데,
// 테스트에서는 원 명령을 검증해야 하므로 복원이 필요하다.
function resolveCommand(record: MockSessionRecord): string {
  const m = record.command.match(/^bash '(.+)'$/);
  if (m) return readFileSync(m[1], 'utf-8');
  return record.command;
}

/**
 * Orchestrator 골든 패스 E2E.
 *
 * 실제 tmux/Claude CLI 는 MockTmuxAdapter 로 대체하고,
 * 파일시스템·chokidar 워처·MessageQueue 는 모두 실제 구현을 사용한다.
 * 이렇게 하면 Orchestrator 가 파일 이벤트를 받아 적절한 세션 생성/종료를
 * 지시하는지를 실제 환경에 가깝게 검증할 수 있다.
 */
describe('E2E — Orchestrator 골든 패스', () => {
  let project: TestProject;
  let mockTmux: MockTmuxAdapter;
  let sessionManager: SessionManager;
  let orchestrator: Orchestrator;

  const makeOrchestrator = (opts: Partial<Parameters<typeof Orchestrator.prototype.constructor>[1]> = {}) => {
    mockTmux = new MockTmuxAdapter();
    sessionManager = new SessionManager(mockTmux);
    sessionManager.setProjectRoot(project.root);
    return new Orchestrator(project.root, {
      sessionManager,
      dashboardEnabled: false,
      keepAlive: false,
      autoStartCeo: false,
      workflowPollInterval: 25,
      ...opts,
    });
  };

  beforeEach(async () => {
    project = await TestProject.create('ip-e2e-orch');
    await new ProjectManager(project.root).init('orch-test');
  });

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.stop();
    }
    await project.cleanup();
  });

  it('start() → stop() 생명주기가 세션 목 어댑터에서 깔끔하게 정리된다', async () => {
    orchestrator = makeOrchestrator();
    await orchestrator.start();

    // 시작 직후에는 세션이 없어야 한다 (autoStartCeo=false)
    expect(mockTmux.getActiveSessionNames()).toHaveLength(0);

    await orchestrator.stop();

    expect(mockTmux.getActiveSessionNames()).toHaveLength(0);
  });

  it('autoStartCeo=true 이고 프로젝트가 비어있으면 CEO 에이전트 세션이 기동된다', async () => {
    orchestrator = makeOrchestrator({ autoStartCeo: true });
    await orchestrator.start();

    await waitFor(
      () => mockTmux.findSession('ceo') !== undefined,
      { timeoutMs: 2000, label: 'CEO 세션 생성 대기' },
    );

    const ceo = mockTmux.findSession('ceo');
    expect(ceo).toBeDefined();
    expect(ceo!.command).toContain('claude');
    expect(ceo!.command).toContain(project.root);

    await orchestrator.stop();
    expect(mockTmux.killCalls.length).toBeGreaterThan(0);
  });

  it('autoStartCeo 기본 정책은 기존 태스크가 있으면 CEO 기동을 건너뛴다', async () => {
    const paths = getProjectPaths(project.root);
    const kanban = new KanbanManager(paths.kanban);
    await kanban.addTask({
      title: '기존 태스크',
      description: '',
      type: 'feature',
      priority: 'medium',
      assignee: 'cto',
      created_by: 'po',
    });

    orchestrator = makeOrchestrator({ autoStartCeo: true });
    await orchestrator.start();

    await sleep(150);
    expect(mockTmux.findSession('ceo')).toBeUndefined();
  });

  it("autoStartCeo='always' 이면 기존 태스크가 있어도 CEO 를 강제 기동한다", async () => {
    const paths = getProjectPaths(project.root);
    const kanban = new KanbanManager(paths.kanban);
    await kanban.addTask({
      title: '기존 태스크',
      description: '',
      type: 'feature',
      priority: 'medium',
      assignee: 'cto',
      created_by: 'po',
    });

    orchestrator = makeOrchestrator({ autoStartCeo: 'always' });
    await orchestrator.start();

    await waitFor(
      () => mockTmux.findSession('ceo') !== undefined,
      { timeoutMs: 2000, label: 'CEO 강제 기동' },
    );
    expect(mockTmux.findSession('ceo')).toBeDefined();
  });

  it('투자자 메시지 파일이 생성되면 Orchestrator 가 담당 에이전트 세션을 기동한다', async () => {
    orchestrator = makeOrchestrator();
    await orchestrator.start();

    const paths = getProjectPaths(project.root);
    const queue = new MessageQueue(paths.messages);

    await queue.send({
      from: 'investor',
      to: 'cto',
      type: 'directive',
      content: 'DB 스키마 설계 리뷰 부탁',
    });

    await waitFor(
      () => mockTmux.findSession('cto') !== undefined,
      { timeoutMs: 3000, label: 'CTO 세션 자동 기동' },
    );

    const ctoSession = mockTmux.findSession('cto')!;
    expect(resolveCommand(ctoSession)).toContain('DB 스키마 설계 리뷰 부탁');
  });

  it('meeting_invite 메시지가 들어오면 회의 세션이 생성된다', async () => {
    orchestrator = makeOrchestrator();
    await orchestrator.start();

    const paths = getProjectPaths(project.root);
    const queue = new MessageQueue(paths.messages);

    await queue.send({
      from: 'ceo',
      to: 'orchestrator',
      type: 'meeting_invite',
      content: JSON.stringify({
        title: '긴급 회의 - 인프라 장애',
        type: 'emergency',
        participantRoles: ['cto', 'qa'],
        topics: ['장애 원인 분석', '재발 방지'],
      }),
    });

    await waitFor(
      () => mockTmux.getActiveSessionNames().some(n => n.includes('meeting-')),
      { timeoutMs: 3000, label: '회의 세션 생성 대기' },
    );

    const meetingSession = mockTmux.createCalls.find(c => c.rawName.startsWith('meeting-'));
    expect(meetingSession).toBeDefined();
    expect(resolveCommand(meetingSession!)).toContain('긴급 회의');
  });

  it('consultation_request 메시지로 자문 전문가 세션이 생성된다', async () => {
    orchestrator = makeOrchestrator();
    await orchestrator.start();

    const paths = getProjectPaths(project.root);
    const queue = new MessageQueue(paths.messages);

    await queue.send({
      from: 'ceo',
      to: 'orchestrator',
      type: 'consultation_request',
      content: JSON.stringify({
        expertise: 'SaaS B2B 가격 전략 전문가',
        context: '가격표 개편 논의 중',
        questions: ['Tier 개수는 몇 개가 적절한가', 'Usage 기반 vs Flat 어느 쪽인가'],
        requested_by: 'ceo',
      }),
    });

    await waitFor(
      () => mockTmux.createCalls.some(c => c.rawName.startsWith('consultant-')),
      { timeoutMs: 3000, label: '자문 전문가 세션 생성' },
    );

    const consultantCall = mockTmux.createCalls.find(c => c.rawName.startsWith('consultant-'));
    expect(consultantCall).toBeDefined();
    expect(resolveCommand(consultantCall!)).toContain('가격표 개편');

    // 활성 자문가로 등록되었는지 확인
    const internals = orchestrator.getInternals();
    expect(internals.activeConsultants.size).toBe(1);
  });

  it('forceRunTask 로 상태·의존성 무시하고 즉시 워크플로우를 시작한다', async () => {
    orchestrator = makeOrchestrator();
    await orchestrator.start();

    const paths = getProjectPaths(project.root);
    const kanban = new KanbanManager(paths.kanban);

    const task = await kanban.addTask({
      title: '강제 실행 태스크',
      description: '의존성 무시',
      type: 'feature',
      priority: 'high',
      assignee: 'cto',
      created_by: 'investor',
      dependencies: ['TASK-99'], // 존재하지 않는 의존성
    });

    await orchestrator.forceRunTask(task.id);

    // 강제 실행은 워크플로우 엔진을 호출하고 kanban 의 상태를 in_progress 로 바꾼다
    await waitFor(
      async () => {
        const fresh = await kanban.getTask(task.id);
        return fresh?.status === 'in_progress';
      },
      { timeoutMs: 2000, label: '태스크 상태 변경' },
    );

    const updated = await kanban.getTask(task.id);
    expect(updated?.status).toBe('in_progress');
  });

  it('suspend → resume 흐름이 실행 중 세션을 정리하고 상태를 복원한다', async () => {
    orchestrator = makeOrchestrator();
    await orchestrator.start();

    const paths = getProjectPaths(project.root);
    const kanban = new KanbanManager(paths.kanban);

    const task = await kanban.addTask({
      title: '재개할 태스크',
      description: '',
      type: 'feature',
      priority: 'medium',
      assignee: 'cto',
      created_by: 'po',
    });
    await kanban.moveTask(task.id, 'in_progress');

    // CTO 세션이 살아있다고 가정하고 직접 주입
    await sessionManager.startAgent({
      agent: orchestrator.getInternals().agentRegistry.get('cto')!,
      config: await new ProjectManager(project.root).loadConfig(),
      task,
      projectRoot: project.root,
    });

    expect(await sessionManager.isAgentRunning('cto')).toBe(true);

    await orchestrator.suspendTask(task.id, '요구사항 재검토');

    const suspended = await kanban.getTask(task.id);
    expect(suspended?.status).toBe('suspended');
    expect(await sessionManager.isAgentRunning('cto')).toBe(false);

    await orchestrator.resumeTask(task.id);
    const resumed = await kanban.getTask(task.id);
    expect(resumed?.status).toBe('in_progress');
  });

  it('from 필드 없는 meeting_invite 파일도 crash 없이 ceo 로 추론된다', async () => {
    const { writeFile } = await import('node:fs/promises');
    const path = await import('node:path');

    orchestrator = makeOrchestrator();
    await orchestrator.start();

    const paths = getProjectPaths(project.root);
    const agentMsgPath = path.join(paths.messages, 'agent-written-invite.json');

    // 에이전트가 직접 작성하는 메시지: from/id/created_at 누락
    await writeFile(agentMsgPath, JSON.stringify({
      type: 'meeting_invite',
      to: 'orchestrator',
      content: {
        title: '긴급 논의',
        type: 'issue_discussion',
        participantRoles: ['cto', 'po'],
        topics: ['이슈 X'],
      },
    }), 'utf-8');

    // watcher 가 메시지를 처리하면 회의 세션(meeting-*) 이 기동된다.
    // 이전에는 msg.from 이 undefined 라 startMultiAgentMeeting 이 throw 하며 세션이 안 떴다.
    await waitFor(
      () => mockTmux.getActiveSessionNames().some(n => n.includes('meeting-')),
      { timeoutMs: 3000, label: '회의 세션 생성 대기' },
    );

    const meetingSession = mockTmux.createCalls.find(c => c.rawName.startsWith('meeting-'));
    expect(meetingSession).toBeDefined();
    expect(meetingSession!.command).toContain('긴급 논의');
  });

  it('긴 회의 명령은 tmux 한도를 피해 스크립트 파일로 실행된다', async () => {
    const { writeFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const fs = await import('node:fs');

    orchestrator = makeOrchestrator();
    await orchestrator.start();

    const paths = getProjectPaths(project.root);
    const kanban = new KanbanManager(paths.kanban);

    // 많은 태스크에 긴 설명을 붙여 회의 아젠다/시스템 프롬프트를 팽창시킨다
    const bigDesc = '라'.repeat(2000);
    for (let i = 0; i < 10; i++) {
      await kanban.addTask({
        title: `팽창용 태스크 ${i}`,
        description: bigDesc,
        type: 'feature',
        priority: 'medium',
        assignee: 'cto',
        created_by: 'po',
      });
    }
    const relatedTaskIds = (await kanban.getAllTasks()).map(t => t.id);

    const agentMsgPath = path.join(paths.messages, 'long-invite.json');
    await writeFile(agentMsgPath, JSON.stringify({
      type: 'meeting_invite',
      from: 'ceo',
      to: 'orchestrator',
      content: {
        title: '대형 회의',
        type: 'sprint_planning',
        participantRoles: ['cto', 'po', 'designer', 'qa', 'marketer'],
        topics: ['안건1', '안건2', '안건3'],
        relatedTaskIds,
      },
    }), 'utf-8');

    await waitFor(
      () => mockTmux.getActiveSessionNames().some(n => n.includes('meeting-')),
      { timeoutMs: 3000, label: '긴 회의 세션 생성 대기' },
    );

    const meetingCall = mockTmux.createCalls.find(c => c.rawName.startsWith('meeting-'));
    expect(meetingCall).toBeDefined();
    // 임계(8KB) 초과 명령은 'bash /path/to/script.sh' 형태로 전달되어야 한다
    expect(meetingCall!.command).toMatch(/^bash '.+\.sh'$/);
    expect(meetingCall!.command.length).toBeLessThan(500);

    // 스크립트 파일이 실제로 생성되고 원래 claude 명령을 담고 있어야 한다
    const scriptMatch = meetingCall!.command.match(/^bash '(.+)'$/);
    expect(scriptMatch).toBeTruthy();
    const scriptPath = scriptMatch![1];
    expect(fs.existsSync(scriptPath)).toBe(true);
    const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
    expect(scriptContent).toContain('claude');
    expect(scriptContent).toContain('--append-system-prompt');
    expect(scriptContent).toContain('대형 회의');
  });

  it('기동 시 in_progress 로 남은 고아 태스크를 저장된 phase 부터 재개한다 (옛 development 는 development-plan 으로 마이그레이션)', async () => {
    // 1) 먼저 Orchestrator 없이 kanban 에 직접 in_progress 태스크를 박아둔다
    //    (이전 실행에서 비정상 종료된 상황 시뮬레이션)
    const paths = getProjectPaths(project.root);
    const kanban = new KanbanManager(paths.kanban);

    const task = await kanban.addTask({
      title: '중단된 개발 태스크',
      description: '',
      type: 'feature',
      priority: 'high',
      assignee: 'cto',
      created_by: 'po',
    });
    // 실제 runWorkflow 가 하던 상태 전이를 수동으로 재현: 옛 phase=development + in_progress
    await kanban.updateTaskPhase(task.id, 'development', 'cto');
    await kanban.moveTask(task.id, 'in_progress');

    // 2) 이제 Orchestrator 를 기동 → resumeInFlightTasks 가 고아를 픽업해야 한다
    orchestrator = makeOrchestrator();
    await orchestrator.start();

    // cto 세션이 기동되어야 한다 (재개 경로로 디스패치됨)
    await waitFor(
      () => mockTmux.findSession('cto') !== undefined,
      { timeoutMs: 3000, label: '고아 태스크 재개 세션 생성' },
    );

    const ctoSession = mockTmux.findSession('cto')!;
    expect(ctoSession).toBeDefined();

    // 옛 development phase 는 새 분할 워크플로우의 첫 단계 development-plan 으로 자동 마이그레이션된다.
    // (사용자 결정 a: 새 구조 배포 후 기존 진행분은 development-plan 부터 다시 시작)
    await waitFor(
      async () => (await kanban.getTask(task.id))?.phase === 'development-plan',
      { timeoutMs: 3000, label: 'development → development-plan 마이그레이션' },
    );
    const resumed = await kanban.getTask(task.id);
    expect(resumed?.phase).toBe('development-plan');
  });

  it('기동 시 이미 tmux 세션이 살아있는 고아 태스크는 재개하지 않는다', async () => {
    // 사전 조건: in_progress 태스크가 있고, 동시에 tmux 세션도 이미 존재
    const paths = getProjectPaths(project.root);
    const kanban = new KanbanManager(paths.kanban);

    const task = await kanban.addTask({
      title: '이미 실행 중인 태스크',
      description: '',
      type: 'feature',
      priority: 'high',
      assignee: 'cto',
      created_by: 'po',
    });
    await kanban.updateTaskPhase(task.id, 'development', 'cto');
    await kanban.moveTask(task.id, 'in_progress');

    orchestrator = makeOrchestrator();

    // Orchestrator.start() 이전에 mockTmux 에 cto 세션을 미리 만들어둔다.
    // 기동 시 `isAgentRunning('cto')` 가 true 를 반환해서 재개가 건너뛰어지는지 검증.
    await mockTmux.createSession('cto', 'sleep 60');

    const beforeCreates = mockTmux.createCalls.filter(c => c.rawName === 'cto').length;
    await orchestrator.start();

    // 재개가 건너뛰어져야 한다 → cto 세션 create 가 추가로 발생하지 않는다
    await sleep(200);
    const afterCreates = mockTmux.createCalls.filter(c => c.rawName === 'cto').length;
    expect(afterCreates).toBe(beforeCreates);
  });

  it('같은 역할(assignee) 태스크 2개가 동시에 들어와도 한 개만 디스패치되고 다른 하나는 대기한다', async () => {
    orchestrator = makeOrchestrator();
    await orchestrator.start();

    const paths = getProjectPaths(project.root);
    const kanban = new KanbanManager(paths.kanban);

    // po 에게 할당된 두 태스크를 빠르게 연속 생성 → processNewTasks 가 병렬 디스패치 시도
    await kanban.addTask({
      title: 'po 태스크 A',
      description: '',
      type: 'feature',
      priority: 'high',
      assignee: 'po',
      created_by: 'ceo',
    });
    await kanban.addTask({
      title: 'po 태스크 B',
      description: '',
      type: 'feature',
      priority: 'high',
      assignee: 'po',
      created_by: 'ceo',
    });

    // 첫 번째 po 세션이 뜰 때까지 대기
    await waitFor(
      () => mockTmux.findSession('po') !== undefined,
      { timeoutMs: 3000, label: '첫 po 세션 생성' },
    );

    // 역할 직렬화: 동시에 같은 역할로 세션이 두 번 생성돼선 안 된다
    await sleep(200);
    const poCreates = mockTmux.createCalls.filter(c => c.rawName === 'po');
    expect(poCreates.length).toBe(1);
  });

  it('stop() 은 모든 활성 세션을 종료하고 활성 자문가도 제거한다', async () => {
    orchestrator = makeOrchestrator();
    await orchestrator.start();

    await orchestrator.spawnConsultant({
      expertise: '테스트 자문가',
      context: '',
      questions: ['테스트'],
      requested_by: 'ceo',
    });
    await orchestrator.spawnConsultant({
      expertise: '또다른 자문가',
      context: '',
      questions: ['테스트'],
      requested_by: 'ceo',
    });

    expect(mockTmux.getActiveSessionNames().length).toBeGreaterThanOrEqual(2);
    expect(orchestrator.getInternals().activeConsultants.size).toBe(2);

    await orchestrator.stop();

    expect(mockTmux.getActiveSessionNames()).toHaveLength(0);
  });
});
