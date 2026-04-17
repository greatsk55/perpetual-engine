import { readFile, writeFile, rename, unlink, open, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const STALE_LOCK_MS = 5000;

// 동일 프로세스 내 동일 파일에 대한 write/update 를 순차화한다.
// 프로세스 간 보호는 파일 잠금(O_EXCL)이 담당한다.
const inProcessQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = inProcessQueues.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  inProcessQueues.set(
    key,
    next.finally(() => {
      if (inProcessQueues.get(key) === next) inProcessQueues.delete(key);
    }),
  );
  return next;
}

export class FileStore<T> {
  private filePath: string;
  private lockPath: string;
  private absKey: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.lockPath = filePath + '.lock';
    this.absKey = path.resolve(filePath);
  }

  async read(): Promise<T> {
    const content = await readFile(this.filePath, 'utf-8');
    return JSON.parse(content) as T;
  }

  async write(data: T): Promise<void> {
    await enqueue(this.absKey, async () => {
      await this.acquireLock();
      try {
        await this.atomicWrite(data);
      } finally {
        await this.releaseLock();
      }
    });
  }

  async update(updater: (data: T) => T): Promise<T> {
    return enqueue(this.absKey, async () => {
      await this.acquireLock();
      try {
        const data = await this.read();
        const updated = updater(data);
        await this.atomicWrite(updated);
        return updated;
      } finally {
        await this.releaseLock();
      }
    });
  }

  private async atomicWrite(data: T): Promise<void> {
    // tmp 경로를 유니크하게 생성해, 혹시라도 동일 디렉토리에서 다른 쓰기와 충돌하지 않도록 한다.
    const tmpPath = `${this.filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      await rename(tmpPath, this.filePath);
    } catch (err) {
      // 실패 시 tmp 파일이 남아있을 수 있으니 정리 시도
      try { await unlink(tmpPath); } catch { /* noop */ }
      throw err;
    }
  }

  private async acquireLock(retries = 50, delay = 50): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        // O_CREAT | O_EXCL 로 원자적으로 lock 파일 생성
        const handle = await open(this.lockPath, 'wx');
        await handle.writeFile(String(process.pid), 'utf-8');
        await handle.close();
        return;
      } catch (err: any) {
        if (err?.code !== 'EEXIST') throw err;
        // stale lock 감지 (5초 이상 된 lock)
        try {
          const { mtimeMs } = await stat(this.lockPath);
          if (Date.now() - mtimeMs > STALE_LOCK_MS) {
            try { await unlink(this.lockPath); } catch { /* 다른 프로세스가 먼저 제거 */ }
            continue;
          }
        } catch {
          // lock 파일이 사라진 경우 즉시 재시도
          continue;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error(`파일 잠금 획득 실패: ${this.filePath}`);
  }

  private async releaseLock(): Promise<void> {
    try {
      await unlink(this.lockPath);
    } catch {
      // 이미 삭제된 경우 무시
    }
  }
}
