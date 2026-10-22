// Synthetic popup: no MAX connection and no tab creation.
window.chrome={tabs:{query:(_query,callback)=>callback([{id:7,url:'https://web.max.ru/'}]),create(){}},runtime:{getURL:path=>path}};
window.MaxReportStore={recoverInterrupted:async()=>{},list:async()=>[]};
