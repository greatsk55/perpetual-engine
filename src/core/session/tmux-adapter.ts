import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TmuxNotFoundError } from '../../utils/errors.js';

const execFileAsync = promisify(execFile);

export class TmuxAdapter {
  private sessionPrefix: string;

  constructor(sessionPrefix = 'ip') {
    this.sessionPrefix = sessionPrefix;
  }

  async checkInstalled(): Promise<void> {
    try {
      await execFileAsync('tmux', ['-V']);
    } catch {
      throw new TmuxNotFoundError();
    }
  }

  async createSession(name: string, command: string): Promise<void> {
    const sessionName = this.prefixed(name);
    await execFileAsync('tmux', [
      'new-session', '-d',
      '-s', sessionName,
      '-x', '200', '-y', '50',
      command,
    ]);
  }

  async killSession(name: string): Promise<void> {
    const sessionName = this.prefixed(name);
    try {
      await execFileAsync('tmux', ['kill-session', '-t', sessionName]);
    } catch {
      // 이미 종료된 세션 무시
    }
  }

  async killAllSessions(): Promise<void> {
    const sessions = await this.listSessions();
    for (const session of sessions) {
      try {
        await execFileAsync('tmux', ['kill-session', '-t', session]);
      } catch {
        // 무시
      }
    }
  }

  async listSessions(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('tmux', [
        'list-sessions', '-F', '#{session_name}',
      ]);
      return stdout
        .trim()
        .split('\n')
        .filter(s => s.startsWith(this.sessionPrefix + '-'));
    } catch {
      return [];
    }
  }

  async hasSession(name: string): Promise<boolean> {
    const sessionName = this.prefixed(name);
    try {
      await execFileAsync('tmux', ['has-session', '-t', sessionName]);
      return true;
    } catch {
      return false;
    }
  }

  async sendKeys(name: string, keys: string): Promise<void> {
    const sessionName = this.prefixed(name);
    await execFileAsync('tmux', ['send-keys', '-t', sessionName, keys, 'Enter']);
  }

  async capturePane(name: string, lines = 100): Promise<string> {
    const sessionName = this.prefixed(name);
    try {
      const { stdout } = await execFileAsync('tmux', [
        'capture-pane', '-t', sessionName, '-p', '-S', `-${lines}`,
      ]);
      return stdout;
    } catch {
      return '';
    }
  }

  private prefixed(name: string): string {
    return `${this.sessionPrefix}-${name}`;
  }
}
