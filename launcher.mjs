import { spawn, execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const root = dirname(fileURLToPath(import.meta.url));
const url = `http://127.0.0.1:5173/${process.argv.includes('--model')?'ship-view.html':''}`;
const checkOnly = process.argv.includes('--check');

// A double-clicked .cmd gets whatever PATH the shell happens to have, which on a clean
// install has no node on it. Probe the usual install roots so the launcher still starts.
function findNode() {
  const candidates = [process.execPath];
  const home = homedir();
  const binaries = join(home, '.workbuddy', 'binaries', 'node', 'versions');
  if (existsSync(binaries)) {
    for (const entry of readdirSync(binaries).sort().reverse()) {
      candidates.push(join(binaries, entry, 'node.exe'), join(binaries, entry, 'node'));
    }
  }
  for (const name of ['current', 'default']) {
    candidates.push(join(binaries, name, 'node.exe'));
  }
  candidates.push(join(home, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'));
  candidates.push(join(home, 'AppData', 'Roaming', 'npm', 'node.exe'));
  candidates.push('C:\\Program Files\\nodejs\\node.exe');
  for (const command of ['node', 'nodejs']) {
    for (const dir of (process.env.PATH || '').split(delimiter)) {
      if (dir) candidates.push(join(dir, `${command}.exe`), join(dir, command));
    }
  }
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

async function probe(target) {
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(800) });
    const body = await response.text();
    if (!body.includes('THE BLACK TIDE')) throw new Error('端口 5173 已被其他程序占用，请关闭那个程序后重试。');
    return true;
  } catch (error) {
    if (error.message.includes('5173')) throw error;
    return false;
  }
}

// `start` silently does nothing on some Windows builds; rundll32 is the reliable fallback.
function openBrowser() {
  return new Promise((resolve) => {
    execFile('cmd.exe', ['/c', 'start', '', url], { windowsHide: true }, (error) => {
      if (!error) return resolve();
      execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true }, () => resolve());
    });
  });
}

const node = findNode();
if (!node) {
  console.error('没有找到 Node.js 运行环境。请安装 Node.js 18 或更高版本后重试。');
  process.exit(1);
}

try {
  if (!await probe(url)) {
    spawn(node, [join(root, 'server.mjs')], {
      cwd: root, env: { ...process.env, PORT: '5173' }, detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) { await setTimeout(150); ready = await probe(url); }
    if (!ready) throw new Error('游戏服务未能启动。请确认此文件夹中的文件完整。');
  }
  if (!checkOnly) await openBrowser();
  console.log(`黑潮号已就绪：${url}`);
  console.log('关闭游戏：在本文件夹双击「结束游戏.cmd」。');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
