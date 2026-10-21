const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
test('selecting voice after legacy media exclusion re-enables media and anonymization excludes members',()=>{
 const nodes=new Map();const node=id=>{if(!nodes.has(id)) nodes.set(id,{value:'',checked:false,style:{},addEventListener(){}});return nodes.get(id);};
 node('limit').value='1000';node('format').value='html-json';node('split').value='by-chat';
 node('media').checked=false;node('type-voice').checked=true;node('participants').checked=true;node('anonymize').checked=true;
 const source=fs.readFileSync(require.resolve('../export.js'),'utf8').replace(/\binit\(\);\s*\}\)\(\);\s*$/,'globalThis.readOptions=options;})();');
 const context={document:{getElementById:node,querySelectorAll:()=>[]},location:{search:''},URLSearchParams};vm.runInNewContext(source,context);
 const options=context.readOptions();assert.equal(options.media,true);assert.equal(options.mediaTypes.voice,true);assert.equal(options.mediaTypes.photo,false);assert.equal(options.participants,false);assert.equal(options.anonymize,true);
});
