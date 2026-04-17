import { TmuxAdapter } from '../../../src/core/session/tmux-adapter.js';

/**
 * In-memory TmuxAdapter substitute for E2E tests.
 *
 * 실제 tmux/Claude CLI 실행 대신 세션 생성/종료를 메모리에서 추적한다.
 * `createSession` 에 넘겨진 command 는 그대로 보관해 테스트에서 검증할 수 있다.
 *
 * `TmuxAdapter`를 상속한다 — `SessionManager(tmux)` 에 바로 주입 가능.
 */
export interface MockSessionRecord {
  sessionName: string;
  rawName: string;
  command: string;
  createdAt: number;
}

export class MockTmuxAdapter extends TmuxAdapter {
  private sessions = new Map<string, MockSessionRecord>();
  public createCalls: MockSessionRecord[] = [];
  public killCalls: string[] = [];
  public sendKeysCalls: Array<{ name: string; keys: string }> = [];

  private prefix: string;

  constructor(sessionPrefix = 'ip') {
    super(sessionPrefix);
    this.prefix = sessionPrefix;
  }

  private prefixed(name: string): string {
    return `${this.prefix}-${name}`;
  }

  async checkInstalled(): Promise<void> {
    // 항상 성공 — 테스트 환경에서는 tmux 검사 건너뛰기
  }

  async createSession(name: string, command: string): Promise<void> {
    const sessionName = this.prefixed(name);
    const record: MockSessionRecord = {
      sessionName,
      rawName: name,
      command,
      createdAt: Date.now(),
    };
    this.sessions.set(sessionName, record);
    this.createCalls.push(record);
  }

  async killSession(name: string): Promise<void> {
    const sessionName = this.prefixed(name);
    this.sessions.delete(sessionName);
    this.killCalls.push(name);
  }

  async killAllSessions(): Promise<void> {
    for (const sessionName of this.sessions.keys()) {
      this.killCalls.push(sessionName);
    }
    this.sessions.clear();
  }

  async listSessions(): Promise<string[]> {
    return Array.from(this.sessions.keys());
  }

  async hasSession(name: string): Promise<boolean> {
    return this.sessions.has(this.prefixed(name));
  }

  async sendKeys(name: string, keys: string): Promise<void> {
    this.sendKeysCalls.push({ name, keys });
  }

  async capturePane(_name: string, _lines?: number): Promise<string> {
    return '';
  }

  // ----- 테스트 전용 헬퍼 -----

  /** 실제로 살아있는 세션 이름 목록 (prefix 포함) */
  getActiveSessionNames(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** rawName (prefix 없는 원래 이름) 으로 세션 찾기 */
  findSession(rawName: string): MockSessionRecord | undefined {
    return this.sessions.get(this.prefixed(rawName));
  }

  /** "세션이 끝났다"고 가정하고 수동으로 제거 — 자문 전문가 소멸 테스트용 */
  simulateSessionExit(rawName: string): void {
    this.sessions.delete(this.prefixed(rawName));
  }

  reset(): void {
    this.sessions.clear();
    this.createCalls = [];
    this.killCalls = [];
    this.sendKeysCalls = [];
  }
}
