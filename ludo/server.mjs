/* Ludora — server.mjs · tiny static server with correct PWA headers */
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';

const PORT = process.env.PORT || 8000;
const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  try {
    let url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/') url = '/index.html';
    const path = normalize(join(ROOT, url));
    if (!path.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(path);
    const ext = extname(path);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': url === '/sw.js' || url === '/index.html'
        ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`ludora serving on :${PORT}`));
