// PM validation: real draw.io public patches + durable isolated SQLite commits.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import express from 'express'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {runtimeAssetsRouter,resolveRuntimeAssets} from '../server/rendering/assets.ts'
import {launchHiddenBrowser} from '../server/rendering/hidden-browser.ts'
import {DiagramStore} from '../server/store.ts'
import {NativeDiagramService} from '../server/application/native-diagrams.ts'
import {nativeProtocolPatch} from '../src/drawing/engine/collaboration/protocol-patch.ts'
import {drawioRenderSignature,projectDrawio} from '../src/drawing/engine/drawio/index.ts'
import {runtimeFontCSS} from '../src/drawing/engine/runtime-assets.ts'
const output=resolve('output/playwright/cloud-merge'),root=await mkdtemp(join(tmpdir(),'flymind-cloud-merge-probe-'))
const content={schemaVersion:1,id:'live-merge',title:'协同合并验证',kind:'flowchart',nodes:[{id:'a',kind:'task',label:'核对材料'},{id:'b',kind:'task',label:'确认交付'}],edges:[{id:'ab',source:'a',target:'b'}],lanes:[],phases:[],groups:[]}
const report={startedAt:new Date().toISOString(),cases:[],external:[]},clients=[]
const app=express(),server=createServer(app);let browser
app.get('/',(_req,res)=>res.type('html').send('<!doctype html><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style><script>window.events=[];window.send=m=>document.querySelector("iframe").contentWindow.postMessage(JSON.stringify(m),location.origin);addEventListener("message",e=>{if(e.origin===location.origin&&e.source===document.querySelector("iframe").contentWindow&&typeof e.data==="string"){try{events.push(JSON.parse(e.data))}catch{}}})</script><iframe src="/drawio/index.html?embed=1&proto=json&configure=1&offline=1&local=1&ui=min&lang=zh&noSaveBtn=1&noExitBtn=1"></iframe>'))
app.use(runtimeAssetsRouter())
try{
 await mkdir(output,{recursive:true});const store=new DiagramStore(root);await store.init({seedExamples:false});const service=new NativeDiagramService(store,true),initial=await service.create({content,requestId:'create'})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port
 browser=await launchHiddenBrowser(resolveRuntimeAssets().browserExecutable)
 async function client(name){
  const context=await browser.browser.newContext({viewport:{width:1200,height:800},serviceWorkers:'block'}),page=await context.newPage();let sequence=0
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();report.external.push(url);return route.abort()})
  const send=value=>page.evaluate(value=>window.send(value),value)
  async function request(action,fields={},event=action){const start=await page.evaluate(()=>events.length),message=name+':'+(++sequence);await send({action,...fields,message});await page.waitForFunction(({start,message,event})=>events.slice(start).some(e=>e.event===event&&(e.message?.message===message||event==='load')),{start,message,event},{timeout:15000});return page.evaluate(({start,message,event})=>events.slice(start).find(e=>e.event===event&&(e.message?.message===message||event==='load')),{start,message,event})}
  await page.goto(origin);await page.waitForFunction(()=>events.some(e=>e.event==='configure'));await send({action:'configure',config:{fontCss:runtimeFontCSS(),defaultFonts:['Noto Sans CJK SC']}});await page.waitForFunction(()=>events.some(e=>e.event==='init'))
  await request('load',{xml:initial.document.rendering.engine.xml,diffSync:true,autosave:0},'load');await request('fit',{maxScale:1})
  const frame=()=>page.frames().find(f=>f.url().startsWith(origin+'/drawio/'))
  async function label(before,after){await frame().getByText(before,{exact:true}).first().dblclick();const editor=frame().locator('.mxCellEditor:visible').first();await editor.waitFor();await page.keyboard.press('Control+a');await page.keyboard.insertText(after);await page.keyboard.press('Control+Enter');await editor.waitFor({state:'hidden'})}
  const c={name,context,page,frame,request,send,label,xml:async()=>(await request('export',{format:'xml'},'export')).xml};clients.push(c);return c
 }
 const a=await client('a'),b=await client('b')
 await Promise.all([a.label('核对材料','甲核对材料'),b.label('确认交付','乙确认交付')])
 const [ax,bx]=await Promise.all([a.xml(),b.xml()])
 const [ra,rb]=await Promise.all([service.saveCollaborativeEditor(content.id,{xml:ax,expectedRevision:1,requestId:'a-1'},service.dataRootId),service.saveCollaborativeEditor(content.id,{xml:bx,expectedRevision:1,requestId:'b-1'},service.dataRootId)])
 async function reconcile(client,canonical){const current=await client.xml(),patch=nativeProtocolPatch(current,canonical);const reply=await client.request('patch',{patch});assert.equal(reply.error,undefined);await client.request('resetDiff');return client.xml()}
 const canonical=(await service.get(content.id)).document.rendering.engine.xml
 const synced=await Promise.all([reconcile(a,canonical),reconcile(b,canonical)])
 assert.equal(drawioRenderSignature(synced[0]),drawioRenderSignature(synced[1]));assert.equal(drawioRenderSignature(synced[0]),drawioRenderSignature(canonical))
 report.cases.push({name:'simultaneous-native-text',revisions:[ra.revision,rb.revision],converged:true})
 // Public patch is remote/non-undoable; local Undo must preserve the other actor.
 await a.send({action:'invokeAction',actionName:'undo'});const undo=await a.xml(),projection=await projectDrawio(undo,content)
 assert.deepEqual(projection.content.nodes.map(n=>n.label),['核对材料','乙确认交付'])
 const saved=await service.saveCollaborativeEditor(content.id,{xml:undo,expectedRevision:3,requestId:'a-undo'},service.dataRootId)
 await reconcile(b,saved.document.rendering.engine.xml)
 assert.equal(drawioRenderSignature(await a.xml()),drawioRenderSignature(await b.xml()))
 report.cases.push({name:'local-undo-after-remote',remotePreserved:true,converged:true,revision:saved.revision})
 // Duplication carries stale business metadata; canonical normalization returns a
 // precise public metadata patch rather than a reload of the whole editor.
 await a.frame().getByText('核对材料',{exact:true}).first().click();await a.page.keyboard.press('Control+d')
 const duplicate=await a.xml(),copy=await service.saveCollaborativeEditor(content.id,{xml:duplicate,expectedRevision:4,requestId:'copy'},service.dataRootId)
 const copySynced=await Promise.all([reconcile(a,copy.document.rendering.engine.xml),reconcile(b,copy.document.rendering.engine.xml)])
 assert.equal(drawioRenderSignature(copySynced[0]),drawioRenderSignature(copySynced[1]));assert.equal(copy.document.content.nodes.length,3)
 report.cases.push({name:'copy-normalized-metadata-incremental-ack',nodes:3,converged:true,revision:copy.revision})
 await a.page.screenshot({path:join(output,'client-a.png')});await b.page.screenshot({path:join(output,'client-b.png')});report.ok=true
}catch(error){report.error=error.stack;process.exitCode=1}
finally{
 for(const client of clients)await client.context.close().catch(()=>{});await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r))
 assert.ok(root.startsWith(join(tmpdir(),'flymind-cloud-merge-probe-')));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})
 report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
