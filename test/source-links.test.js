const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const f=vm.runInNewContext(fs.readFileSync('format.js','utf8')+';ArchiveFormat',{URL});
test('failed download retains original URL as a clickable HTML link and in JSON without remote embeds',()=>{
 const url='https://a.oneme.ru/getfile?token=synthetic';const files=new Map();const chat={title:'Чат',messages:[{text:'Файл',attachments:[{name:'recording.ogg',kind:'voice',url,downloadable:true}],reactions:[]}]};f.add({add:(n,v)=>files.set(n,v)},'001-chat',chat,'html-json');
 assert.ok(files.get('001-chat/messages.html').includes('href="'+url+'"'));assert.ok(files.get('001-chat/messages.json').includes(url));assert.ok(!files.get('001-chat/messages.html').includes('src="'+url));
});
