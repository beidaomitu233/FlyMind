// Run: node --import tsx scripts/probes/drawio-engine-browser.mjs
// No installs, user databases, existing servers or production routes are involved.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {compileDrawio,projectDrawio,patchDrawio,DEFAULT_SWIMLANE_PROFILE} from '../../src/drawing/engine/drawio/index.ts';
import {parseNative,serialize,children,attr} from '../../src/drawing/engine/drawio/xml.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),vendor=resolve(root,'../resources/drawio/vendor'),out=resolve(root,'output/playwright/drawio-engine');
if(!process.env.DRAWIO_PROBE_PLAYWRIGHT)throw new Error('Set DRAWIO_PROBE_PLAYWRIGHT to the existing playwright/index.mjs');
const {chromium}=await import(pathToFileURL(process.env.DRAWIO_PROBE_PLAYWRIGHT).href);
const host='<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{width:100%;height:1060px;border:0}</style><script>window.events=[];window.addEventListener("message",e=>{if(e.source!==document.querySelector("iframe").contentWindow||e.origin!==location.origin)return;try{window.events.push(JSON.parse(e.data))}catch{}});window.send=m=>document.querySelector("iframe").contentWindow.postMessage(JSON.stringify(m),location.origin);</script><iframe src="/drawio/index.html?embed=1&proto=json&configure=1&offline=1&local=1&lang=en&saveAndExit=0&noSaveBtn=0&noExitBtn=1"></iframe>';
const misses=[],mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.xml':'application/xml','.woff2':'font/woff2','.ttf':'font/ttf','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/'){res.setHeader('Content-Type','text/html');res.end(host);return}if(!name.startsWith('/drawio/'))throw Error('route');const rel=name.slice(8);if(rel.split('/').some(p=>p.startsWith('.')||['WEB-INF','META-INF'].includes(p)))throw Error('private');const file=resolve(vendor,rel);if(!file.startsWith(vendor+sep))throw Error('path');res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(await readFile(file))}catch{misses.push(req.url);res.statusCode=404;res.end('Not found')}});
await mkdir(out,{recursive:true});await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)});const origin=`http://127.0.0.1:${server.address().port}`;
const result={date:new Date().toISOString(),origin,headless:true,externalRequests:[],pageErrors:[],requestFailures:[],samples:[]};let browser;
// Native save reorders attributes and omits numeric zero defaults. Compare
// geometry values, not XML whitespace, attribute order or explicit zero syntax.
const canonicalGeometry=e=>{const attributes={};for(let i=0;i<e.attributes.length;i++){const a=e.attributes.item(i);if(['x','y','width','height','relative'].includes(a.name)&&Number(a.value)===0)continue;attributes[a.name]=a.value}return {tag:e.nodeName,attributes:Object.fromEntries(Object.entries(attributes).sort(([a],[b])=>a<b?-1:a>b?1:0)),children:children(e).map(canonicalGeometry)}};
const geometry=xml=>{const n=parseNative(xml);return Object.fromEntries([...n.cells].map(([id,e])=>[id,children(e.cell,'mxGeometry').map(canonicalGeometry)]))};
try{
 browser=await chromium.launch({headless:true,...(process.env.DRAWIO_PROBE_BROWSER?{executablePath:process.env.DRAWIO_PROBE_BROWSER}:{})});result.browser=browser.version();
 const context=await browser.newContext({viewport:{width:1920,height:1080},serviceWorkers:'block'});await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();result.externalRequests.push(url);return route.abort()});
 const page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(e.message));page.on('requestfailed',r=>result.requestFailures.push({url:r.url(),error:r.failure()?.errorText}));await page.goto(origin);
 const wait=async(event,from=0)=>{await page.waitForFunction(({event,from})=>window.events.slice(from).some(e=>e.event===event),{event,from},{timeout:30000});return page.evaluate(({event,from})=>window.events.slice(from).find(e=>e.event===event),{event,from})};
 const send=m=>page.evaluate(m=>window.send(m),m),eventCount=()=>page.evaluate(()=>window.events.length);
 await wait('configure');await send({action:'configure',config:{defaultFonts:['Microsoft YaHei']}});await wait('init');const frame=page.frames().find(f=>f.url().includes('/drawio/'));
 for(const name of ['pbs-main','swimlane','long-text']){
  const content=JSON.parse(await readFile(resolve(root,`tests/fixtures/drawio-baseline/${name==='long-text'?'swimlane':name}.content.json`),'utf8'));
  if(name==='long-text'){content.title=('跨部门申请审核、风险澄清与交付确认：'.repeat(10)).slice(0,160);content.nodes[0].label='需要在规定时间内核验申请资料与服务目标，并由负责人确认后移交下一环节；'.repeat(5);content.nodes[3].label='是否已经核实申请资料、预算边界、任务时限与客户确认事项？'.repeat(4);content.nodes.push({id:'float-long',label:('浮动说明：保持真实业务关系，不用备注推动主流程排序。'.repeat(20)).slice(0,500),kind:'note',laneId:'r04',phaseId:'p05'})}
  const engine=await compileDrawio(content);await writeFile(resolve(out,`${name}.drawio`),engine.xml);const from=await eventCount();await send({action:'load',xml:engine.xml,title:content.title,autosave:1});const loaded=await wait('load',from);
  await frame.getByText(content.nodes[0].label,{exact:true}).first().waitFor({timeout:20000});await frame.evaluate(()=>document.fonts.ready);
  await frame.locator('.geDiagramContainer').click({position:{x:25,y:25}});await page.keyboard.press('Control+Shift+h');
  await page.screenshot({path:resolve(out,`${name}-editor.png`),fullPage:true});
  const saveFrom=await eventCount();await page.keyboard.press('Control+s');const saved=await wait('save',saveFrom);await writeFile(resolve(out,`${name}-native-saved.drawio`),saved.xml);
  const projected=await projectDrawio(saved.xml,content);assert.deepEqual(projected.content,content,'Native editor save must retain the full input semantics');assert.equal(projected.contentHash,engine.contentHash);
  const standalone=await projectDrawio(saved.xml);assert.deepEqual(standalone.content,content,'Native editor save must preserve standalone serialization order');
  const beforeGeo=geometry(engine.xml),savedGeo=geometry(saved.xml),geometryChanges=Object.keys(beforeGeo).filter(id=>JSON.stringify(beforeGeo[id])!==JSON.stringify(savedGeo[id]));
  const record={name,nodes:content.nodes.length,edges:content.edges.length,xmlBytes:engine.xml.length,savedBytes:saved.xml.length,hash:engine.contentHash,nativeRoundtrip:true,standaloneRoundtrip:true,geometryChanges,modelAttributesBefore:parseNative(engine.xml).model.attributes.length,modelAttributesAfter:parseNative(saved.xml).model.attributes.length,loadBounds:loaded.modelBounds,exports:{}};
  for(const format of ['svg','png']){const expFrom=await eventCount();await send({action:'export',format,xml:saved.xml,embedImages:true,message:`${name}-${format}`});const event=await wait('export',expFrom);assert.equal(event.message?.message,`${name}-${format}`);assert.ok(event.data?.startsWith(format==='png'?'data:image/png;':'data:image/svg+xml;'));const raw=event.data.slice(event.data.indexOf(',')+1),buffer=Buffer.from(raw,'base64');await writeFile(resolve(out,`${name}.${format}`),buffer);record.exports[format]={bytes:buffer.length,format:event.format};if(format==='png'){assert.equal(buffer.subarray(1,4).toString(),'PNG');record.exports.png.width=buffer.readUInt32BE(16);record.exports.png.height=buffer.readUInt32BE(20)}}
  // A local patch is applied to the real native-saved XML, preserving all geometry.
  const base={schemaVersion:3,content,rendering:{profile:DEFAULT_SWIMLANE_PROFILE,preferences:{orientation:'vertical'},engine:{...engine,xml:saved.xml}},createdAt:1,updatedAt:1};
  const patched=await patchDrawio(base,[{op:'update_node',id:content.nodes[0].id,changes:{label:'AI 局部确认：'+content.nodes[0].label}}]);assert.deepEqual(geometry(patched.xml),savedGeo);await writeFile(resolve(out,`${name}-patched.drawio`),patched.xml);record.patchPreservedNativeGeometry=true;
  result.samples.push(record);
 }
 result.ok=true;
}catch(error){result.ok=false;result.error=error.stack;process.exitCode=1}
finally{result.misses=misses;await writeFile(resolve(out,'browser.json'),JSON.stringify(result,null,2));await browser?.close();server.closeAllConnections();await new Promise(yes=>server.close(yes));console.log(JSON.stringify(result,null,2))}
