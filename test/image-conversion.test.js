const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const webp=new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80]);
const jpeg=new Uint8Array([255,216,255,224,0,2,255,217]);
function exporter({decodeFailure=false,encodeFailure=false,large=false,jpegBytes=jpeg,store=null}={}) {
 const events=[];
 const source=fs.readFileSync(path.join(__dirname,'../export.js'),'utf8').replace(/\binit\(\);\s*\}\)\(\);\s*$/,'globalThis.api={downloadMedia,webpToJpeg};})();');
 const context={URL,URLSearchParams,Blob,Uint8Array,AbortController,setTimeout,clearTimeout,location:{search:''},
  ArchiveFormat:{safeName:s=>s},CheckpointStore:store,
  fetch:async()=>new Response(webp,{headers:{'content-type':'image/webp'}}),
  createImageBitmap:async(blob,options)=>{events.push(['decode',blob.type,options.imageOrientation]);if(decodeFailure) throw Error('invalid WebP');return {width:large?10000:30,height:large?10000:20,close(){events.push(['close']);}};},
  document:{getElementById:()=>({addEventListener(){}}),querySelectorAll:()=>[],createElement(tag){assert.equal(tag,'canvas');return {getContext(type,options){events.push(['context',type,options.alpha]);return {set fillStyle(value){events.push(['background',value]);},fillRect(...args){events.push(['fill',...args]);},drawImage(...args){events.push(['draw',args[1],args[2]]);}};},toBlob(callback,type,quality){events.push(['encode',type,quality]);callback(encodeFailure?null:new Blob([jpegBytes],{type}));}};}}
 };
 vm.runInNewContext(source,context);return {...context.api,events};
}
function attachment(overrides={}) {return {kind:'photo',name:'Фото.webp',url:'https://i.oneme.ru/photo.webp',downloadable:true,...overrides};}
async function download(api,attachments,{fileLimit=1000,byteLimit=1000,checkpointId=null}={}) {
 const files=new Map(),report={skippedMedia:[]};
 const count=await api.downloadMedia({add(name,data){files.set(name,data);}}, {messages:[{attachments}]},'chat',report,0,()=>{},checkpointId,byteLimit,fileLimit);
 return {files,report,count};
}

test('WebP JPEG conversion flattens transparency onto white at quality 0.92 and uses source orientation',async()=>{
 const api=exporter();const result=await api.webpToJpeg(webp);
 assert.deepEqual([...result.bytes],[...jpeg]);
 assert.equal(result.conversion.width,30);assert.equal(result.conversion.height,20);
 assert.deepEqual(api.events,[['decode','image/webp','from-image'],['context','2d',false],['background','#ffffff'],['fill',0,0,30,20],['draw',0,0],['encode','image/jpeg',0.92],['close']]);
});
test('export links JPEG but retains source WebP bytes, name, metadata and original path',async()=>{
 const saved=[];const api=exporter({store:{async file(id,url,value){saved.push({id,url,value});}}});
 const photo=attachment();const clone=attachment();const first=await download(api,[photo,clone],{checkpointId:'copy'});
 assert.deepEqual([...first.files.keys()],['chat/media/originals/0001-Фото.webp','chat/media/0001-Фото.jpg']);
 assert.deepEqual([...first.files.get('chat/media/originals/0001-Фото.webp')],[...webp]);
 assert.equal(first.count,webp.length+jpeg.length);assert.equal(photo.name,'Фото.webp');
 assert.equal(photo.mimeType,'image/jpeg');assert.equal(photo.sourceMimeType,'image/webp');
 assert.equal(photo.originalLocalPath,'media/originals/0001-Фото.webp');
 assert.equal(clone.localPath,photo.localPath);assert.equal(clone.sourceMimeType,'image/webp');
 assert.equal(saved.length,1);assert.deepEqual([...saved[0].value.originalBytes],[...webp]);
 assert.equal(first.report.convertedImages.length,1);assert.equal(first.report.skippedMedia.length,0);
 const second=await download(exporter(),[attachment()]);assert.deepEqual([...second.files.keys()],[...first.files.keys()]);
});
test('failed WebP decode preserves original and records conversion error instead of a fake JPG',async()=>{
 const photo=attachment();const {files,report}=await download(exporter({decodeFailure:true}),[photo]);
 assert.deepEqual([...files.keys()],['chat/media/0001-Фото.webp']);
 assert.equal(photo.mimeType,'image/webp');assert.equal(report.conversionErrors.length,1);
 assert.match(report.conversionErrors[0].reason,/invalid WebP/);assert.equal(report.conversionErrors[0].originalPreserved,true);
});
test('failed JPEG encoding and wrong output signatures are explicit failures and close bitmap',async()=>{
 for(const option of [{encodeFailure:true},{jpegBytes:new Uint8Array([137,80,78,71])}]) {
  const api=exporter(option);const result=await download(api,[attachment()]);
  assert.equal(result.report.conversionErrors.length,1);assert.equal(api.events.at(-1)[0],'close');
  assert.ok([...result.files.keys()].every(name=>!name.endsWith('.jpg')));
 }
});
test('JPEG derivative plus source must fit archive budget; otherwise original remains usable',async()=>{
 const {files,report,count}=await download(exporter(),[attachment()],{byteLimit:15});
 assert.equal(count,webp.length);assert.equal(report.conversionErrors.length,1);
 assert.deepEqual([...files.keys()],['chat/media/0001-Фото.webp']);
});
test('oversized decoded image is not allocated to canvas',async()=>{
 const api=exporter({large:true});const result=await download(api,[attachment()]);
 assert.equal(result.report.conversionErrors.length,1);assert.ok(!api.events.some(row=>row[0]==='context'));
 assert.equal(api.events.at(-1)[0],'close');
});
test('JPEG original name is replaced even if WebP MIME arrives under another extension',async()=>{
 const {files}=await download(exporter(),[attachment({name:'Фото.png'})]);
 assert.ok(files.has('chat/media/0001-Фото.jpg'));
});
