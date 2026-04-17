import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, rm, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileStore } from '../../../src/core/state/file-store.js';

type Counter = { value: number };

describe('FileStore', () => {
  let tmpDir: string;
  let filePath: string;
  let store: FileStore<Counter>;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `ip-fs-${Date.now()}-${Math.random()}`);
    await mkdir(tmpDir, { recursive: true });
    filePath = path.join(tmpDir, 'data.json');
    await writeFile(filePath, JSON.stringify({ value: 0 }));
    store = new FileStore<Counter>(filePath);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('병렬 update 가 race 없이 모두 반영된다', async () => {
    const N = 30;
    const results = await Promise.all(
      Array.from({ length: N }, () => store.update(d => ({ value: d.value + 1 }))),
    );

    const final = await store.read();
    expect(final.value).toBe(N);
    expect(results).toHaveLength(N);
  });

  it('병렬 write 가 실패하지 않는다 (rename ENOENT 재현 방지)', async () => {
    const N = 20;
    await Promise.all(
      Array.from({ length: N }, (_, i) => store.write({ value: i })),
    );

    const final = await store.read();
    expect(typeof final.value).toBe('number');
  });

  it('같은 파일을 가리키는 여러 인스턴스 간에도 순차화된다', async () => {
    const N = 20;
    const a = new FileStore<Counter>(filePath);
    const b = new FileStore<Counter>(filePath);

    await Promise.all([
      ...Array.from({ length: N }, () => a.update(d => ({ value: d.value + 1 }))),
      ...Array.from({ length: N }, () => b.update(d => ({ value: d.value + 1 }))),
    ]);

    const final = await store.read();
    expect(final.value).toBe(N * 2);
  });

  it('쓰기가 끝나면 tmp/lock 파일이 남지 않는다', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.write({ value: i })),
    );
    const entries = await readdir(tmpDir);
    const leftover = entries.filter(e => e.endsWith('.tmp') || e.endsWith('.lock'));
    expect(leftover).toEqual([]);
  });
});
