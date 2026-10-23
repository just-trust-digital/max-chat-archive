(() => {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let report = null;
  const form = $('report-form');
  const status = $('report-status');
  const payload = $('report-payload');
  const message = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  function values() {
    return { kind: report?.kind === 'crash' ? 'crash' : $('report-kind').value, text: $('report-text').value, contact: $('report-contact').value };
  }
  function render() {
    if (!report) return;
    const draft = { ...report, ...values() };
    payload.textContent = JSON.stringify(MaxReportStore.payload(draft), null, 2);
    $('report-delete').hidden = false;
  }
  async function save() {
    if (!report) report = await MaxReportStore.create(values().kind);
    report = await MaxReportStore.update(report.report_id, values());
    render();
    message('Черновик сохранён в этом браузере.');
  }
  async function init() {
    report = await MaxReportStore.get(params.get('draft'));
    if (!report) report = await MaxReportStore.create(params.get('kind') || 'problem');
    $('report-kind').value = report.kind === 'idea' ? 'idea' : 'problem';
    $('report-text').value = report.text || '';
    $('report-contact').value = report.contact || '';
    if (report.kind === 'crash') { $('report-kind').disabled = true; message('Экспорт неожиданно прервался. Опишите, что вы делали, и проверьте отчёт.'); }
    if (report.attempts) {
      for (const id of ['report-kind', 'report-text', 'report-contact']) $(id).disabled = true;
      $('report-save').hidden = true;
      $('report-send').textContent = report.state === 'sent' ? 'Отправлено' : 'Повторить отправку';
      $('report-send').disabled = report.state === 'sent' || report.state === 'failed';
      if (report.state === 'queued') message('Отчёт сохранён. Если отправка не удалась, повторите её позже.');
      if (report.state === 'sent') message('Отчёт получен. Спасибо.');
      if (report.state === 'failed') message('Отчёт отклонён. Создайте новый отчёт с другим текстом.', true);
    }
    render();
  }
  for (const id of ['report-kind', 'report-text', 'report-contact']) $(id).addEventListener('input', render);
  $('report-save').addEventListener('click', () => save().catch(() => message('Не удалось сохранить черновик.', true)));
  $('report-delete').addEventListener('click', async () => {
    await MaxReportStore.remove(report.report_id);
    report = null;
    form.reset();
    payload.textContent = '';
    $('report-delete').hidden = true;
    message('Черновик удалён.');
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!$('report-consent').checked) { message('Подтвердите отправку после проверки отчёта.', true); return; }
    $('report-send').disabled = true;
    try {
      if (!report.attempts) await save();
      report = await MaxReportStore.send(report.report_id);
      message('Отчёт получен. Спасибо.');
      $('report-send').textContent = 'Отправлено';
      $('report-save').hidden = true;
      for (const id of ['report-kind', 'report-text', 'report-contact']) $(id).disabled = true;
    } catch (error) {
      message(error.message, true);
      report = await MaxReportStore.get(report.report_id);
      if (report?.attempts) {
        for (const id of ['report-kind', 'report-text', 'report-contact']) $(id).disabled = true;
        $('report-save').hidden = true;
        $('report-send').textContent = 'Повторить отправку';
      }
      $('report-send').disabled = report?.state === 'failed';
    }
  });
  init().catch(() => message('Не удалось открыть черновик отчёта.', true));
})();
