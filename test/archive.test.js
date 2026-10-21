const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({ TextEncoder, Blob, URL });
const zipSource = fs.readFileSync(path.join(__dirname, '..', 'zip.js'), 'utf8');
const formatSource = fs.readFileSync(path.join(__dirname, '..', 'format.js'), 'utf8');
const { ZipArchive, ArchiveFormat } = vm.runInContext(`${zipSource}\n${formatSource}\n({ ZipArchive, ArchiveFormat })`, context);

test('ZIP contains readable UTF-8 files with matching CRC', async () => {
  const archive = new ZipArchive();
  archive.add('чат/messages.txt', 'Привет');
  archive.add('report.json', '{}');
  const bytes = new Uint8Array(await archive.blob().arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const nameLength = view.getUint16(26, true);
  const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength));
  assert.equal(name, 'чат/messages.txt');
  const dataLength = view.getUint32(18, true);
  const body = bytes.slice(30 + nameLength, 30 + nameLength + dataLength);
  assert.equal(new TextDecoder().decode(body), 'Привет');
  assert.equal(view.getUint32(14, true), ZipArchive.crc(body));
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), 2);
});

test('HTML escapes chat content and CSV neutralizes formulas', async () => {
  const chat = { title: '<script>alert(1)</script>', messages: [{ dateLabel: '2026-09-24', time: '12:00', author: '', direction: 'in', text: '=HYPERLINK("bad") <b>', attachments: [], reactions: [] }] };
  const htmlZip = new ZipArchive(); ArchiveFormat.add(htmlZip, 'chat', chat, 'html');
  const htmlBytes = new Uint8Array(await htmlZip.blob().arrayBuffer());
  const html = new TextDecoder().decode(htmlBytes);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  const csvZip = new ZipArchive(); ArchiveFormat.add(csvZip, 'chat', chat, 'csv');
  const csv = new TextDecoder().decode(new Uint8Array(await csvZip.blob().arrayBuffer()));
  assert.ok(csv.includes("'=HYPERLINK"));
});

test('date filter keeps undated messages instead of discarding them', () => {
  const rows = [{ dateLabel: '2026-09-20', time: '', attachments: [], reactions: [] }, { dateLabel: '', time: '', attachments: [], reactions: [] }];
  const result = ArchiveFormat.filter(rows, { from: '2026-09-23', to: '', media: true, links: true, reactions: true });
  assert.equal(result.length, 1);
  assert.equal(result[0].dateLabel, '');
});

test('date parser recognizes Russian MAX-style separators', () => {
  assert.equal(ArchiveFormat.dateOf({ dateLabel: '24 сентября 2026' }), '2026-09-24');
  assert.equal(ArchiveFormat.dateOf({ dateLabel: '24.09.2026' }), '2026-09-24');
  assert.match(ArchiveFormat.dateOf({ dateLabel: '24 сентября' }), /^\d{4}-09-24$/);
});

test('English MAX dates and relative days are recognized for filtering', () => {
  assert.equal(ArchiveFormat.dateOf({ dateLabel: 'October 18, 2026' }), '2026-10-18');
  assert.equal(ArchiveFormat.dateOf({ dateLabel: '18 October 2026' }), '2026-10-18');
  assert.equal(ArchiveFormat.dateOf({ dateLabel: 'Today' }), ArchiveFormat.dateOf({ dateLabel: 'Сегодня' }));
  assert.equal(ArchiveFormat.dateOf({ dateLabel: 'Yesterday' }), ArchiveFormat.dateOf({ dateLabel: 'Вчера' }));
  const result = ArchiveFormat.filter([
    { dateLabel: 'October 14, 2026', attachments: [] },
    { dateLabel: 'October 18, 2026', attachments: [] }
  ], { from: '2026-10-18', to: '2026-10-18', media: true });
  assert.equal(result.length, 1);
});

test('archive formats include the normalized date and sender', async () => {
  const messages = ArchiveFormat.filter([{
    dateLabel: '18 октября 2026', time: '17:58', author: 'Екатерина Волкова',
    direction: 'in', text: 'Добрый вечер', attachments: [], reactions: []
  }], { from: '', to: '', media: true, links: true, reactions: true });
  assert.equal(messages[0].date, '2026-10-18');
  const zip = new ZipArchive();
  ArchiveFormat.add(zip, 'chat', { title: 'Чат', messages }, 'html');
  const archiveBytes = new Uint8Array(await zip.blob().arrayBuffer());
  const content = new TextDecoder().decode(archiveBytes);
  assert.ok(content.includes('Екатерина Волкова · 18.10.2026 17:58'));
});

