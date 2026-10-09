// Walks the captain through the physical-action loop with real key presses:
// open the hatch, climb down the companion ladder, cross the hold, open the cabin door,
// and reach the brig corridor.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9700 + Math.floor(Math.random() * 250);
const profile = mkdtempSync(join(tmpdir(), 'walk-probe-'));
mkdirSync('artifacts', { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800',
  '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(400) });
      return (await response.json()).webSocketDebuggerUrl;
    } catch { await setTimeout(200); }
  }
  throw new Error('Chrome did not expose a debugging endpoint');
}

const ws = new WebSocket(await endpoint());
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  else if (message.method === 'Runtime.exceptionThrown') {
    exceptions.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text);
  }
};
const send = (method, params = {}, sessionId) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);

const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
  return response.result?.result?.value;
};

const VK = { KeyE: 69, KeyW: 87, KeyS: 83, KeyA: 65, KeyD: 68 };
async function holdKey(code, ms) {
  const key = code.slice(3).toLowerCase();
  const base = { key, code, windowsVirtualKeyCode: VK[code], nativeVirtualKeyCode: VK[code] };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', text: key, ...base }, sessionId);
  await setTimeout(ms);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
  await setTimeout(120);
}
const releaseAll = () => Promise.all(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyE'].map((code) => {
  const key = code.slice(3).toLowerCase();
  return send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: VK[code], nativeVirtualKeyCode: VK[code] }, sessionId);
}));
const pressE = async () => { await releaseAll(); await holdKey('KeyE', 70); await releaseAll(); };

// Turning the head needs a real drag; CDP emits legacy mouse events unless pointerType is set.
async function turnHead(steps) {
  const down = { button: 'left', buttons: 1, pointerType: 'mouse', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, ...down }, sessionId);
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640 + i * 10, y: 400, ...down }, sessionId);
    await setTimeout(16);
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: 640 + steps * 10, y: 400, button: 'left', buttons: 0, pointerType: 'mouse', clickCount: 1,
  }, sessionId);
  await setTimeout(150);
}

const readState = () => evaluate('JSON.parse(JSON.stringify(window.__THREE_GAME_DIAGNOSTICS__.state))');
const readWorld = () => evaluate('JSON.parse(JSON.stringify(window.__THREE_GAME_TEST_HOOKS__.inspect()))');
const prompt = () => evaluate('document.querySelector("#action-name")?.textContent || ""');

await send('Page.navigate', { url: 'http://127.0.0.1:5173/?qa=1' }, sessionId);
for (let i = 0; i < 100; i++) {
  await setTimeout(250);
  if (await evaluate('Boolean(window.__THREE_GAME_TEST_HOOKS__)').catch(() => false)) break;
}
// Focus the canvas so the game receives key events.
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
await evaluate('window.__THREE_GAME_TEST_HOOKS__.setState("deck")');
await evaluate('document.querySelector("#scene canvas").focus()');
await setTimeout(1200);

const steps = [];
async function mark(label, note) {
  const s = await readState();
  const w = await readWorld();
  steps.push({
    label, note,
    mode: s.mode,
    y: Number(s.player.y.toFixed(2)),
    x: Number(s.player.x.toFixed(2)),
    z: Number(s.player.z.toFixed(2)),
    prompt: await prompt(),
    hatchOpen: w.hatchOpen,
    cabinDoorOpen: w.cabinDoorOpen,
  });
}

await mark('出生：站在舱口旁', 'WASD 移动，按住左键拖动转头');

// 1. The hatch: one E throws the lid back. It must NOT drop him into the hold.
await pressE();
await mark('按 E 掀开舱盖', '第一次 E 只开盖，人还在甲板上');

// 2. Walk forward to the companion ladder and climb down with S.
await holdKey('KeyW', 420);
await mark('走到舱口梯', '从舱口边挪到梯口');
await pressE();
await mark('抓住梯子', '进入 climb 状态');
await holdKey('KeyS', 900);
await mark('爬到中段', 'y 应在 3.5 与 0.45 之间');
await holdKey('KeyS', 900);
await mark('快到舱底', 'y 应接近 0.45');
await pressE();
await mark('踩进货舱', '按 E 跨过舱底');

// 3. Cross the hold aft to the cabin door, which starts shut.
await turnHead(22);
await holdKey('KeyW', 3400);
await mark('走到船长室门前', '门关着，走不过去');
await pressE();
await mark('推开船长室门', '按 E 开门');
await holdKey('KeyW', 2600);
await mark('走到牢房走廊', '穿过船长室到船尾');

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
if (shot.result?.data) writeFileSync(join('artifacts', 'walk-brig.png'), Buffer.from(shot.result.data, 'base64'));

console.log(JSON.stringify({ steps, exceptions }, null, 2));
ws.close();
chrome.kill();
process.exit(exceptions.length ? 1 : 0);
