#!/usr/bin/env node
// npm install 직후 실행되는 훅.
// tmux 가 없으면 자동 설치(macOS) 또는 수동 설치 명령을 안내한다.
//
// 실패해도 npm install 전체를 실패시키지 않는다 — 사용자가 나중에
// `perpetual-engine start` 를 실행할 때 다시 자동 설치를 시도하기 때문.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform as osPlatform } from 'node:os';

const exec = promisify(execFile);

// npm ci / npm i --production 등에서 매번 이 훅이 돌지 않게 방어.
if (process.env.SKIP_INFINITE_POWER_POSTINSTALL === '1') {
  process.exit(0);
}
// 같은 레포 내부에서 dev 의존성 설치할 때는 건너뛴다 (CI 등)
if (process.env.CI && !process.env.INFINITE_POWER_FORCE_POSTINSTALL) {
  process.exit(0);
}

async function has(cmd) {
  try {
    await exec('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (await has('tmux')) {
    return; // 이미 설치됨
  }

  const plat = osPlatform();
  if (plat === 'darwin') {
    if (await has('brew')) {
      console.log('[perpetual-engine] tmux 가 없어 brew 로 자동 설치합니다...');
      try {
        await exec('brew', ['install', 'tmux'], {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 5 * 60 * 1000,
        });
        console.log('[perpetual-engine] ✓ tmux 설치 완료');
      } catch (err) {
        console.warn('[perpetual-engine] ⚠ tmux 자동 설치 실패 — "brew install tmux" 를 수동 실행하세요.');
        console.warn(`  사유: ${err?.message ?? err}`);
      }
      return;
    }
    console.warn('[perpetual-engine] ⚠ tmux 가 없습니다. https://brew.sh 에서 Homebrew 설치 후 "brew install tmux" 를 실행하세요.');
    return;
  }

  if (plat === 'linux') {
    const candidates = [
      { cmd: 'apt-get', hint: 'sudo apt-get install -y tmux' },
      { cmd: 'dnf', hint: 'sudo dnf install -y tmux' },
      { cmd: 'yum', hint: 'sudo yum install -y tmux' },
      { cmd: 'pacman', hint: 'sudo pacman -S --noconfirm tmux' },
      { cmd: 'apk', hint: 'sudo apk add tmux' },
    ];
    for (const c of candidates) {
      if (await has(c.cmd)) {
        console.warn(`[perpetual-engine] ⚠ tmux 가 없습니다. sudo 가 필요하므로 자동 실행하지 않습니다.\n  실행: ${c.hint}`);
        return;
      }
    }
    console.warn('[perpetual-engine] ⚠ tmux 가 없고 지원되는 패키지 매니저를 찾지 못했습니다. 수동 설치가 필요합니다.');
    return;
  }

  console.warn(`[perpetual-engine] ⚠ 플랫폼(${plat}) 자동 설치 미지원. tmux 를 수동으로 설치하세요.`);
}

main().catch(err => {
  console.warn('[perpetual-engine] postinstall 오류(무시하고 진행):', err?.message ?? err);
});
