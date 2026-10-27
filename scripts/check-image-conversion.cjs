// Optional real-codec test. Synthetic pixels only; no account, HTTP server or external requests.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
 const root=path.resolve(__dirname,'..'),out=path.join(root,'output','jpeg-conversion');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,chromiumSandbox:true,...(process.env.MAX_AUDIT_BROWSER?{executablePath:process.env.MAX_AUDIT_BROWSER}:{channel:'chromium'})});
 const context=await browser.newContext();
 try {
  await context.route('**/*',route=>route.abort());
  const page=await context.newPage();
  const source=fs.readFileSync(path.join(root,'export.js'),'utf8').replace(/\binit\(\);\s*\}\)\(\);\s*$/,'globalThis.imageApi={downloadMedia,webpToJpeg};})();');
  await page.evaluate(()=>{const get=document.getElementById.bind(document);document.getElementById=id=>get(id)||document.body.appendChild(Object.assign(document.createElement('button'),{id}));});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'format.js'),'utf8')});
  await page.addScriptTag({content:source});
  const result=await page.evaluate(async()=>{
   const seed=document.createElement('canvas');seed.width=300;seed.height=200;
   const draw=seed.getContext('2d');draw.fillStyle='#ff0000';draw.fillRect(0,0,150,200);
   const webp=await new Promise(resolve=>seed.toBlob(resolve,'image/webp',1));
   const original=new Uint8Array(await webp.arrayBuffer());
   const files=new Map(),report={skippedMedia:[]},saved=[];
   const attachment={kind:'photo',name:'Синтетика.webp',url:'https://i.oneme.ru/fixture.webp',downloadable:true};
   const chat={title:'Проверка изображения',messages:[{text:'Изображение с прозрачной правой половиной',author:'Тест',date:'2026-10-27',attachments:[attachment]}]};
   const prior=window.fetch;window.fetch=async()=>new Response(original,{headers:{'content-type':'image/webp'}});
   try {await imageApi.downloadMedia({add:(name,bytes)=>files.set(name,bytes)},chat,'chat',report,0,()=>{});} finally {window.fetch=prior;}
   const jpg=files.get('chat/'+attachment.localPath),raw=files.get('chat/'+attachment.originalLocalPath);
   const image=await createImageBitmap(new Blob([jpg],{type:'image/jpeg'}));
   const rendered=document.createElement('canvas');rendered.width=image.width;rendered.height=image.height;
   const ctx=rendered.getContext('2d');ctx.drawImage(image,0,0);image.close();
   const white=[...ctx.getImageData(250,100,1,1).data],red=[...ctx.getImageData(50,100,1,1).data];
   const outputs=new Map();ArchiveFormat.add({add:(name,data)=>outputs.set(name,data)},'chat',chat,'html-json');
   const data='data:image/jpeg;base64,'+btoa(String.fromCharCode(...jpg));
   const html=outputs.get('chat/messages.html').replaceAll(attachment.localPath.split('/').map(encodeURIComponent).join('/'),data);
   return {jpg:[...jpg],raw:[...raw],original:[...original],width:rendered.width,height:rendered.height,white,red,attachment,report,html,json:JSON.parse(outputs.get('chat/messages.json'))};
  });
  assert.deepEqual(result.jpg.slice(0,3),[255,216,255]);assert.deepEqual(result.raw,result.original);
  assert.equal(result.width,300);assert.equal(result.height,200);assert.equal(result.attachment.mimeType,'image/jpeg');
  assert.ok(result.white.slice(0,3).every(value=>value>=250),JSON.stringify(result.white));
  assert.ok(result.red[0]>=245 && result.red[1]<=10 && result.red[2]<=10,JSON.stringify(result.red));
  assert.equal(result.report.skippedMedia.length,0);assert.equal(result.report.convertedImages.length,1);
  fs.writeFileSync(path.join(out,'fixture.jpg'),Buffer.from(result.jpg));fs.writeFileSync(path.join(out,'original.webp'),Buffer.from(result.raw));
  fs.writeFileSync(path.join(out,'messages.html'),result.html);
  const geometry=[];
  for(const theme of ['light','dark']) for(const width of [390,768,1280]) {
   await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});await page.setContent(result.html);
   await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
   const bounds=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,images:[...document.images].map(image=>({naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,width:image.getBoundingClientRect().width,right:image.getBoundingClientRect().right}))}));
   assert.ok(bounds.scrollWidth<=width,JSON.stringify(bounds));assert.equal(bounds.images[0].naturalWidth,300);assert.ok(bounds.images[0].right<=width);
   geometry.push({theme,width,...bounds});await page.screenshot({path:path.join(out,`${theme}-${width}.png`),fullPage:true});
  }
  const evidence={browser:await browser.version(),synthetic:true,accountUsed:false,jpegMagic:result.jpg.slice(0,3),width:result.width,height:result.height,white:result.white,red:result.red,originalPreserved:true,conversion:result.attachment.imageConversion,geometry};
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
 } finally {await context.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
