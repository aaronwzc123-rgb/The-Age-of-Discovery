// Zero-dependency render probe: drives system Chrome over CDP to confirm the upgraded ship
// renders, the brig exists, and the page logs no errors. Pass a state name to screenshot it.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const state = process.argv[2] || 'deck';
const port = 9222 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'ship-probe-'));
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
const events = [];
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  else if (message.method) events.push(message);
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
await send('Log.enable', {}, sessionId);

const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (response.result?.exceptionDetails) {
    throw new Error(`${response.result.exceptionDetails.text} ${response.result.exceptionDetails.exception?.description || ''}`);
  }
  return response.result?.result?.value;
};

await send('Page.navigate', { url: 'http://127.0.0.1:5173/?qa=1' }, sessionId);
let booted = false;
for (let i = 0; i < 160 && !booted; i++) {
  await setTimeout(250);
  booted = await evaluate('Boolean(window.__THREE_GAME_TEST_HOOKS__)').catch(() => false);
}
if (!booted) {
  const diag = await evaluate(`(() => ({
    url: location.href,
    hasCanvas: Boolean(document.querySelector('#scene canvas')),
    loading: document.querySelector('#loading')?.textContent?.slice(0, 200),
    bodyStart: document.body?.innerHTML?.slice(0, 160),
  }))()`).catch((error) => ({ evaluateError: error.message }));
  const consoleErrors = events
    .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Log.entryAdded')
    .map((event) => JSON.stringify(event.params).slice(0, 300));
  console.log(JSON.stringify({ error: 'page did not boot: QA hooks never appeared', diag, consoleErrors }, null, 2));
  ws.close(); chrome.kill(); process.exit(1);
}

await evaluate(`window.__THREE_GAME_TEST_HOOKS__.setState(${JSON.stringify(state)})`);
await evaluate('window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false)'); await setTimeout(1200); if (process.env.WIDE) { await evaluate('document.querySelector("#view-button").click()'); } await setTimeout(2200);

const report = await evaluate(`(() => {
  const d = window.__THREE_GAME_DIAGNOSTICS__;
  return {
    renderer: { calls: d.renderer.calls, triangles: d.renderer.triangles, geometries: d.renderer.geometries, textures: d.renderer.textures },
    state: { mode: d.state.mode, frameTimeMs: d.state.frameTimeMs },
    quality: d.quality,
  };
})()`);

const scene = await evaluate('window.__THREE_GAME_TEST_HOOKS__.inspect()');

const logs = events
  .filter((event) => event.method === 'Runtime.exceptionThrown')
  .map((event) => `exception: ${event.params?.exceptionDetails?.exception?.description || event.params?.exceptionDetails?.text}`)
  .concat(events
    .filter((event) => event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error')
    .map((event) => `error: ${event.params.entry.text}`));

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
if (shot.result?.data) writeFileSync(join('artifacts', `probe-${state}.png`), Buffer.from(shot.result.data, 'base64'));

console.log(JSON.stringify({ state, report, scene, problems: logs }, null, 2));
ws.close();
chrome.kill();
process.exit(logs.length ? 1 : 0);
