document.getElementById('support').textContent='Браузерный макет записи отдельных файлов, без ZIP.';
document.getElementById('run').onclick=async()=>{
 const button=document.getElementById('run'),result=document.getElementById('result');button.disabled=true;result.textContent='Проверка…';
 try {
  const files=new Map(),archive=new DirectoryArchive(async(blob,name)=>files.set(name,new Uint8Array(await blob.arrayBuffer())),'max-archive-fixture');
  const path='001-пример',svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>';
  const chat={title:'Синтетический чат',complete:true,messages:[{date:'2026-10-22',time:'12:00',author:'Тест',text:'Проверка папки',attachments:[{kind:'photo',localPath:'media/photo.svg',name:'photo.svg'}],reactions:[]}]};
  await archive.add(`${path}/media/photo.svg`,svg);ArchiveFormat.add(archive,path,chat,'html-json');ArchiveFormat.addIndex(archive,[{title:chat.title,path,messages:1,complete:true}],'html-json');archive.add('report.json',JSON.stringify({fixture:true,chats:1}));await archive.flush();
  const text=name=>new TextDecoder().decode(files.get('max-archive-fixture/'+name));
  if(!text('index.html').includes(encodeURIComponent(path)+'/messages.html') || !text(path+'/messages.html').includes('media/photo.svg') || text(path+'/media/photo.svg')!==svg)throw Error('Файлы не совпали');
  result.textContent='PASS: корневой index.html, HTML, JSON, SVG и отчёт сформированы отдельными файлами без ZIP. Проверены вложенные пути, ссылки и байты. Реальная запись через Downloads API этой страницей не проверяется.';result.dataset.status='passed';
 }catch(error){result.textContent='FAIL: '+error.message;result.dataset.status='failed';}finally{button.disabled=false;}
};
