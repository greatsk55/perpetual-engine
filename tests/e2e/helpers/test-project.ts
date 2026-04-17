import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';

/**
 * E2E 테스트용 임시 프로젝트 루트를 생성/정리한다.
 * vitest 의 `beforeEach` / `afterEach` 훅에서 사용할 수 있다.
 */
export class TestProject {
  public readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async create(prefix = 'ip-e2e'): Promise<TestProject> {
    const base = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
    const root = path.join(base, `project-${nanoid(6)}`);
    await mkdtempWithName(root);
    return new TestProject(root);
  }

  async cleanup(): Promise<void> {
    await rm(path.dirname(this.root), { recursive: true, force: true });
  }

  filePath(...segments: string[]): string {
    return path.join(this.root, ...segments);
  }

  async readJson<T = unknown>(...segments: string[]): Promise<T> {
    const content = await readFile(this.filePath(...segments), 'utf-8');
    return JSON.parse(content) as T;
  }

  async writeJson(segments: string[], data: unknown): Promise<void> {
    await writeFile(
      this.filePath(...segments),
      JSON.stringify(data, null, 2),
      'utf-8',
    );
  }
}

async function mkdtempWithName(dir: string): Promise<void> {
  await (await import('node:fs/promises')).mkdir(dir, { recursive: true });
}

/** 짧게 기다리기 — 파일 워처 이벤트가 비동기로 도는 경우 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * `predicate()` 가 truthy 를 반환할 때까지 폴링한다.
 * - timeoutMs 내에 참이 되지 않으면 throw.
 * - 기본 25ms 간격으로 확인.
 */
export async function waitFor<T>(
  predicate: () => Promise<T> | T,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const intervalMs = options.intervalMs ?? 25;
  const label = options.label ?? 'condition';
  const deadline = Date.now() + timeoutMs;

  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `waitFor("${label}") timed out after ${timeoutMs}ms` +
      (lastError ? ` — last error: ${(lastError as Error).message}` : ''),
  );
}
