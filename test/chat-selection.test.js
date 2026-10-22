const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('select all and clear all update the selected chat count', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'export.js'), 'utf8');
  const instrumented = source.replace(/\binit\(\);\s*\}\)\(\);\s*$/, 'globalThis.selectionUnderTest = { setChatSelection, setChats(value) { chats = value; } };})();');
  assert.notEqual(instrumented, source);
  const inputs = [{ value: 'one', checked: true }, { value: 'two', checked: false }];
  const controls = new Map();
  for (const id of ['status', 'chat-list', 'start', 'cancel', 'log', 'stage-progress', 'selection-count', 'bulk-actions', 'select-all', 'select-none', 'refresh', 'show-max', 'visibility-stop', 'visibility-dialog']) {
    controls.set(id, { addEventListener() {}, querySelectorAll: selector => selector === 'input:checked' ? inputs.filter(input => input.checked) : inputs });
  }
  const document = {
    getElementById: id => controls.get(id),
    querySelector: () => ({ value: 'selected' }),
    querySelectorAll: () => []
  };
  const context = { document, location: { search: '' }, URLSearchParams };
  vm.runInNewContext(instrumented, context);
  context.selectionUnderTest.setChats([{ key: 'one' }, { key: 'two' }]);
  context.selectionUnderTest.setChatSelection(true);
  assert.deepEqual(inputs.map(input => input.checked), [true, true]);
  assert.equal(controls.get('selection-count').textContent, '2 из 2 чатов');
  context.selectionUnderTest.setChatSelection(false);
  assert.deepEqual(inputs.map(input => input.checked), [false, false]);
  assert.equal(controls.get('selection-count').textContent, '0 из 2 чатов');
  assert.equal(controls.get('start').disabled,true);
  context.selectionUnderTest.setChatSelection(true);
  assert.equal(controls.get('start').disabled,false);
});