test('HTML groups days and embeds only downloaded media, with document links', () => {
  let html;
  const message = (dateLabel, attachments = []) => ({ dateLabel, time: '12:00', text: 'Сообщение', author: 'Автор', attachments, reactions: [] });
  ArchiveFormat.add({ add(_name, value) { html = value; } }, 'chat', { title: 'Чат', messages: [
    message('October 18, 2026', [
      { kind: 'photo', name: 'Фото', localPath: 'media/photo #1.webp' },
      { kind: 'file', mimeType: 'video/mp4', name: 'Ролик', localPath: 'media/video.mp4', posterPath:'media/cover.jpg' },
      { kind: 'voice', name: 'Голосовое', localPath: 'media/voice.ogg' },
      { kind: 'audio', mimeType: 'audio/webm', name: 'Голосовое WebM', localPath: 'media/voice.webm' },
      { kind: 'file', name: 'Документ.pdf', localPath: 'media/doc.pdf' },
      { kind: 'photo', name: 'Не скачано', url: 'https://i.oneme.ru/remote.jpg' }
    ]), message('October 18, 2026'), message('October 19, 2026'), message('')
  ] }, 'html');
  assert.equal((html.match(/class="day-separator"/g) || []).length, 3);
  assert.match(html, /Дата неизвестна/);
  assert.match(html, /<img[^>]+src="media\/photo%20%231.webp"/);
  assert.match(html, /<video[^>]+controls/);
  assert.match(html, /poster="media\/cover.jpg"/);
  assert.match(html, /<audio[^>]+controls/);
  assert.equal((html.match(/<audio /g) || []).length, 2);
  assert.match(html, /href="media\/doc.pdf"/);
  assert.doesNotMatch(html, /<img[^>]+src="https:/);
  assert.match(html, /href="https:\/\/i.oneme.ru\/remote.jpg"/);
});

test('HTML never accepts executable or traversing attachment paths', () => {
  let html;
  const attachments = ['javascript:alert(1)', '../private.jpg', 'media/../private.jpg'].map(localPath => ({ kind: 'photo', localPath, name: '<script>bad</script>' }));
  ArchiveFormat.add({ add(_name, value) { html = value; } }, 'chat', { title: 'Чат', messages: [{ time: '', text: '', attachments, reactions: [] }] }, 'html');
  assert.doesNotMatch(html, /src="|href="|<script>/);
});


test('Russian 24-hour timestamps and explicit anonymization preserve the original text', () => {
 const input=[{author:'Имя',forwardedFrom:'Источник',dateLabel:'October 6, 2026',time:'03:53 PM ред.',text:'Текст',attachments:[],reactions:[]}];
 const named=ArchiveFormat.filter(input,{media:true});
 assert.equal(named[0].time,'15:53');
 let html;ArchiveFormat.add({add(name,value){if(name.endsWith('.html')) html=value;}},'chat',{title:'Чат',messages:named},'html');
 assert.ok(html.includes('Имя · 06.10.2026 15:53'));
 assert.ok(html.includes('Переслано от: Источник'));
 const anonymous=ArchiveFormat.filter(input,{media:true,anonymize:true});
 assert.equal(anonymous[0].author,'');assert.equal(anonymous[0].forwardedFrom,'');assert.equal(anonymous[0].text,'Текст');
});


test('participant files and selected attachment types obey privacy options',()=>{
 const chat={title:'Группа',participants:[{name:'Контакт',role:'admin'}],participantsStatus:'complete',messages:[{author:'Контакт',forwardedFrom:'Другой автор',attachments:[{kind:'voice',url:'https://fd.oneme.ru/a.ogg',downloadable:true},{kind:'photo',url:'https://i.oneme.ru/photo',downloadable:true},{kind:'file-or-link',downloadable:true,url:'https://fd.oneme.ru/file'}]}]};
 const selected=ArchiveFormat.prepareChat(chat,{media:true,mediaTypes:{photo:false},participants:true});
 assert.deepEqual(Array.from(selected.messages[0].attachments,item=>item.kind),['voice','file-or-link']);
 const files=new Map();ArchiveFormat.add({add:(path,value)=>files.set(path,value)},'chat',selected,'html');
 assert.ok(files.has('chat/participants.json'));assert.ok(files.get('chat/messages.html').includes('Участники: 1'));
 const anonymous=ArchiveFormat.prepareChat(chat,{media:true,anonymize:true});const redacted=new Map();ArchiveFormat.add({add:(path,value)=>redacted.set(path,value)},'chat',anonymous,'html-json');
 assert.ok(!redacted.has('chat/participants.json'));assert.ok(!redacted.get('chat/messages.html').includes('Контакт'));assert.equal(anonymous.participants.length,0);
});
