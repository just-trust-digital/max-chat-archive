// Content-page timers can be throttled while the MAX tab is in the background.
// Keep short export pacing delays in the extension service worker instead.
// Contact details and report screenshots belong to extension pages, not MAX content scripts.
chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}).catch(() => {
  console.error('MAX Archive: could not restrict local storage access.');
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'max-archive-show') {
    if (!sender.tab?.id) { respond({ok:false}); return; }
    (async () => {
      await chrome.tabs.update(sender.tab.id, {active:true});
      if (chrome.windows?.update && sender.tab.windowId != null) {
        try { await chrome.windows.update(sender.tab.windowId, {focused:true}); } catch { /* Visibility is verified in the content script. */ }
      }
      respond({ok:true});
    })().catch(() => respond({ok:false}));
    return true;
  }
  if (message?.type !== 'max-archive-wait') return;
  if (!Number.isInteger(message.ms) || message.ms < 0 || message.ms > 15000) {
    respond({ok: false}); return;
  }
  setTimeout(() => respond({ok: true}), message.ms);
  return true;
});
