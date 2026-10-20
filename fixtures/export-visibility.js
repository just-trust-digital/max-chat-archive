// Synthetic renderer fixture. It never connects to a real MAX tab or downloads.
(() => {
  let receive, exportId;
  const port = {
    onMessage:{addListener(fn){receive=fn;}},onDisconnect:{addListener(){}},
    postMessage(message){
      queueMicrotask(() => {
        if(message.type==='current') receive({id:message.id,type:'result',value:{title:'Пример чата'}});
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
    downloads:{download:async()=>{throw new Error('Synthetic visibility test must not download');}}
  };
})();
