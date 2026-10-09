import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const root = dirname(fileURLToPath(import.meta.url));
const url = 'http://127.0.0.1:5173/';
const pidFile = resolve(root, '.server.pid');

async function alive() {
  try {
    await fetch(url, { signal: AbortSignal.timeout(600) });
    return true;
  } catch {
    return false;
  }
}

// taskkill is the only thing that reliably stops a detached process tree without admin rights.
const kill = (pid) => new Promise((answer) => {
  execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => answer());
});

async function readPid() {
  try {
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

const pid = await readPid();
if (pid) {
  await kill(pid);
  await unlink(pidFile, () => {});
}

// taskkill returns before the port is actually released, so poll the port itself.
// If it is still held afterwards the service is genuinely gone and something else owns it.
let released = false;
for (let i = 0; i < 30 && !released; i++) { await setTimeout(150); released = !(await alive()); }

if (!released) {
  console.error('游戏服务仍在运行。请以管理员身份运行「结束游戏.cmd」再试一次。');
  process.exitCode = 1;
} else if (pid) {
  console.log('黑潮号已关闭，后台服务已停止。');
} else {
  console.log('黑潮号本来就没有在运行。');
}
