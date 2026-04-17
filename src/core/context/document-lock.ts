import { writeFile, unlink, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export class DocumentLock {
  private lockPath: string;

  constructor(documentPath: string) {
    this.lockPath = documentPath + '.lock';
  }

  async acquire(owner: string, retries = 10, delay = 200): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      if (!existsSync(this.lockPath)) {
        await writeFile(this.lockPath, JSON.stringify({
          owner,
          pid: process.pid,
          acquired_at: new Date().toISOString(),
        }));
        return true;
      }

      // stale lock 감지 (10초 이상)
      try {
        const info = await stat(this.lockPath);
        if (Date.now() - info.mtimeMs > 10000) {
          await this.release();
          continue;
        }
      } catch {
        continue;
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return false;
  }

  async release(): Promise<void> {
    try {
      await unlink(this.lockPath);
    } catch {
      // 이미 삭제됨
    }
  }

  isLocked(): boolean {
    return existsSync(this.lockPath);
  }
}
