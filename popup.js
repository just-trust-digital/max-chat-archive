const state = document.getElementById('site-state');
const quick = document.getElementById('quick');
const advanced = document.getElementById('advanced');
const openReport = path => chrome.tabs.create({ url: chrome.runtime.getURL(path) });
document.getElementById('report-open').addEventListener('click', () => openReport('report.html?kind=problem'));
document.getElementById('idea-open').addEventListener('click', () => openReport('report.html?kind=idea'));
document.getElementById('known-open').addEventListener('click', () => openReport('known-issues.html'));
MaxReportStore.recoverInterrupted().then(() => MaxReportStore.list()).then(items => {
  const pending = items.filter(item => item.kind === 'crash' && item.state === 'draft').at(-1);
  if (!pending) return;
  document.getElementById('report-prompt').hidden = false;
  document.getElementById('report-pending').addEventListener('click', () => openReport('report.html?draft=' + encodeURIComponent(pending.report_id)));
}).catch(() => {});

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
