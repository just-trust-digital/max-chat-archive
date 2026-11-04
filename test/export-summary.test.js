const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const format=vm.runInNewContext(fs.readFileSync('format.js','utf8')+';ArchiveFormat',{URL});
test('human report distinguishes unconfirmed history, failures and stopped runs and escapes data',()=>{
 const report={chats:[{title:'<script>bad</script>',messages:24,complete:false,reason:'history_not_expanded'}],errors:[{chat:'X',error:'<bad>'}],skippedMedia:[{reason:'Адрес вне разрешённых доменов медиа'}]};
 const html=format.reportHtml(report);assert.match(html,/Полнота истории не подтверждена/);assert.match(html,/MAX не подгрузил/);assert.match(html,/Чаты с ошибками/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/Обработка завершена/);
 assert.match(format.reportHtml({...report,stopped:true}),/Экспорт остановлен/);
 assert.match(format.reportHtml({chats:[],errors:[],skippedMedia:[]}),/Сохранено чатов: 0/);
});
