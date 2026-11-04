const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture({offline=false,writeFailure=false,waitForAbort=false}={}){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},value:'',addEventListener(){},querySelectorAll:()=>[]});return nodes.get(id);};
 node('max-file-mb').value='40';node('max-archive-mb').value='250';
 const old={url:'https://i.oneme.ru/old',localPath:'media/0001-old.png',bytes:new Uint8Array([1]),mimeType:'image/png'};
 const files=[old],saved={id:'run:1',path:'002-chat',settings:{format:'html-json'},chat:{chatId:'run:1',title:'Александр',messages:[{id:'m1',date:'2026-11-04',attachments:[{url:old.url,name:'old.png',downloadable:true},{url:'https://i.oneme.ru/new',name:'new.png',downloadable:true},{url:'https://example.com/no',name:'no.png',downloadable:true},{kind:'voice',source:'voice-tile',name:'voice'}]}]}};
 const requests=[];let puts=0;
 const context={document:{getElementById:node,querySelectorAll:()=>[]},location:{search:''},URLSearchParams,URL,Blob,Uint8Array,AbortController,setTimeout,clearTimeout,
 fetch:async(url,options)=>{requests.push(url);assert.equal(options.redirect,'error');if(waitForAbort)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'}))));if(offline)throw Error('Failed to fetch');return new Response(new Uint8Array([2,3]),{headers:{'content-type':'image/png'}});},
 CheckpointStore:{get:async()=>saved,files:async()=>files,file:async(id,url,value)=>{if(writeFailure)throw Error('quota');assert.equal(id,'run:1');files.push({...value,url});},put:async value=>{Object.assign(saved,value);puts++;}},
 ArchiveFormat:vm.runInNewContext(fs.readFileSync('format.js','utf8')+';ArchiveFormat',{URL}),
 };
 const source=fs.readFileSync('export.js','utf8').replace(/\binit\(\);\s*\}\)\(\);\s*$/,'globalThis.api={retryCopy};})();');vm.runInNewContext(source,context);
 return {run:context.api.retryCopy,files,saved,requests,node,get puts(){return puts;}};
}
test('retry requests only missing allowed files, keeps old bytes and records remaining reasons',async()=>{
 const f=fixture(),feedback={},button={};assert.equal(await f.run('run:1',feedback,button),true);
 assert.deepEqual(f.requests,['https://i.oneme.ru/new']);assert.equal(f.files.length,2);assert.deepEqual([...f.files[0].bytes],[1]);assert.match(f.files[1].localPath,/media\/retry-\d+-0002-new.png/);
 assert.equal(f.saved.retryReport.downloadedFiles,1);assert.equal(f.saved.retryReport.skippedMedia.length,2);assert.equal(f.saved.retryReport.skippedMedia[0].chatId,'run:1');assert.equal(f.saved.retryReport.skippedMedia[0].messageId,'m1');
 assert.match(feedback.textContent,/Докачано файлов: 1/);assert.equal(button.textContent,'Докачать файлы');
 // A later retry must not request the successfully cached URL again.
 f.requests.length=0;assert.equal(await f.run('run:1',feedback,button),true);assert.equal(f.requests.length,0);assert.equal(f.files.length,2);assert.equal(f.saved.chat.messages[0].attachments[0].bytes,undefined);
});
test('offline retry retains bytes, reports network failures and restores controls',async()=>{
 const f=fixture({offline:true}),feedback={};assert.equal(await f.run('run:1',feedback,{}),true);assert.equal(f.files.length,1);assert.match(feedback.textContent,/Ошибка сети/);assert.equal(f.node('start').disabled,false);
});
test('storage failure never claims completed retry and preserves prior files',async()=>{
 const f=fixture({writeFailure:true}),feedback={};assert.equal(await f.run('run:1',feedback,{}),false);assert.equal(f.files.length,1);assert.equal(f.puts,0);assert.match(feedback.textContent,/Докачка не завершена/);
});

test('same retry control cancels a pending request and retains saved files',async()=>{
 const f=fixture({waitForAbort:true}),feedback={},button={};
 const run=f.run('run:1',feedback,button);
 while(!f.requests.length)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(button.textContent,'Остановить докачку');assert.equal(button.disabled,false);
 await f.run('run:1',feedback,button);await run;
 assert.equal(f.saved.retryReport.stopped,true);assert.equal(f.files.length,1);assert.match(feedback.textContent,/Докачка остановлена/);assert.equal(button.textContent,'Докачать файлы');
});
