const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadContent(document) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const instrumented = source.replace(/\}\)\(\);\s*$/, 'globalThis.contentUnderTest = { extract, snapshot, attachmentsOf, exportOpen, openChat };})();');
  assert.notEqual(instrumented, source, 'content test seam should load');
  const context = {
    document,
    location: { href: 'https://web.max.ru/' },
    URL,
    setTimeout,
    getComputedStyle: element => ({ overflowY: element.overflowY || 'visible' }),
    chrome: { runtime: { onConnect: { addListener() {} } } }
  };
  vm.runInNewContext(instrumented, context);
  return context.contentUnderTest;
}

function messageRow({ author = 'Екатерина Волкова', text = 'Добрый вечер', time = '17:58', previousElementSibling = null, ownDate = null } = {}) {
  const header = { textContent: author, innerText: author };
  const textElement = { textContent: text, innerText: text };
  const meta = { textContent: time, innerText: time };
  const bubble = {
    textContent: `${author}\n${text}\n${time}`,
    innerText: `${author}\n${text}\n${time}`,
    querySelector(selector) { return selector.includes('.text') ? textElement : null; },
    querySelectorAll(selector) { return selector.includes('.text') ? [textElement] : []; }
  };
  const message = {
    querySelector(selector) {
      if (selector === '.bubbleContent') return bubble;
      if (selector === 'time') return null;
      if (selector.includes('meta')) return meta;
      return null;
    }
  };
  const row = {
    classList: { contains: () => false },
    parentElement: null,
    querySelector(selector) {
      if (selector === '.message') return message;
      if (selector.includes('header')) return header;
      if (selector.includes('sender') || selector.includes('author')) return null;
      return null;
    },
    querySelectorAll() { return []; },
    closest() { return { previousElementSibling, querySelector: () => ownDate ? { textContent: ownDate } : null }; }
  };
  return row;
}

test('date separator applies to following messages in the same day', () => {
  const first = messageRow({ ownDate: '18 октября 2026' });
  const second = messageRow({ text: 'Второе сообщение', previousElementSibling: { querySelector: () => null } });
  const content = loadContent({ querySelectorAll: () => [first, second] });
  const rows = content.snapshot();
  assert.equal(rows[0].dateLabel, '18 октября 2026');
  assert.equal(rows[1].dateLabel, '18 октября 2026');
});

test('sender header and message text are separated', () => {
  const content = loadContent({});
  const result = content.extract(messageRow(), '18 октября 2026');
  assert.equal(result.author, 'Екатерина Волкова');
  assert.equal(result.text, 'Добрый вечер');
});

test('file button is captured while emoji image is ignored', () => {
  const emoji = {
    tagName: 'IMG', textContent: '',
    getAttribute: name => name === 'src' ? 'https://st.max.ru/emoji/smile.png' : null,
    closest: selector => selector.includes('emoji') ? {} : null
  };
  const title = { textContent: 'документ.pdf' };
  const file = {
    tagName: 'BUTTON', textContent: 'документ.pdf',
    getAttribute: name => name === 'aria-label' ? 'Скачать' : null,
    querySelector: selector => selector.includes('title') ? title : null
  };
  const row = {
    querySelectorAll(selector) { return selector.includes('button') ? [emoji, file] : [emoji]; }
  };
  const content = loadContent({});
  const attachments = content.attachmentsOf(row);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, 'документ.pdf');
});

test('export waits for a scrollable history before treating 30 visible messages as the archive', async () => {
  const scroller = { overflowY: 'auto', scrollHeight: 90, clientHeight: 90, scrollTop: 0, parentElement: null };
  const rows = Array.from({ length: 100 }, (_, index) => {
    const row = messageRow({ text: `Сообщение ${index}` });
    row.parentElement = scroller;
    return row;
  });
  let mounted = 30;
  const root = { querySelector: () => rows[0] };
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.openedChat' ? root : null,
    querySelectorAll: () => rows.slice(0, mounted)
  };
  const content = loadContent(document);
  setTimeout(() => { mounted = 100; scroller.scrollHeight = 1000; }, 50);
  const result = await content.exportOpen({ limit: 100 }, () => {});
  assert.equal(result.messages.length, 100);
});

test('switching chats waits for the new conversation instead of accepting old messages', async () => {
  let root = { querySelector: selector => selector.includes('messageWrapper') ? {} : { textContent: 'Первый чат' } };
  const location = { href: 'https://web.max.ru/c/first' };
  const row = {
    innerText: 'Второй чат',
    getClientRects: () => [1],
    getAttribute: () => null,
    querySelector: selector => selector === 'a[href]' ? { getAttribute: () => '/c/second' } : { textContent: 'Второй чат' },
    click() {
      setTimeout(() => {
        location.href = 'https://web.max.ru/c/second';
        root = { querySelector: selector => selector.includes('messageWrapper') ? {} : { textContent: 'Второй чат' } };
      }, 450);
    }
  };
  const list = { scrollTop: 0, clientHeight: 500 };
  const document = {
    body: {}, title: 'MAX',
    querySelector: selector => selector === '.aside' ? list : selector === '.openedChat' ? root : null,
    querySelectorAll: () => [row]
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const instrumented = source.replace(/\}\)\(\);\s*$/, 'globalThis.openChatUnderTest = openChat;})();');
  const context = { document, location, setTimeout, getComputedStyle: () => ({ overflowY: 'visible' }), chrome: { runtime: { onConnect: { addListener() {} } } } };
  vm.runInNewContext(instrumented, context);
  const started = Date.now();
  await context.openChatUnderTest({ key: '/c/second', title: 'Второй чат' });
  assert.ok(Date.now() - started >= 700, 'must wait for new chat content after clicking');
});
