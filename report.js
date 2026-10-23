(() => {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let report = null;
  let screenshots = [];
  let processingImages = false;
  const form = $('report-form');
  const status = $('report-status');
  const payload = $('report-payload');
  const message = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  function values() {
    return { kind: report?.kind === 'crash' ? 'crash' : ($('report-kind').value || 'idea'), text: $('report-text').value, contact: $('report-contact').value, screenshots };
  }
  function render() {
    if (!report) return;
    const draft = { ...report, ...values() };
    const data = MaxReportStore.payload(draft);
    const kind = { problem: 'Проблема', idea: 'Обратная связь', crash: 'Ошибка экспорта' }[data.report_kind];
    const section = { popup: 'Меню', export: 'Экспорт', recovery: 'История экспорта', extension: 'Расширение' }[data.component] || 'Расширение';
    payload.textContent = `Текст: ${data.text || '—'}\nКонтакт: ${data.contact || 'Не указан'}\nСкриншоты: ${screenshots.length || report.sent_screenshot_count || 0}\nТема: ${kind}\nВерсия: ${data.release}\nКод ошибки: ${data.error_code === 'NO_ERROR' ? 'Нет' : data.error_code}\nРаздел: ${section}\nНомер обращения: ${data.report_id}\nСоздано: ${data.created_at}\nПродукт: MAX Архив\nСреда: Расширение браузера`;
  }
  function renderImages() {
    const list = $('report-images');
    list.replaceChildren();
    $('report-image-consent-row').hidden = screenshots.length === 0;
    screenshots.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'report-image';
      const preview = document.createElement('img');
      preview.src = 'data:image/webp;base64,' + item.data;
      preview.alt = `Скриншот ${index + 1}`;
      const note = document.createElement('p');
      note.textContent = `Скриншот ${index + 1} · ${Math.ceil(item.data.length * 3 / 4 / 1024)} КБ`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'text-button';
      remove.textContent = 'Убрать';
      remove.setAttribute('aria-label', `Убрать скриншот ${index + 1}`);
      remove.disabled = Boolean(report?.attempts);
      remove.addEventListener('click', async () => {
        try {
          const updated = screenshots.filter((_, itemIndex) => itemIndex !== index);
          report = await MaxReportStore.update(report.report_id, { ...values(), screenshots: updated });
          screenshots = updated;
          $('report-image-consent').checked = false;
          renderImages(); render();
        } catch (error) { message(error.message, true); }
      });
      card.append(preview, note, remove);
      list.append(card);
    });
  }
  async function encodeScreenshot(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
      throw new Error('Выберите PNG, JPEG или WebP размером до 12 МБ.');
    }
    let image;
    try { image = await createImageBitmap(file); }
    catch { throw new Error('Не удалось открыть изображение. Выберите другой файл.'); }
    try {
      if (image.width * image.height > 32_000_000) throw new Error('Скриншот слишком большой. Уменьшите его перед добавлением.');
      const canvas = document.createElement('canvas');
      for (const edge of [1280, 1100, 900]) {
        const scale = Math.min(1, edge / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.8, 0.65, 0.5]) {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
          if (blob?.type !== 'image/webp') throw new Error('Браузер не смог подготовить скриншот.');
          if (blob.size > 160 * 1024) continue;
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('Не удалось прочитать скриншот.'));
            reader.readAsDataURL(blob);
          });
          return { mime: 'image/webp', data };
        }
      }
      throw new Error('Скриншот слишком подробный. Обрежьте его и попробуйте ещё раз.');
    } finally { image.close(); }
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
    screenshots = report.screenshots || [];
    renderImages();
    if (report.kind === 'crash') { $('report-kind').disabled = true; message('Экспорт неожиданно прервался. Опишите, что вы делали, и проверьте отчёт.'); }
    if (report.attempts) {
      for (const id of ['report-kind', 'report-text', 'report-contact', 'report-files', 'report-file-button']) $(id).disabled = true;
      $('report-send').textContent = report.state === 'sent' ? 'Отправлено' : 'Повторить отправку';
      $('report-send').disabled = report.state === 'sent' || report.state === 'failed';
      if (report.state === 'queued') message('Не удалось отправить; попробуйте позже.');
      if (report.state === 'sent') { message('Обращение получено. Спасибо.'); $('report-cancel').textContent = 'Закрыть'; }
      if (report.state === 'failed') message('Отчёт отклонён. Создайте новый отчёт с другим текстом.', true);
    }
    render();
  }
  for (const id of ['report-kind', 'report-text', 'report-contact']) $(id).addEventListener('input', render);
  $('report-file-button').addEventListener('click', () => $('report-files').click());
  $('report-files').addEventListener('change', async event => {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    if (files.length > 2) { message('Можно добавить не более двух скриншотов.', true); return; }
    processingImages = true;
    $('report-send').disabled = true;
    try {
      const prepared = [];
      for (const file of files) prepared.push(await encodeScreenshot(file));
      report = await MaxReportStore.update(report.report_id, { ...values(), screenshots: prepared });
      screenshots = prepared;
      $('report-image-consent').checked = false;
      renderImages(); render(); message('Проверьте скриншоты перед отправкой.');
    } catch (error) { message(error.message, true); }
    finally { processingImages = false; $('report-send').disabled = false; }
  });
  $('report-cancel').addEventListener('click', async () => {
    try {
      if (report && report.state !== 'sent') await MaxReportStore.remove(report.report_id);
      if (history.length > 1) history.back();
      else window.close();
    } catch { message('Не удалось закрыть обращение. Попробуйте ещё раз.', true); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (processingImages) return;
    if (!$('report-consent').checked) { message('Подтвердите отправку после проверки отчёта.', true); return; }
    if (screenshots.length && !$('report-image-consent').checked) { message('Проверьте скриншоты и подтвердите их отправку.', true); return; }
    $('report-send').disabled = true;
    $('report-cancel').disabled = true;
    try {
      if (!report.attempts) await save();
      report = await MaxReportStore.send(report.report_id);
      message('Обращение получено. Спасибо.');
      $('report-send').textContent = 'Отправлено';
      $('report-cancel').textContent = 'Закрыть';
      screenshots = [];
      renderImages(); render();
      for (const id of ['report-kind', 'report-text', 'report-contact', 'report-files', 'report-file-button']) $(id).disabled = true;
    } catch (error) {
      message(error.message, true);
      report = await MaxReportStore.get(report.report_id);
      if (report?.attempts) {
        for (const id of ['report-kind', 'report-text', 'report-contact', 'report-files', 'report-file-button']) $(id).disabled = true;
        $('report-send').textContent = 'Повторить отправку';
      }
      $('report-send').disabled = report?.state === 'failed';
    } finally { $('report-cancel').disabled = false; }
  });
  init().catch(() => { message('Не удалось открыть обращение. Попробуйте ещё раз.', true); $('report-send').disabled = true; });
})();
