const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const format=vm.runInNewContext(fs.readFileSync(require.resolve('../format.js'),'utf8')+';ArchiveFormat',{URL});
test('root index links every chat with escaped titles and relative encoded paths',()=>{
 const files=new Map();format.addIndex({add:(name,text)=>files.set(name,text)},[{title:'<img onerror=bad>',path:'001-Тест #1',messages:142,complete:false},{title:'Другой',path:'002-other',messages:3,complete:true}],'html-json');
 const html=files.get('index.html');assert.ok(html);assert.match(html,/001-%D0%A2%D0%B5%D1%81%D1%82%20%231\/messages.html/);assert.match(html,/002-other\/messages.html/);assert.match(html,/&lt;img onerror=bad&gt;/);assert.match(html,/история может быть неполной/);assert.match(html,/Технический отчёт/);assert.doesNotMatch(html,/<img onerror/);
});
test('root index respects data-only formats and rejects traversing paths',()=>{
 for(const [type,file] of [['json','messages.json'],['csv','messages.csv'],['txt','messages.txt']]){let html;format.addIndex({add:(_,value)=>html=value},[{path:'001-chat',title:'Чат',messages:1}],type);assert.ok(html.includes('001-chat/'+file));}
 for(const path of ['../outside','C:/outside','001/../outside','a\\b',''])assert.throws(()=>format.addIndex({add(){}},[{path}],'html'),/Некорректный путь/);
});
