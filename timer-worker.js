// Content-page timers can be throttled while the MAX tab is in the background.
// Keep short export pacing delays in the extension service worker instead.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'max-archive-wait') return;
  if (!Number.isInteger(message.ms) || message.ms < 0 || message.ms > 15000) {
    respond({ok: false}); return;
  }
  setTimeout(() => respond({ok: true}), message.ms);
  return true;
});
