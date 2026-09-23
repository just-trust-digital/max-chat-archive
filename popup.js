const state = document.getElementById('site-state');
const quick = document.getElementById('quick');
const advanced = document.getElementById('advanced');

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const ready = tab && /^https:\/\/web\.max\.ru\//.test(tab.url || '');
  state.textContent = ready ? 'MAX открыт в этой вкладке.' : 'Перейдите на web.max.ru и войдите в MAX.';
  quick.disabled = !ready;
  advanced.disabled = !ready;
  for (const [button, mode] of [[quick, 'quick'], [advanced, 'advanced']]) {
    button.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL(`export.html?tab=${tab.id}&mode=${mode}`) });
      window.close();
    });
  }
});
