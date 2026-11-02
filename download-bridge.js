(() => {
  const marker = 'max-archive-download-capture';
  const originalClick = HTMLAnchorElement.prototype.click;
  let active = null;
  let exporting = false;
  const mediaPrototype=typeof HTMLMediaElement==='undefined'?null:HTMLMediaElement.prototype;
  const originalPlay=mediaPrototype?.play;

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

  function captureAudioPlay() {
    if(active?.mode!=='voice') return exporting ? Promise.resolve() : originalPlay.call(this);
    const url=this.src || this.currentSrc || this.getAttribute('src');
    if(!/^(https?:|blob:)/i.test(url || '')) return Promise.resolve();
    const job=active;
    // Capture the source before playing it. Exports do not play private recordings aloud.
    (async()=>{
      let href=url;
      if(url.startsWith('blob:')) {
        const response=await fetch(url), buffer=await response.arrayBuffer();
        if(buffer.byteLength>job.maxBytes) throw Error('voice_too_large');
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
  // MAX can decode the downloaded file through Web Audio without an <audio> element.
  // Copy encoded bytes before decodeAudioData transfers/detaches its input buffer.
  const audioContextPrototype = typeof BaseAudioContext === 'undefined' ? null : BaseAudioContext.prototype;
  if (audioContextPrototype) {
    const decode = audioContextPrototype.decodeAudioData;
    audioContextPrototype.decodeAudioData = function(buffer, ...args) {
      if (active?.mode === 'voice') {
        const job = active;
        let href = '';
        if (buffer.byteLength <= job.maxBytes) {
          const bytes = new Uint8Array(buffer);
          const signature = String.fromCharCode(...bytes.subarray(0, 12));
          const mime = signature.startsWith('RIFF') ? 'audio/wav'
            : signature.includes('ftyp') ? 'audio/mp4'
            : bytes[0] === 0x1a && bytes[1] === 0x45 ? 'audio/webm'
            : signature.startsWith('ID3') || bytes[0] === 0xff ? 'audio/mpeg' : 'audio/ogg';
          let binary = '';
          for (let index = 0; index < bytes.length; index += 32768)
            binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
          href = `data:${mime};base64,${btoa(binary)}`;
        }
        disarm();
        window.postMessage({marker, type:'captured', nonce:job.nonce, href, name:'Голосовое сообщение'}, location.origin);
      }
      return decode.call(this, buffer, ...args);
    };
  }
  const sourcePrototype = typeof AudioBufferSourceNode === 'undefined' ? null : AudioBufferSourceNode.prototype;
  if (sourcePrototype) {
    const start = sourcePrototype.start;
    sourcePrototype.start = function(...args) {
      if (exporting || active?.mode === 'voice') return;
      return start.apply(this, args);
    };
  }
  if(mediaPrototype) mediaPrototype.play=captureAudioPlay;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.marker !== marker) return;
    const { type, nonce, mode, maxBytes } = event.data;
    if(type==='export-start') {exporting=true;return;}
    if(type==='export-end') {exporting=false;disarm();return;}
    if (type === 'cancel' && active?.nonce === nonce) { disarm(); return; }
    if (type !== 'arm' || typeof nonce !== 'string' || nonce.length > 100) return;
    disarm();
    active = { nonce, mode, maxBytes:Number.isFinite(maxBytes)?Math.min(2000*1024*1024,Math.max(1,maxBytes)):25*1024*1024, timer: setTimeout(disarm, 16000) };
    HTMLAnchorElement.prototype.click = captureClick;
    if(mode==='voice' && mediaPrototype) mediaPrototype.play=captureAudioPlay;
    window.postMessage({ marker, type: 'ready', nonce }, location.origin);
  });
})();
