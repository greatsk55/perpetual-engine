import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  componentTestOutputPath,
  executableTestKinds,
  getRunnerCommand,
  type ComponentManifest,
  type ComponentSpec,
  type TestKind,
} from './components.js';

/**
 * 한 종류 테스트의 실행 결과.
 */
export interface SingleTestResult {
  kind: TestKind;
  command: string;
  exitCode: number | null;
  passed: boolean;
  /** stdout + stderr 합본 (truncated). 재시도 세션이 보고 수정할 수 있게 파일로 남긴다. */
  output: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ComponentTestRunResult {
  componentSlug: string;
  /** 명령어가 정의된 종류만 실제로 실행한다. unit/ui 는 정책상 실패면 페이즈 fail. */
  results: SingleTestResult[];
  /** 모든 실행 대상이 통과했으면 true. 명령어 정의가 0개면 true (검증 스킵). */
  allPassed: boolean;
  /** 사람이 보기 좋은 마크다운 리포트 — 재시도 세션 컨텍스트에 직접 쓰이는 본문 */
  markdown: string;
}

const DEFAULT_TEST_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 64 * 1024; // 64KB — 너무 큰 출력은 잘라서 다음 세션 컨텍스트를 망치지 않는다

/**
 * 단일 셸 명령을 spawn 으로 실행한다.
 *
 * - cwd: projectRoot
 * - shell 모드 (`bash -c <command>`) 라 파이프/리다이렉션도 지원
 * - signal 이 abort 되면 즉시 중단
 * - timeoutMs 초과 시 SIGKILL 후 timedOut=true
 */
async function execCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; output: string; durationMs: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn('bash', ['-lc', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buffer = '';
    let bytes = 0;
    let timedOut = false;
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      try { child.kill('SIGTERM'); } catch { /* noop */ }
    };
    if (signal?.aborted) {
      onAbort();
    } else if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    }, timeoutMs);

    const append = (chunk: Buffer) => {
      if (bytes >= MAX_OUTPUT_BYTES) return;
      const remaining = MAX_OUTPUT_BYTES - bytes;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      buffer += slice.toString('utf-8');
      bytes += slice.length;
      if (chunk.length > remaining) {
        buffer += `\n... [출력이 ${MAX_OUTPUT_BYTES} 바이트를 초과해서 잘렸습니다]`;
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (signal && !aborted) signal.removeEventListener('abort', onAbort);
      resolve({
        exitCode: code,
        output: buffer,
        durationMs: Date.now() - start,
        timedOut: timedOut || aborted,
      });
    });
  });
}

/**
 * 한 컴포넌트의 모든 실행 가능한 테스트를 순서대로 실행한다.
 *
 * - 명령어가 없는 종류는 건너뛴다 (검증 스킵 — 파일 존재만으로 OK)
 * - 실행 가능한 종류가 0개면 `allPassed=true` (옛 형식 매니페스트와의 하위 호환)
 * - 결과는 마크다운으로 정리되어 호출자가 파일로 저장하거나 로그로 남길 수 있다
 *
 * timeoutMsPerTest: 단일 명령 타임아웃 — 미지정 시 5분.
 */
export async function runComponentTests(params: {
  projectRoot: string;
  manifest: ComponentManifest;
  spec: ComponentSpec;
  signal?: AbortSignal;
  timeoutMsPerTest?: number;
}): Promise<ComponentTestRunResult> {
  const { projectRoot, manifest, spec, signal } = params;
  const timeoutMs = params.timeoutMsPerTest ?? DEFAULT_TEST_TIMEOUT_MS;

  const kinds = executableTestKinds(manifest, spec);
  const results: SingleTestResult[] = [];

  for (const kind of kinds) {
    if (signal?.aborted) break;
    const cmd = getRunnerCommand(manifest.tech_stack.test_runners[kind]);
    if (!cmd) continue;
    const r = await execCommand(cmd, projectRoot, timeoutMs, signal);
    results.push({
      kind,
      command: cmd,
      exitCode: r.exitCode,
      passed: r.exitCode === 0 && !r.timedOut,
      output: r.output,
      durationMs: r.durationMs,
      timedOut: r.timedOut,
    });
    // 한 종류라도 실패하면 즉시 멈추고 리포트 — 재시도 세션이 빨리 깨어나도록
    if (r.exitCode !== 0 || r.timedOut) break;
  }

  // 실행 대상이 0개였으면 (옛 형식 / 명령어 미정의) 통과로 본다 — 파일 존재 검증으로 충분.
  const allPassed = kinds.length === 0
    ? true
    : results.length === kinds.length && results.every(r => r.passed);

  return {
    componentSlug: spec.slug,
    results,
    allPassed,
    markdown: buildResultMarkdown(spec.slug, kinds, results, allPassed),
  };
}

/**
 * 테스트 실행 결과를 `docs/development/feature-<slug>/components/<comp>.test-output.md` 에 저장한다.
 * 같은 페이즈 재시도 시 워크플로우 엔진이 inputDocPaths 에 이 경로를 노출하므로
 * 다음 세션이 어떤 테스트가 어떻게 실패했는지 보고 수정할 수 있다.
 */
export async function persistTestOutput(
  projectRoot: string,
  taskSlug: string,
  result: ComponentTestRunResult,
): Promise<string> {
  const relPath = componentTestOutputPath(taskSlug, result.componentSlug);
  const fullPath = path.join(projectRoot, relPath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, result.markdown, 'utf-8');
  return relPath;
}

function buildResultMarkdown(
  slug: string,
  plannedKinds: TestKind[],
  results: SingleTestResult[],
  allPassed: boolean,
): string {
  const lines: string[] = [];
  lines.push(`# 컴포넌트 \`${slug}\` 테스트 실행 결과`);
  lines.push('');
  lines.push(`- 실행 시각: ${new Date().toISOString()}`);
  lines.push(`- 종합: ${allPassed ? '✅ 모두 통과' : '❌ 실패'}`);
  if (plannedKinds.length === 0) {
    lines.push('');
    lines.push('> tech_stack.test_runners 에 실행 명령(`command`)이 없어 자동 실행을 건너뛰었습니다.');
    lines.push('> 다음 세션에서는 가능하면 `command` 를 추가해 워크플로우 엔진이 검증할 수 있게 하세요.');
    return lines.join('\n') + '\n';
  }
  lines.push(`- 계획된 종류: ${plannedKinds.join(', ')}`);
  lines.push(`- 실행된 종류: ${results.map(r => r.kind).join(', ') || '(없음)'}`);
  lines.push('');

  for (const r of results) {
    lines.push(`## ${r.kind} — ${r.passed ? '✅ 통과' : '❌ 실패'}`);
    lines.push('');
    lines.push(`- 명령어: \`${r.command}\``);
    lines.push(`- 종료 코드: ${r.exitCode}${r.timedOut ? ' (타임아웃)' : ''}`);
    lines.push(`- 소요 시간: ${(r.durationMs / 1000).toFixed(2)}s`);
    lines.push('');
    lines.push('```');
    lines.push(r.output.trim() || '(출력 없음)');
    lines.push('```');
    lines.push('');
  }

  if (!allPassed) {
    lines.push('## 다음 행동');
    lines.push('');
    lines.push('- 실패한 테스트의 출력에서 원인을 파악하세요.');
    lines.push('- 같은 컴포넌트만 수정하고, 다른 컴포넌트 파일은 건드리지 마세요.');
    lines.push('- 수정 후 같은 명령으로 다시 실행해서 통과 여부를 확인하세요.');
  }

  return lines.join('\n') + '\n';
}
