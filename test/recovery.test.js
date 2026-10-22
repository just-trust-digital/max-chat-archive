const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function exporter({failure=false,interrupted=false,invalidId=false,inlineVoice=false}={}){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},addEventListener(){},setAttribute(){},querySelectorAll:()=>[]});return nodes.get(id);};
 let listener;const files=new Map();
 const source=fs.readFileSync(require.resolve('../export.js'),'utf8').replace(/\binit\(\);\s*\}\)\(\);\s*$/,'globalThis.api={recoverCopy,setRunning(value){running=value;}};})();');
 const context={document:{getElementById:node,querySelectorAll:()=>[]},location:{search:''},URLSearchParams,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},Blob,Uint8Array,ArrayBuffer,atob,
 setTimeout:(fn,ms)=>ms===60000?0:setTimeout(fn,ms),clearTimeout,
 CheckpointStore:{get:async()=>{if(failure)throw Error('storage unavailable');return {chat:{title:'Чат',messages:[{text:'Текст',attachments:[inlineVoice?{url:'inline-voice:one',inlineData:'data:audio/ogg;base64,T2dnUw==',kind:'voice'}:{url:'https://i.oneme.ru/photo',kind:'photo'}]}]},settings:{format:'html-json',media:true},path:'001-chat'};},files:async()=>inlineVoice?[]:[{url:'https://i.oneme.ru/photo',localPath:'media/photo.png',bytes:new Uint8Array([137,80,78,71]),mimeType:'image/png'}]},
 chrome:{downloads:{download:async()=>invalidId?undefined:7,onChanged:{addListener(fn){listener=fn;},removeListener(fn){if(listener===fn)listener=null;}},search:async()=>[{state:interrupted?'interrupted':'complete',error:interrupted?'USER_CANCELED':undefined}]}},
 ArchiveFormat:{addIndex(){},filter:messages=>messages,add(zip,path,chat){assert.equal(chat.messages[0].attachments[0].localPath,inlineVoice?'media/recovered-voice-1.ogg':'media/photo.png');zip.add(path+'/messages.html','preview');}},
 ZipArchive:class{add(path,bytes){files.set(path,bytes);}blob(){return new Blob(['zip']);}}
 };vm.runInNewContext(source,context);return {...context.api,nodes,files};
}
test('recovery shows a visible busy explanation instead of silently ignoring clicks',async()=>{const api=exporter();api.setRunning(true);const feedback={};assert.equal(await api.recoverCopy('id',feedback),false);assert.match(feedback.textContent,/Дождитесь/);});
test('recovery errors stay beside the clicked copy and controls are restored',async()=>{const api=exporter({failure:true});const feedback={},button={};assert.equal(await api.recoverCopy('id',feedback,button),false);assert.match(feedback.textContent,/storage unavailable/);assert.equal(button.textContent,'Скачать сохранённое');assert.equal(api.nodes.get('start').disabled,false);});
test('recovery restores bytes and only reports success after browser completion',async()=>{const api=exporter();const feedback={};assert.equal(await api.recoverCopy('id',feedback),true);assert.deepEqual([...api.files.get('001-chat/media/photo.png')],[137,80,78,71]);assert.match(feedback.textContent,/Копия скачана/);});
test('an interrupted browser download is reported beside the copy',async()=>{const api=exporter({interrupted:true});const feedback={};assert.equal(await api.recoverCopy('id',feedback),false);assert.match(feedback.textContent,/USER_CANCELED/);});

test('missing browser download acknowledgement is an explicit error',async()=>{const api=exporter({invalidId:true});const feedback={};assert.equal(await api.recoverCopy('id',feedback),false);assert.match(feedback.textContent,/не подтвердил запуск/);});

test('recovery salvages voice bytes already present in a checkpoint before the file transaction',async()=>{const api=exporter({inlineVoice:true});assert.equal(await api.recoverCopy('id',{}),true);assert.deepEqual([...api.files.get('001-chat/media/recovered-voice-1.ogg')],[79,103,103,83]);});
