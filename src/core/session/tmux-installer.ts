import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform as osPlatform } from 'node:os';
import { logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface TmuxInstallResult {
  /** 설치를 실제로 시도했는가 */
  attempted: boolean;
  /** 성공 여부 */
  succeeded: boolean;
  /** 사용한 방법 (brew 등) */
  method?: string;
  /** 사용자에게 보여줄 메시지 — 실패/스킵 사유 또는 다음 행동 안내 */
  message?: string;
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

interface LinuxPkgMgr {
  cmd: string;
  args: string[];
}

async function detectLinuxPkgMgr(): Promise<LinuxPkgMgr | null> {
  const candidates: LinuxPkgMgr[] = [
    { cmd: 'apt-get', args: ['install', '-y', 'tmux'] },
    { cmd: 'dnf', args: ['install', '-y', 'tmux'] },
    { cmd: 'yum', args: ['install', '-y', 'tmux'] },
    { cmd: 'pacman', args: ['-S', '--noconfirm', 'tmux'] },
    { cmd: 'apk', args: ['add', 'tmux'] },
  ];
  for (const c of candidates) {
    if (await commandExists(c.cmd)) return c;
  }
  return null;
}

/**
 * tmux 자동 설치 시도.
 *
 * - macOS: brew 가 있으면 `brew install tmux` 를 바로 실행 (sudo 불필요)
 * - Linux: sudo 가 필요하므로 자동 실행하지 않고, 감지된 패키지 매니저 기준
 *   수동 명령어를 안내
 * - 그 외 플랫폼: 수동 설치 안내
 */
export async function tryAutoInstallTmux(
  platform: NodeJS.Platform = osPlatform(),
): Promise<TmuxInstallResult> {
  if (platform === 'darwin') {
    if (await commandExists('brew')) {
      try {
        logger.info('tmux 자동 설치 시도: brew install tmux');
        await execFileAsync('brew', ['install', 'tmux'], {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 5 * 60 * 1000,
        });
        return { attempted: true, succeeded: true, method: 'brew' };
      } catch (err) {
        return {
          attempted: true,
          succeeded: false,
          method: 'brew',
          message: `brew install tmux 실패: ${(err as Error).message}`,
        };
      }
    }
    return {
      attempted: false,
      succeeded: false,
      message:
        'Homebrew 가 설치되어 있지 않습니다. https://brew.sh 에서 설치 후 재시도하거나 "brew install tmux" 를 수동 실행하세요.',
    };
  }

  if (platform === 'linux') {
    const mgr = await detectLinuxPkgMgr();
    if (mgr) {
      const cmd = `sudo ${mgr.cmd} ${mgr.args.join(' ')}`;
      return {
        attempted: false,
        succeeded: false,
        method: mgr.cmd,
        message: `Linux 에서는 sudo 가 필요해 자동 설치를 생략합니다. 다음을 실행하세요: ${cmd}`,
      };
    }
    return {
      attempted: false,
      succeeded: false,
      message: '지원되는 패키지 매니저(apt-get/dnf/yum/pacman/apk)를 찾지 못했습니다. tmux 를 수동으로 설치하세요.',
    };
  }

  return {
    attempted: false,
    succeeded: false,
    message: `지원되지 않는 플랫폼(${platform})입니다. tmux 를 수동으로 설치하세요.`,
  };
}
