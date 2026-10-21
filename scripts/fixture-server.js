const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const routes = new Set(['/test/stream-fixture.html', '/fixtures/browser.js', '/fixtures/photo.svg', '/fixtures/export-visibility.js', '/content.js', '/download-bridge.js', '/zip.js', '/format.js', '/export.js', '/styles.css', '/test/ui-layout.html', '/test/recovery-layout.html', '/checkpoint.js', '/test/checkpoint-fixture.html', '/fixtures/checkpoint-browser.js', '/fixtures/ui-layout.js']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.css':'text/css; charset=utf-8' };
const previewMedia = { '/test/media/photo.svg': 'fixtures/photo.svg', '/test/media/sample.webm': 'fixtures/sample.webm', '/test/media/sample.wav': 'fixtures/sample.wav', '/test/media/document.txt': 'fixtures/document.txt' };
http.createServer(async (request, response) => {
  const requestUrl=new URL(request.url,'http://127.0.0.1');
  const route = requestUrl.pathname;
  if (request.method !== 'GET' || !routes.has(route) && route !== '/test/archive-preview.html' && route !== '/test/export-visibility.html' && !previewMedia[route]) { response.writeHead(404); response.end(); return; }
  try {
    if (route === '/test/export-visibility.html') {
      const html=(await fs.readFile(path.join(root,'export.html'),'utf8')).replace('<head>','<head><base href="/">').replace('<script src="export.js">','<script src="/fixtures/export-visibility.js"></script><script src="export.js">');
      const themed=html.replace('href="styles.css"',`href="styles.css?theme=${requestUrl.searchParams.get('theme') || ''}"`);
      response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(themed);return;
    }
    if (route === '/test/archive-preview.html') {
      const source = await fs.readFile(path.join(root, 'format.js'), 'utf8');
      const format = vm.runInNewContext(`${source}\nArchiveFormat`, { URL });
      const chat = JSON.parse(await fs.readFile(path.join(root, 'fixtures/archive-preview.json'), 'utf8'));
      let html;
      format.add({ add(_name, value) { html = value; } }, 'sample', chat, 'html');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(html); return;
    }
    if(route==='/styles.css' && ['light','dark'].includes(requestUrl.searchParams.get('theme'))) {
      const theme=requestUrl.searchParams.get('theme');
      const css=(await fs.readFile(path.join(root,'styles.css'),'utf8')).replaceAll('@media(prefers-color-scheme:dark)',theme==='dark'?'@media all':'@media not all');
      response.writeHead(200,{'content-type':'text/css; charset=utf-8','cache-control':'no-store'});response.end(css+`:root{color-scheme:${theme}}`);return;
    }
    const data = await fs.readFile(path.join(root, previewMedia[route] || route.slice(1)));
    response.writeHead(200, { 'content-type': types[path.extname(route)] || ({ '.webm': 'video/webm', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8' })[path.extname(route)], 'cache-control': 'no-store' }); response.end(data);
  } catch { response.writeHead(500); response.end('Fixture file unavailable'); }
}).listen(8767, '127.0.0.1', () => console.log('Synthetic MAX fixture: http://127.0.0.1:8767/test/stream-fixture.html'));
