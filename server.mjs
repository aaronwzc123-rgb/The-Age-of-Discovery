import { createServer } from 'node:http';
import { readFile, stat, writeFile, unlink } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const pidFile = resolve(root, '.server.pid');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(root + sep) || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!(await stat(path)).isFile()) throw new Error('Not a file');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404).end('Not found');
  }
});
// Record the PID so 「结束游戏」can shut down exactly this process without guessing.
server.listen(port, '127.0.0.1', async () => {
  await writeFile(pidFile, String(process.pid), 'utf8');
  console.log(`海盗船场景：http://localhost:${port}`);
});
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); });
process.on('exit', () => { unlink(pidFile, () => {}); });
