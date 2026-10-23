/* Local report state. Never read MAX pages, archives, URLs or browser history here. */
(() => {
  const KEY = 'maxArchiveReports';
  const RUN_KEY = 'maxArchiveActiveRun';
  const MAX_REPORTS = 20;
  const MAX_AGE = 14 * 24 * 60 * 60 * 1000;
  const MAX_ATTEMPTS = 6;
  const ENDPOINT = 'https://pult.justtrust.digital/bugs/report/v1';
  const VALID_KINDS = new Set(['problem', 'idea', 'crash']);
  const VALID_COMPONENTS = new Set(['popup', 'export', 'recovery', 'extension']);
  const EXPECTED = new Set([
    'MAX_HIDDEN', 'EXPORT_BUSY', 'ARCHIVE_LIMIT', 'DIRECTORY_WRITE',
    'CHECKPOINT_WRITE', 'USER_CANCELLED', 'TAB_NOT_OPEN', 'TAB_DISCONNECTED', 'CHAT_NOT_FOUND'
  ]);
  const now = () => Date.now();
  const uuid = () => crypto.randomUUID();
  const storage = () => chrome.storage.local;
  const cleanCode = code => /^[A-Z][A-Z0-9_]{0,47}$/.test(code || '') ? code : 'UNEXPECTED_ERROR';
  const cleanComponent = component => VALID_COMPONENTS.has(component) ? component : 'extension';
  const cleanKind = kind => VALID_KINDS.has(kind) ? kind : 'problem';
  const active = report => report && now() - Date.parse(report.created_at) < MAX_AGE;

  async function list() {
    const value = (await storage().get(KEY))[KEY];
    return Array.isArray(value) ? value.filter(active).slice(-MAX_REPORTS) : [];
  }
  async function save(items) {
    await storage().set({ [KEY]: items.filter(active).slice(-MAX_REPORTS) });
  }
  async function get(id) {
    return (await list()).find(item => item.report_id === id) || null;
  }
  async function put(report) {
    const items = (await list()).filter(item => item.report_id !== report.report_id);
    items.push(report);
    await save(items);
    return report;
  }
  async function create(kind, technical = {}) {
    kind = cleanKind(kind);
    const report = {
      report_id: uuid(),
      product: 'maxexport',
      kind,
      created_at: new Date().toISOString(),
      release: chrome.runtime.getManifest().version,
      environment: 'browser-extension',
      component: cleanComponent(technical.component),
      error_code: technical.error_code ? cleanCode(technical.error_code) : (kind === 'crash' ? 'UNEXPECTED_ERROR' : 'NO_ERROR'),
      text: '',
      contact: '',
      state: 'draft',
      attempts: 0,
      next_attempt_at: null
    };
    return put(report);
  }
  async function recordSerious(error, component = 'export') {
    const code = cleanCode(error?.code);
    if (EXPECTED.has(code)) return null;
    return create('crash', { error_code: code, component });
  }
  async function update(id, values) {
    const report = await get(id);
    if (!report) throw new Error('Отчёт не найден в этом браузере.');
    if (report.attempts) throw new Error('Отчёт уже отправлялся. Для нового текста создайте новый отчёт.');
    report.text = String(values.text || '').trim().slice(0, 1500);
    report.contact = String(values.contact || '').trim().slice(0, 120);
    report.kind = cleanKind(values.kind || report.kind);
    report.state = 'draft';
    return put(report);
  }
  async function remove(id) {
    await save((await list()).filter(item => item.report_id !== id));
  }
  function payload(report) {
    return {
      report_id: report.report_id,
      product: 'maxexport',
      report_kind: report.kind,
      created_at: report.created_at,
      release: report.release,
      environment: report.environment,
      component: report.component,
      error_code: report.error_code,
      text: report.text,
      contact: report.contact
    };
  }
  async function send(id) {
    const report = await get(id);
    if (!report) throw new Error('Отчёт не найден в этом браузере.');
    if (report.state === 'sent') return report;
    if (report.attempts >= MAX_ATTEMPTS) throw new Error('Лимит попыток достигнут. Отчёт сохранён в браузере.');
    if (report.next_attempt_at && now() < Date.parse(report.next_attempt_at)) throw new Error('Повторите отправку немного позже. Отчёт сохранён в браузере.');
    if (!report.text.trim()) throw new Error('Опишите проблему или предложение.');
    report.attempts += 1;
    report.state = 'queued';
    await put(report);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let retrySeconds = Math.min(86400, 30 * 2 ** (report.attempts - 1));
    let terminal = false;
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(report)), credentials: 'omit',
        referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal
      });
      if (response.status === 429) {
        const header = response.headers.get('Retry-After');
        const value = Number(header);
        const seconds = Number.isFinite(value) ? value : (Date.parse(header) - now()) / 1000;
        if (Number.isFinite(seconds) && seconds > 0) retrySeconds = Math.max(retrySeconds, Math.min(86400, seconds));
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 429) terminal = true;
      if (!response.ok) throw new Error('Приём отчёта временно недоступен.');
      const receipt = await response.json();
      if (receipt.report_id !== report.report_id || receipt.product !== 'maxexport') throw new Error('Некорректное подтверждение приёма.');
      report.state = 'sent';
      report.receipt_at = new Date().toISOString();
      report.next_attempt_at = null;
      return await put(report);
    } catch {
      report.state = terminal ? 'failed' : 'queued';
      report.next_attempt_at = terminal ? null : new Date(now() + retrySeconds * 1000).toISOString();
      await put(report);
      throw new Error(terminal ? 'Отчёт отклонён. Проверьте текст и создайте новый отчёт.' : 'Не удалось отправить. Отчёт сохранён в браузере; попробуйте позже.');
    } finally { clearTimeout(timeout); }
  }
  async function beginRun() {
    const id = uuid();
    await storage().set({ [RUN_KEY]: { id, last_heartbeat: now() } });
    return id;
  }
  async function beatRun(id) {
    const run = (await storage().get(RUN_KEY))[RUN_KEY];
    if (run?.id === id) await storage().set({ [RUN_KEY]: { id, last_heartbeat: now() } });
  }
  async function finishRun(id) {
    const run = (await storage().get(RUN_KEY))[RUN_KEY];
    if (run?.id === id) await storage().remove(RUN_KEY);
  }
  async function recoverInterrupted() {
    const run = (await storage().get(RUN_KEY))[RUN_KEY];
    if (!run || !Number.isFinite(run.last_heartbeat)) return null;
    if (now() - run.last_heartbeat < 60000) {
      const open = await chrome.tabs.query({ url: chrome.runtime.getURL('export.html*') });
      if (open.length) return null;
    }
    await storage().remove(RUN_KEY);
    return create('crash', { component: 'export', error_code: 'INTERRUPTED_EXPORT' });
  }
  globalThis.MaxReportStore = { list, get, create, recordSerious, update, remove, payload, send, beginRun, beatRun, finishRun, recoverInterrupted, expected: EXPECTED };
})();
