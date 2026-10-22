const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.MAX_ARCHIVE_FIXTURE_PORT || 8767);
const routes = new Set(['/test/stream-fixture.html', '/fixtures/browser.js', '/fixtures/photo.svg', '/fixtures/export-visibility.js', '/calendar.js', '/content.js', '/download-bridge.js', '/zip.js', '/format.js', '/export.js', '/styles.css', '/test/ui-layout.html', '/test/recovery-layout.html', '/checkpoint.js', '/test/checkpoint-fixture.html', '/fixtures/checkpoint-browser.js', '/fixtures/ui-layout.js']);
for (const name of ['index.html','screen.html','screen.css','screen.js','logo-a.svg','logo-b.svg']) routes.add(`/docs/design/${name}`);
for (const route of ['/index.html','/test/messages.html','/report.json']) routes.add(route);
for (const route of ['/popup.js','/fixtures/popup-preview.js','/directory.js','/test/directory-fixture.html','/fixtures/directory-browser.js']) routes.add(route);
for(const name of ['export.svg','jtd-light.svg','jtd-dark.svg','icon-16.png','icon-32.png','icon-48.png','icon-128.png']) routes.add('/assets/'+name);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.css':'text/css; charset=utf-8' };
for (const route of ['/updates.js','/updates.css','/fixtures/updates-preview.js']) routes.add(route);
const updatePreview = html => html.replace('<script src="updates.js">', '<script src="/fixtures/updates-preview.js"></script><script src="updates.js">');
const previewMedia = { '/test/media/photo.svg': 'fixtures/photo.svg', '/test/media/sample.webm': 'fixtures/sample.webm', '/test/media/sample.wav': 'fixtures/sample.wav', '/test/media/document.txt': 'fixtures/document.txt' };
http.createServer(async (request, response) => {
  const requestUrl=new URL(request.url,'http://127.0.0.1');
  const route = requestUrl.pathname;
  if (request.method !== 'GET' || !routes.has(route) && route !== '/test/popup-preview.html' && route !== '/test/archive-preview.html' && route !== '/test/export-visibility.html' && !previewMedia[route]) { response.writeHead(404); response.end(); return; }
  try {
    if(route==='/test/popup-preview.html') {
      const html=(await fs.readFile(path.join(root,'popup.html'),'utf8')).replace('<head>','<head><base href="/">').replace('<script src="popup.js">','<script src="/fixtures/popup-preview.js"></script><script src="popup.js">').replace('href="styles.css"',`href="styles.css?theme=${requestUrl.searchParams.get('theme') || 'light'}"`);
      response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(updatePreview(html));return;
    }
    if (route === '/test/export-visibility.html') {
      const html=(await fs.readFile(path.join(root,'export.html'),'utf8')).replace('<head>','<head><base href="/">').replace('<script src="export.js">','<script src="/fixtures/export-visibility.js"></script><script src="export.js">');
      const themed=html.replace('href="styles.css"',`href="styles.css?theme=${requestUrl.searchParams.get('theme') || ''}"`);
      response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});response.end(updatePreview(themed));return;
    }
    if (route === '/report.json') {response.writeHead(200,{'content-type':'application/json'});response.end('{"fixture":true,"errors":[]}');return;}
    if (route === '/test/archive-preview.html' || route === '/test/messages.html' || route === '/index.html') {
      const source = await fs.readFile(path.join(root, 'format.js'), 'utf8');
      const format = vm.runInNewContext(`${source}\nArchiveFormat`, { URL });
      const chat = JSON.parse(await fs.readFile(path.join(root, 'fixtures/archive-preview.json'), 'utf8'));
      let html;
      if(route==='/index.html') format.addIndex({add(_name,value){html=value;}},[{title:chat.title,path:'test',messages:chat.messages.length,complete:true}],'html');
      else format.add({ add(_name, value) { html = value; } }, 'sample', chat, 'html');
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
}).listen(port, '127.0.0.1', () => console.log(`Synthetic MAX fixture: http://127.0.0.1:${port}/test/stream-fixture.html`));
