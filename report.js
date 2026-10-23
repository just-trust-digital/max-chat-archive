(() => {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let report = null;
  const form = $('report-form');
  const status = $('report-status');
  const payload = $('report-payload');
  const message = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  function values() {
    return { kind: report?.kind === 'crash' ? 'crash' : ($('report-kind').value || 'idea'), text: $('report-text').value, contact: $('report-contact').value };
  }
  function render() {
    if (!report) return;
    const draft = { ...report, ...values() };
    const data = MaxReportStore.payload(draft);
    const kind = { problem: 'Проблема', idea: 'Обратная связь', crash: 'Ошибка экспорта' }[data.report_kind];
    const section = { popup: 'Меню', export: 'Экспорт', recovery: 'История экспорта', extension: 'Расширение' }[data.component] || 'Расширение';
    payload.textContent = `Текст: ${data.text || '—'}\nКонтакт: ${data.contact || 'Не указан'}\nТема: ${kind}\nВерсия: ${data.release}\nКод ошибки: ${data.error_code === 'NO_ERROR' ? 'Нет' : data.error_code}\nРаздел: ${section}\nНомер обращения: ${data.report_id}\nСоздано: ${data.created_at}\nПродукт: MAX Архив\nСреда: Расширение браузера`;
  }
  async function save() {
    if (!report) report = await MaxReportStore.create(values().kind);
    report = await MaxReportStore.update(report.report_id, values());
    render();
  }
  async function init() {
    report = await MaxReportStore.get(params.get('draft'));
    const existing = Boolean(report);
    if (!report) report = await MaxReportStore.create(params.get('kind') || 'idea');
    $('report-kind').value = existing || params.has('kind') ? (report.kind === 'idea' ? 'idea' : 'problem') : '';
    $('report-text').value = report.text || '';
    $('report-contact').value = report.contact || '';
    if (report.kind === 'crash') { $('report-kind').disabled = true; message('Экспорт неожиданно прервался. Опишите, что вы делали, и проверьте отчёт.'); }
    if (report.attempts) {
      for (const id of ['report-kind', 'report-text', 'report-contact']) $(id).disabled = true;
      $('report-send').textContent = report.state === 'sent' ? 'Отправлено' : 'Повторить отправку';
      $('report-send').disabled = report.state === 'sent' || report.state === 'failed';
      if (report.state === 'queued') message('Не удалось отправить; попробуйте позже.');
      if (report.state === 'sent') { message('Обращение получено. Спасибо.'); $('report-cancel').textContent = 'Закрыть'; }
      if (report.state === 'failed') message('Отчёт отклонён. Создайте новый отчёт с другим текстом.', true);
    }
    render();
  }
  for (const id of ['report-kind', 'report-text', 'report-contact']) $(id).addEventListener('input', render);
  $('report-cancel').addEventListener('click', async () => {
    try {
      if (report && report.state !== 'sent') await MaxReportStore.remove(report.report_id);
      if (history.length > 1) history.back();
      else window.close();
    } catch { message('Не удалось закрыть обращение. Попробуйте ещё раз.', true); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!$('report-consent').checked) { message('Подтвердите отправку после проверки отчёта.', true); return; }
    $('report-send').disabled = true;
    $('report-cancel').disabled = true;
    try {
      if (!report.attempts) await save();
      report = await MaxReportStore.send(report.report_id);
      message('Обращение получено. Спасибо.');
      $('report-send').textContent = 'Отправлено';
      $('report-cancel').textContent = 'Закрыть';
      for (const id of ['report-kind', 'report-text', 'report-contact']) $(id).disabled = true;
    } catch (error) {
      message(error.message, true);
      report = await MaxReportStore.get(report.report_id);
      if (report?.attempts) {
        for (const id of ['report-kind', 'report-text', 'report-contact']) $(id).disabled = true;
        $('report-send').textContent = 'Повторить отправку';
      }
      $('report-send').disabled = report?.state === 'failed';
    } finally { $('report-cancel').disabled = false; }
  });
  init().catch(() => { message('Не удалось открыть обращение. Попробуйте ещё раз.', true); $('report-send').disabled = true; });
})();
