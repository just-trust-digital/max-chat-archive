(() => {
  const marker = 'max-archive-download-capture';
  const originalClick = HTMLAnchorElement.prototype.click;
  let active = null;
  const mediaPrototype=typeof HTMLMediaElement==='undefined'?null:HTMLMediaElement.prototype;
  const originalPlay=mediaPrototype?.play;

  function disarm() {
    if (active?.timer) clearTimeout(active.timer);
    active = null;
    if(mediaPrototype?.play===captureAudioPlay) mediaPrototype.play=originalPlay;
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

  function captureAudioPlay() {
    if(active?.mode!=='voice') return originalPlay.call(this);
    const url=this.getAttribute('src') || this.currentSrc || this.src;
    if(!/^(https?:|blob:)/i.test(url || '')) return originalPlay.call(this);
    const job=active;
    // Capture the source before playing it. Exports do not play private recordings aloud.
    (async()=>{
      let href=url;
      if(url.startsWith('blob:')) {
        const response=await fetch(url), buffer=await response.arrayBuffer();
        if(buffer.byteLength>25*1024*1024) throw Error('voice_too_large');
        const bytes=new Uint8Array(buffer);let binary='';
        for(let index=0;index<bytes.length;index+=32768) binary+=String.fromCharCode(...bytes.subarray(index,index+32768));
        const mime=/^audio\/[a-z0-9.+-]+$/i.test(response.headers.get('content-type') || '') ? response.headers.get('content-type') : 'audio/ogg';
        href=`data:${mime};base64,${btoa(binary)}`;
      }
      if(active!==job) return;
      disarm();window.postMessage({marker,type:'captured',nonce:job.nonce,href,name:'Голосовое сообщение'},location.origin);
    })().catch(()=>{if(active===job){disarm();window.postMessage({marker,type:'captured',nonce:job.nonce,href:'',name:''},location.origin);}});
    return Promise.resolve();
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.marker !== marker) return;
    const { type, nonce, mode } = event.data;
    if (type === 'cancel' && active?.nonce === nonce) { disarm(); return; }
    if (type !== 'arm' || typeof nonce !== 'string' || nonce.length > 100) return;
    disarm();
    active = { nonce, mode, timer: setTimeout(disarm, 16000) };
    HTMLAnchorElement.prototype.click = captureClick;
    if(mode==='voice' && mediaPrototype) mediaPrototype.play=captureAudioPlay;
    window.postMessage({ marker, type: 'ready', nonce }, location.origin);
  });
})();
