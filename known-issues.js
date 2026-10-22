(() => {
  const REMOTE = 'https://raw.githubusercontent.com/just-trust-digital/max-chat-archive/main/known-issues.json';
  const list = document.getElementById('known-list');
  const date = document.getElementById('known-date');
  const valid = value => value && typeof value.updated_at === 'string' && Array.isArray(value.issues) && value.issues.length <= 100;
  async function load(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Список недоступен');
    const value = await response.json();
    if (!valid(value)) throw new Error('Неверный формат списка');
    return value;
  }
  function render(data, fallback) {
    date.textContent = `Обновлено: ${data.updated_at}${fallback ? ' · сохранённая версия' : ''}`;
    list.replaceChildren();
    if (!data.issues.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Подтверждённых открытых проблем пока нет.';
      list.append(empty);
      return;
    }
    for (const item of data.issues) {
      if (!/^https:\/\/github\.com\/just-trust-digital\/max-chat-archive\/issues\/\d+$/.test(item.url || '')) continue;
      const article = document.createElement('article');
      article.className = 'known-item';
      const title = document.createElement('h2');
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = String(item.title || '').slice(0, 160);
      title.append(link);
      article.append(title);
      for (const [label, value] of [['Затронутые версии', item.affected], ['Что можно сделать', item.workaround], ['Исправлено в', item.fixed_in]]) {
        if (!value) continue;
        const row = document.createElement('p');
        row.textContent = `${label}: ${String(value).slice(0, 500)}`;
        article.append(row);
      }
      list.append(article);
    }
  }
  load(REMOTE).then(data => render(data, false)).catch(async () => {
    try { render(await load('known-issues.json'), true); }
    catch { date.textContent = 'Список сейчас недоступен.'; }
  });
})();
