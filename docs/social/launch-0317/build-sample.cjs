const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = __dirname;
const source = fs.readFileSync(path.resolve(dir, '../../../format.js'), 'utf8');
const format = vm.runInNewContext(`${source}\nArchiveFormat`, { URL });
const chat = JSON.parse(fs.readFileSync(path.join(dir, 'sample-chat.json'), 'utf8'));
let page = '';
format.add({ add(name, contents) { if (name.endsWith('/messages.html')) page = contents; } }, 'demo', chat, 'html');
if (!page) throw new Error('ArchiveFormat did not produce HTML');
fs.writeFileSync(path.join(dir, 'sample-archive.html'), page);
