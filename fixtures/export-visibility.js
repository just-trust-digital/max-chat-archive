// Synthetic renderer fixture. It never connects to a real MAX tab or downloads.
(() => {
  let receive, exportId;
  const port = {
    onMessage:{addListener(fn){receive=fn;}},onDisconnect:{addListener(){}},
    postMessage(message){
      queueMicrotask(() => {
        if(message.type==='current') receive({id:message.id,type:'result',value:{title:'Пример чата'}});
        if(message.type==='discover') receive({id:message.id,type:'result',value:{chats:[],complete:true}});
        if(message.type==='export') {
          exportId=message.id;
          receive({id:message.id,type:'progress',value:{title:'Пример чата',count:30,stage:'visibility'}});
        }
        if(message.type==='cancel') receive({id:exportId,type:'error',error:'Экспорт остановлен.',code:'CANCELLED'});
      });
    }
  };
  window.chrome={
    runtime:{getManifest:()=>({version:'fixture'})},
    tabs:{connect:()=>port,getCurrent:async()=>({id:8}),update:async()=>({})},
    storage:{local:{get:async()=>({}),set:async()=>{}}},
    downloads:{download:async({url})=>{
      if(new URLSearchParams(location.search).get('fixture')==='recovery-error') throw new Error('Скачивание прервано браузером (синтетическая проверка)');
      if(new URLSearchParams(location.search).get('fixture')!=='recovery') throw new Error('Synthetic visibility test must not download');
      const bytes=new Uint8Array(await (await fetch(url)).arrayBuffer()), view=new DataView(bytes.buffer), decoder=new TextDecoder(), entries=new Map();
      let offset=0;
      while(offset+30<bytes.length && view.getUint32(offset,true)===0x04034b50) {
        const size=view.getUint32(offset+18,true), nameSize=view.getUint16(offset+26,true), extra=view.getUint16(offset+28,true);
        const name=decoder.decode(bytes.slice(offset+30,offset+30+nameSize)), dataAt=offset+30+nameSize+extra;
        entries.set(name,bytes.slice(dataAt,dataAt+size));offset=dataAt+size;
      }
      const image=entries.get('001-synthetic/media/0001-photo.png');
      const html=decoder.decode(entries.get('001-synthetic/messages.html'));
      const report=JSON.parse(decoder.decode(entries.get('report.json')));
      if(image?.[0]!==137 || image?.[1]!==80 || !html.includes('media/0001-photo.png') || !html.includes('<img') || !report.recovered) throw new Error('Recovered ZIP missing photo or preview');
      let output=document.getElementById('recovery-test-result');
      if(!output){output=document.createElement('p');output.id='recovery-test-result';document.querySelector('main').prepend(output);}
      output.textContent='PASS: восстановленный ZIP содержит PNG, HTML-превью и отчёт о восстановлении.';output.dataset.status='passed';
      return 1;
    }}
  };
})();
