// PM probe for the fixed editor's public configuration/merge protocol.
// Run with node --import tsx. Uses existing dependencies and the real asset router.
// No FlyMind Runtime, database or vendor mutation.
import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import express from 'express';
import {drawioStaticRouter} from '../../server/native-routes.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const vendor=resolve(root,'../resources/drawio/vendor');
const out=resolve(root,'output/playwright/drawio-host-capabilities');
if(!process.env.DRAWIO_PROBE_PLAYWRIGHT)throw Error('Set DRAWIO_PROBE_PLAYWRIGHT to an existing playwright/index.mjs');
const {chromium}=await import(pathToFileURL(process.env.DRAWIO_PROBE_PLAYWRIGHT).href);
const model='<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><UserObject id="baseline" label="协议基线" fmType="node" fmKind="task" fmId="baseline" fmAdapter="1"><mxCell vertex="1" parent="1" style="rounded=1;whiteSpace=wrap;html=0;fontFamily=Microsoft YaHei;fillColor=#eef0ff;strokeColor=#596fea;"><mxGeometry x="180" y="140" width="180" height="60" as="geometry"/></mxCell></UserObject></root></mxGraphModel>';
const xml=`<mxfile><diagram id="page" name="Host capability">${model}</diagram></mxfile>`;
const libraryXml=model.replaceAll('baseline','prototype').replace('协议基线','业务步骤').replace(' fmId="prototype"','');
const config={defaultFonts:['Microsoft YaHei'],libraries:[{title:{main:'FlyMind'},entries:[{id:'fm-business',title:{main:'业务节点'},libs:[{title:{main:'业务节点'},data:[{xml:libraryXml,w:180,h:60,title:'业务步骤'}]}]}]}],defaultLibraries:'fm-business;general'};
const host='<!doctype html><meta charset="utf-8"><style>body{margin:0}iframe{width:100%;height:900px;border:0}</style><script>window.events=[];addEventListener("message",e=>{if(e.source!==document.querySelector("iframe").contentWindow||e.origin!==location.origin)return;try{window.events.push(JSON.parse(e.data))}catch{}});window.send=m=>document.querySelector("iframe").contentWindow.postMessage(JSON.stringify(m),location.origin)</script><iframe src="/drawio/index.html?embed=1&proto=json&configure=1&offline=1&local=1&lang=en&libs=fm-business;general&saveAndExit=0&noExitBtn=1"></iframe>';
const result={startedAt:new Date().toISOString(),externalRequests:[],pageErrors:[],misses:[]};
const app=express();
app.use((req,res,next)=>{res.on('finish',()=>{if(res.statusCode===404)result.misses.push(req.url)});next()});
app.get('/',(_req,res)=>res.type('html').send(host));
app.use('/drawio',drawioStaticRouter(vendor));
const server=createServer(app);
await mkdir(out,{recursive:true});await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)});
const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.DRAWIO_PROBE_BROWSER?{executablePath:process.env.DRAWIO_PROBE_BROWSER}:{})});result.browser=browser.version();
 const context=await browser.newContext({viewport:{width:1400,height:920},serviceWorkers:'block'});
 await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();result.externalRequests.push(url);return route.abort()});
 const page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(e.message));await page.goto(origin);
 const count=()=>page.evaluate(()=>window.events.length),send=m=>page.evaluate(m=>window.send(m),m);
 const wait=async(event,from=0)=>{await page.waitForFunction(({event,from})=>window.events.slice(from).some(e=>e.event===event),{event,from},{timeout:20000});return page.evaluate(({event,from})=>window.events.slice(from).find(e=>e.event===event),{event,from})};
 await wait('configure');await send({action:'configure',config});await wait('init');await send({action:'load',xml,autosave:1});await wait('load');
 const frame=page.frames().find(f=>f.url().includes('/drawio/'));
 await frame.getByText('业务节点',{exact:true}).first().waitFor();
 await frame.getByText('协议基线',{exact:true}).first().waitFor();
 if(!await frame.locator('.geSidebarContainer').first().locator('a.geItem:visible').count())await frame.getByText('业务节点',{exact:true}).first().click();
 await frame.locator('.geSidebarContainer').first().locator('a.geItem:visible').first().waitFor();
 result.inlineOfflineLibrary=true;
 await writeFile(resolve(out,'sidebar.txt'),await frame.locator('.geSidebarContainer').first().innerText());
 result.paletteItems=await frame.locator('.geSidebarContainer').first().locator('a.geItem:visible').count();
 assert.ok(result.paletteItems>0,'The offline business library must contain a usable native template');
 // A real node selection is used to check native view/selection continuity.
 await frame.locator('.geDiagramContainer').hover();await page.mouse.wheel(0,100);
 await frame.waitForFunction(()=>document.querySelector('.geDiagramContainer').scrollTop>0);
 await frame.getByText('协议基线',{exact:true}).first().click();
 const view=()=>frame.locator('.geDiagramContainer').evaluate(el=>({scrollLeft:el.scrollLeft,scrollTop:el.scrollTop,selected:el.querySelectorAll('.mxCellEditor').length,svg:el.querySelector('svg')?.getAttribute('style')}));
 const before=await view();assert.ok(before.scrollTop>0);const merged=xml.replace('fmId="baseline"','fmId="baseline" fmProbe="acknowledged"');
 const from=await count();await send({action:'merge',xml:merged,message:'metadata-ack'});const reply=await wait('merge',from);
 assert.equal(reply.message?.message,'metadata-ack');assert.equal(reply.error,undefined);
 const after=await view();assert.deepEqual(after,before);result.merge={reply,viewBefore:before,viewAfter:after,viewportUnchanged:true};
 const savedFrom=await count();await page.keyboard.press('Control+s');const saved=await wait('save',savedFrom);
 assert.ok(saved.xml.includes('fmProbe="acknowledged"'));result.merge.metadataSaved=true;
 await writeFile(resolve(out,'merged.drawio'),saved.xml);
 const duplicateFrom=await count();await page.keyboard.press('Control+d');await page.keyboard.press('Control+s');
 const duplicate=await wait('save',duplicateFrom);
 assert.equal((duplicate.xml.match(/fmType="node"/g)||[]).length,2,'Ctrl+D after merge must duplicate the still-selected native business node');
 result.merge.selectionPreserved=true;
 const insertFrom=await count();await frame.locator('.geSidebarContainer').first().locator('a.geItem:visible').first().click();await page.keyboard.press('Control+s');
 const inserted=await wait('save',insertFrom);
 assert.equal((inserted.xml.match(/fmType="node"/g)||[]).length,3);
 assert.ok(inserted.xml.includes('label="业务步骤"'));result.inlineBusinessInsert=true;
 await writeFile(resolve(out,'library-inserted.drawio'),inserted.xml);
 // Determine whether generic mxCell metadata survives the actual native codec.
 const parsed=new DOMParser().parseFromString(inserted.xml,'application/xml');
 const userObjects=Array.from(parsed.getElementsByTagName('UserObject'));
 const ids=userObjects.filter(e=>e.getAttribute('fmType')==='node').map(e=>e.getAttribute('id'));
 const directEdge=`<mxCell id="codec-edge" edge="1" parent="1" source="${ids[0]}" target="${ids[1]}" fmType="edge" fmKind="flow" fmId="codec-business-edge" fmRole="main" fmAdapter="1" style="edgeStyle=orthogonalEdgeStyle;"><mxGeometry relative="1" as="geometry"/></mxCell>`;
 const codecFrom=await count();await send({action:'merge',xml:inserted.xml.replace('</root>',directEdge+'</root>'),message:'direct-codec'});await wait('merge',codecFrom);
 const codecSaveFrom=await count();await page.keyboard.press('Control+s');const codec=await wait('save',codecSaveFrom);
 result.directCellMetadataSurvives=codec.xml.includes('fmId="codec-business-edge"');
 assert.equal(result.directCellMetadataSurvives,true,'Fixed native codec must preserve a generic edge binding');
 await writeFile(resolve(out,'direct-cell-codec.drawio'),codec.xml);
 await page.screenshot({path:resolve(out,'editor.png'),fullPage:true});
 result.ok=true;
}catch(error){result.ok=false;result.error=error.stack;process.exitCode=1}
finally{await writeFile(resolve(out,'result.json'),JSON.stringify(result,null,2));await browser?.close();server.closeAllConnections();await new Promise(yes=>server.close(yes));console.log(JSON.stringify(result,null,2))}
