(() => {
  const marker = 'max-archive-download-capture';
  const originalClick = HTMLAnchorElement.prototype.click;
  let active = null;

  function disarm() {
    if (active?.timer) clearTimeout(active.timer);
    active = null;
    if (HTMLAnchorElement.prototype.click === captureClick) HTMLAnchorElement.prototype.click = originalClick;
  }

  function captureClick() {
    if (active && this.hasAttribute('download')) {
      const nonce = active.nonce;
      const href = this.href;
      const name = this.download || '';
      disarm();
      window.postMessage({ marker, type: 'captured', nonce, href, name }, location.origin);
      return;
    }
    return originalClick.call(this);
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.marker !== marker) return;
    const { type, nonce } = event.data;
    if (type === 'cancel' && active?.nonce === nonce) { disarm(); return; }
    if (type !== 'arm' || typeof nonce !== 'string' || nonce.length > 100) return;
    disarm();
    active = { nonce, timer: setTimeout(disarm, 16000) };
    HTMLAnchorElement.prototype.click = captureClick;
    window.postMessage({ marker, type: 'ready', nonce }, location.origin);
  });
})();
