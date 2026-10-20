const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const routes = new Set(['/test/stream-fixture.html', '/fixtures/browser.js', '/fixtures/photo.svg', '/content.js', '/download-bridge.js', '/zip.js', '/format.js']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
http.createServer(async (request, response) => {
  const route = new URL(request.url, 'http://127.0.0.1').pathname;
  if (request.method !== 'GET' || !routes.has(route)) { response.writeHead(404); response.end(); return; }
  try {
    const data = await fs.readFile(path.join(root, route.slice(1)));
    response.writeHead(200, { 'content-type': types[path.extname(route)], 'cache-control': 'no-store' }); response.end(data);
  } catch { response.writeHead(500); response.end('Fixture file unavailable'); }
}).listen(8767, '127.0.0.1', () => console.log('Synthetic MAX fixture: http://127.0.0.1:8767/test/stream-fixture.html'));
