const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const store=vm.runInNewContext(fs.readFileSync('checkpoint.js','utf8')+';CheckpointStore');
test('970 chat copies in one run form one history job, surviving reload of grouping code',()=>{
 const copies=Array.from({length:970},(_,i)=>({id:'run-uuid:'+i,title:'Чат',messages:3,updatedAt:'2026-11-03T22:49:01Z'}));
 const groups=store.group(copies);assert.equal(groups.length,1);assert.equal(groups[0].copies.length,970);assert.equal(groups[0].messages,2910);
 assert.equal(store.group([...copies,{id:'other:0',updatedAt:'2026-11-04T00:00:00Z',messages:1}]).length,2);
});
