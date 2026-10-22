const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const DirectoryArchive=vm.runInNewContext(fs.readFileSync(require.resolve('../directory.js'),'utf8')+';DirectoryArchive',{Blob});
test('folder output writes nested files sequentially under one export root',async()=>{
 const files=new Map(),order=[];const archive=new DirectoryArchive(async(blob,name)=>{order.push(name);files.set(name,Buffer.from(await blob.arrayBuffer()));},'max-archive-test');
 archive.add('index.html','Привет');await archive.add('chat/media/photo.png',new Uint8Array([137,80]));await archive.flush();
 assert.equal(files.get('max-archive-test/index.html').toString(),'Привет');assert.deepEqual([...files.get('max-archive-test/chat/media/photo.png')],[137,80]);assert.deepEqual(order,['max-archive-test/index.html','max-archive-test/chat/media/photo.png']);
 for(const path of ['../escape','/absolute','C:/escape','a/../b','a\\b','a//b'])assert.throws(()=>archive.add(path,'bad'),/Недопустимый/);
});
test('folder write failure rejects flush and stops later queued writes',async()=>{
 const order=[];const archive=new DirectoryArchive(async(_blob,name)=>{order.push(name);throw Error('disk full');},'max-test');archive.add('bad','text');archive.add('later','must not write');
 await assert.rejects(archive.flush(),e=>e.code==='DIRECTORY_WRITE' && /disk full/.test(e.message));assert.deepEqual(order,['max-test/bad']);
});
