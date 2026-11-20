// site/ 폴더를 로컬에서 띄워 보는 간단한 정적 서버.  node scripts/serve.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const PORT = Number(process.env.PORT) || 4173;

createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(SITE, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(SITE)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    // 로컬 확인용이라 항상 새 파일을 주도록 캐시를 끈다.
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
