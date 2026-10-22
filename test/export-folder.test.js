const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function exporter({diskFailure=false,interrupted=false}={}) {
 const events=[],nodes=new Map(),files=new Map();let downloadId=0;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,style:{},addEventListener(){},querySelectorAll:()=>[],replaceChildren(){},append(){},removeAttribute(){},setAttribute(){}});return nodes.get(id);};
 node('destination').value='folder';node('format').value='html-json';node('split').value='by-chat';node('limit').value='10000';node('type-photo').checked=true;node('download-media').checked=true;
 let receive,number=0;const port={onMessage:{addListener(fn){receive=fn;}},onDisconnect:{addListener(){}},postMessage(message){if(message.type==='export'){events.push('export');number++;queueMicrotask(()=>{receive({id:message.id,type:'chunk',messages:[{date:'2026-10-22',time:'12:00',text:'Текст',attachments:[{kind:'photo',name:'photo.png',url:'https://i.oneme.ru/photo'+number,source:'download-button-url',downloadable:true}]}]});receive({id:message.id,type:'result',value:{title:'Чат '+number,complete:true,messages:true}});});}}};
 const source=fs.readFileSync(require.resolve('../directory.js'),'utf8')+'\n'+fs.readFileSync(require.resolve('../format.js'),'utf8')+'\n'+fs.readFileSync(require.resolve('../export.js'),'utf8').replace('  init();','globalThis.runTest=()=>{chats=[{title:"Первый"},{title:"Второй"}];connect();return run();};');
 const context={document:{getElementById:node,createElement:()=>node(Symbol()),querySelector:()=>({value:'all'}),querySelectorAll:()=>[]},location:{search:'?tab=7'},URLSearchParams,URL,Blob,Uint8Array,AbortController,setTimeout:(fn,ms)=>ms===60000?0:setTimeout(fn,ms),clearTimeout,
 fetch:async()=>new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}}),
 chrome:{tabs:{connect:()=>port,getCurrent:async()=>({id:10}),update:async id=>events.push('active:'+id)},storage:{local:{set:async()=>events.push('settings')}},runtime:{getManifest:()=>({version:'test'})},downloads:{download:async options=>{assert.equal(options.conflictAction,'overwrite');assert.equal(options.saveAs,false);events.push('file:'+options.filename);if(diskFailure && options.filename.endsWith('0001-photo.png'))throw Error('disk full');files.set(options.filename,Buffer.from(await (await fetch(options.url)).arrayBuffer()));return ++downloadId;},onChanged:{addListener(){},removeListener(){}},search:async()=>[{state:interrupted?'interrupted':'complete',error:interrupted?'FILE_NO_SPACE':undefined}]}},
 ZipArchive:class{constructor(){throw Error('Folder export must not build a ZIP');}}
 };
 vm.runInNewContext(source,context);return {run:context.runTest,nodes,events,files};
}
test('folder export writes root index and media for two chats without constructing a ZIP',async()=>{
 const state=exporter();await state.run();const prefix=[...state.files.keys()][0].split('/')[0];const report=JSON.parse(state.files.get(prefix+'/report.json').toString());
 assert.equal(report.chats.length,2);assert.equal(report.errors.length,0);assert.equal(report.options.destination,'folder');assert.equal(report.skippedMedia.length,0);assert.equal(report.mediaBytes,8);
 const index=state.files.get(prefix+'/index.html').toString();for(const chat of report.chats){assert.ok(index.includes(encodeURIComponent(chat.path)+'/messages.html'));assert.ok(state.files.get(prefix+'/'+chat.path+'/messages.html'));assert.deepEqual([...state.files.get(prefix+'/'+chat.path+'/media/0001-photo.png')],[137,80,78,71]);}
 assert.equal(state.nodes.get('progress-text').textContent,'Экспорт завершён');assert.equal(state.events.at(-1),'active:10');
});
test('disk failure during media write stops remaining chats and never claims success',async()=>{
 const state=exporter({diskFailure:true});await state.run();assert.equal(state.events.filter(x=>x==='export').length,1);assert.match(state.nodes.get('status').textContent,/disk full/);assert.doesNotMatch(state.nodes.get('status').textContent,/Папка.*сохранена/);
});
test('interrupted browser download prevents MAX reading and reports failure',async()=>{
 const state=exporter({interrupted:true});await state.run();assert.ok(!state.events.includes('export'));assert.match(state.nodes.get('status').textContent,/FILE_NO_SPACE/);
});
