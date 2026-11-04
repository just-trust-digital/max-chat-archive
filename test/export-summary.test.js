const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const format=vm.runInNewContext(fs.readFileSync('format.js','utf8')+';ArchiveFormat',{URL});
test('human report distinguishes unconfirmed history, failures and stopped runs and escapes data',()=>{
 const report={chats:[{title:'<script>bad</script>',messages:24,complete:false,reason:'history_not_expanded'}],errors:[{chat:'X',error:'<bad>'}],skippedMedia:[{reason:'Адрес вне разрешённых доменов медиа'}]};
 const html=format.reportHtml(report);assert.match(html,/Полнота истории не подтверждена/);assert.match(html,/MAX не подгрузил/);assert.match(html,/Чаты с ошибками/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/Обработка завершена/);
 assert.match(format.reportHtml({...report,stopped:true}),/Экспорт остановлен/);
 assert.match(format.reportHtml({chats:[],errors:[],skippedMedia:[]}),/Сохранено чатов: 0/);
});

test('chat reference uses archive number and dates even when titles are identical',()=>{
 const html=format.reportHtml({chats:[{title:'Александр',path:'001-Александр',messages:1,dateFrom:'2020-01-01',dateTo:'2020-12-31',chatId:'run:0'},{title:'Александр',path:'002-Александр',messages:2,chatId:'run:1'}]});
 assert.match(html,/001-Александр/);assert.match(html,/002-Александр/);assert.match(html,/run:0/);assert.match(html,/2020-01-01/);
});
test('legacy skipped media reasons separate size from address and network failures',()=>{
 const summary=format.mediaSummary([{reason:'Файл больше 39 МБ'},{reason:'Адрес вне разрешённых доменов медиа'},{reason:'Failed to fetch'},{reason:'Лимит архива'},{reason:'Не удалось получить голосовое сообщение'}]);
 for(const label of ['Размер файла: 1','Адрес запрещён: 1','Ошибка сети или другая причина: 1','Лимит архива: 1','Нет доступного адреса файла: 1'])assert.ok(summary.includes(label));
 assert.equal(format.mediaIssue({reason:'Файл больше 1 МБ',code:'archive_limit'}).code,'archive_limit');
});
