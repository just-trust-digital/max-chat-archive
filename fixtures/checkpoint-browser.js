(() => {
  const output=document.getElementById('checkpoint-result');
  const id='synthetic-recovery-test';
  const url='https://i.oneme.ru/synthetic.png';
  const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
  document.getElementById('write-checkpoint').onclick=async()=>{
    try {
      const chat={title:'Синтетический чат — проверка восстановления длинного названия',complete:false,reason:'checkpoint',messages:[{author:'Автор',text:'Сохранено до сбоя',dateLabel:'October 20, 2026',time:'10:00',attachments:[{kind:'photo',name:'photo-1',url,downloadable:true}]}]};
      await CheckpointStore.put({id,chat,settings:{format:'html-json',media:true,links:true,reactions:true,limit:10000},path:'001-synthetic',state:'media',extensionVersion:'test'});
      await CheckpointStore.file(id,url,{localPath:'media/0001-photo.png',bytes:png,mimeType:'image/png'});
      output.textContent='Записаны сообщение и PNG. Нажмите «Перезагрузить».';output.dataset.status='written';
    } catch(error){output.textContent=error.message;output.dataset.status='failed';}
  };
  document.getElementById('reload-checkpoint').onclick=()=>location.reload();
  (async()=>{
    const saved=await CheckpointStore.get(id);
    if(!saved) {output.textContent='Нажмите «Записать копию».';return;}
    const files=await CheckpointStore.files(id);
    if(saved.chat.messages[0].text!=='Сохранено до сбоя' || files.length!==1 || files[0].bytes.length!==png.length || !files[0].bytes.every((byte,index)=>byte===png[index])) throw Error('Копия повреждена');
    output.textContent='PASS: сообщение и байты PNG восстановлены после перезагрузки.';output.dataset.status='passed';
  })().catch(error=>{output.textContent=error.message;output.dataset.status='failed';});
})();
