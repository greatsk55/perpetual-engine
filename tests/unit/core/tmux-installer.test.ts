import { describe, it, expect } from 'vitest';
import { tryAutoInstallTmux } from '../../../src/core/session/tmux-installer.js';

describe('tryAutoInstallTmux', () => {
  it('지원되지 않는 플랫폼은 수동 안내를 반환한다', async () => {
    const result = await tryAutoInstallTmux('win32' as NodeJS.Platform);
    expect(result.attempted).toBe(false);
    expect(result.succeeded).toBe(false);
    expect(result.message).toMatch(/win32/);
    expect(result.message).toMatch(/수동으로 설치/);
  });

  it('linux 는 자동 실행하지 않고 sudo 명령어만 안내한다', async () => {
    const result = await tryAutoInstallTmux('linux');
    expect(result.attempted).toBe(false);
    expect(result.succeeded).toBe(false);
    // 패키지 매니저가 있든 없든 자동 실행은 금지
    if (result.method) {
      expect(result.message).toMatch(/sudo /);
    }
  });

  it('결과 객체는 항상 attempted/succeeded 불린을 포함한다', async () => {
    const result = await tryAutoInstallTmux('freebsd' as NodeJS.Platform);
    expect(typeof result.attempted).toBe('boolean');
    expect(typeof result.succeeded).toBe('boolean');
  });
});
