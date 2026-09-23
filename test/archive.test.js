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
