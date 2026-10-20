// Narrow fixed-native codec/view protocol validation. No local Runtime/user DB.
import assert from 'node:assert/strict'
import express from 'express'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {runtimeAssetsRouter,resolveRuntimeAssets} from '../server/rendering/assets.ts'
import {launchHiddenBrowser} from '../server/rendering/hidden-browser.ts'
import {runtimeFontCSS} from '../src/drawing/engine/runtime-assets.ts'
import {DiagramStore} from '../server/store.ts'
import {NativeDiagramService} from '../server/application/native-diagrams.ts'
import {nativeProtocolPatch,codecModelAttributes} from '../src/drawing/engine/collaboration/protocol-patch.ts'
import {sameNativeState} from '../src/drawing/engine/collaboration/state.ts'
import {parseNative,serialize,attr} from '../src/drawing/engine/drawio/xml.ts'
const out=resolve(process.env.FLYMIND_PROBE_OUTPUT??'output/playwright/cloud-view-properties'),root=await mkdtemp(join(tmpdir(),'flymind-cloud-view-'))
const report={cases:[],external:[]},clients=[],app=express(),server=createServer(app);let owned
const content={schemaVersion:1,id:'view-swimlane',title:'泳道页面协同',kind:'swimlane',nodes:[{id:'start',kind:'start',label:'接收申请',laneId:'owner',phaseId:'work'},{id:'task',kind:'task',label:'核对材料',laneId:'owner',phaseId:'work'},{id:'end',kind:'end',label:'确认交付',laneId:'owner',phaseId:'work'}],edges:[{id:'a',source:'start',target:'task'},{id:'b',source:'task',target:'end'}],lanes:[{id:'owner',label:'经办人'}],phases:[{id:'work',label:'受理'}],groups:[]}
app.get('/',(_req,res)=>res.type('html').send('<!doctype html><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style><script>window.events=[];window.send=m=>document.querySelector("iframe").contentWindow.postMessage(JSON.stringify(m),location.origin);addEventListener("message",e=>{if(e.origin===location.origin&&e.source===document.querySelector("iframe").contentWindow&&typeof e.data==="string"){try{events.push(JSON.parse(e.data))}catch{}}})</script><iframe src="/drawio/index.html?embed=1&proto=json&configure=1&offline=1&local=1&ui=min&lang=zh&noSaveBtn=1&noExitBtn=1"></iframe>'))
app.use(runtimeAssetsRouter())
try{
 await mkdir(out,{recursive:true});const store=new DiagramStore(root);await store.init({seedExamples:false});const service=new NativeDiagramService(store,true),initial=await service.create({content,requestId:'create'})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port
 owned=await launchHiddenBrowser(resolveRuntimeAssets().browserExecutable)
 async function open(name){
  const context=await owned.browser.newContext({viewport:{width:1100,height:780},serviceWorkers:'block'}),page=await context.newPage();let seq=0;clients.push({context,page})
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();report.external.push(url);return route.abort()})
  const send=value=>page.evaluate(value=>window.send(value),value)
  async function request(action,fields={},event=action){const start=await page.evaluate(()=>events.length),message=name+':'+(++seq);await send({action,...fields,message});await page.waitForFunction(({start,message,event})=>events.slice(start).some(e=>e.event===event&&(e.message?.message===message||event==='load')),{start,message,event},{timeout:15000});return page.evaluate(({start,message,event})=>events.slice(start).find(e=>e.event===event&&(e.message?.message===message||event==='load')),{start,message,event})}
  await page.goto(origin);await page.waitForFunction(()=>events.some(e=>e.event==='configure'));await send({action:'configure',config:{fontCss:runtimeFontCSS(),defaultFonts:['Noto Sans CJK SC']}});await page.waitForFunction(()=>events.some(e=>e.event==='init'))
  await request('load',{xml:initial.document.rendering.engine.xml,diffSync:true,autosave:0},'load')
  const capture=async()=>(await request('export',{format:'xml'},'export')).xml
  async function apply(xml){const current=await capture(),patch=nativeProtocolPatch(current,xml),reply=await request('patch',{patch});assert.equal(reply.error,undefined);await request('resetDiff');const result=await capture();if(!sameNativeState(result,xml)){await writeFile(join(out,name+'-expected.drawio'),xml);await writeFile(join(out,name+'-captured.drawio'),result);await writeFile(join(out,name+'-patch.json'),JSON.stringify({patch,reply},null,2));assert.fail('Public native patch must converge to server state')}return result}
  return {capture,apply,request,page}
 }
 const a=await open('a'),b=await open('b'),captured=await a.capture(),model=parseNative(captured).model
 assert.ok([...codecModelAttributes].every(key=>attr(model,key)===undefined),'Native codec really drops historical model mirrors')
 const first=await service.saveCollaborativeEditor(content.id,{xml:captured,expectedRevision:initial.revision,requestId:'native-first'},service.dataRootId)
 await a.apply(first.document.rendering.engine.xml);await b.apply(first.document.rendering.engine.xml)
 const noop=await service.saveCollaborativeEditor(content.id,{xml:await a.capture(),expectedRevision:first.revision,requestId:'native-ack'},service.dataRootId)
 assert.equal(noop.revision,first.revision,'Native ACK must not generate another revision')
 report.cases.push({name:'swimlane-first-save-and-native-ACK',revision:first.revision,converged:true,noExtraRevision:true})
 const n=parseNative(await a.capture());n.model.setAttribute('pageScale','1.25')
 await a.apply(serialize(n.document));const scale=await service.saveCollaborativeEditor(content.id,{xml:await a.capture(),expectedRevision:first.revision,requestId:'scale-only'},service.dataRootId)
 assert.equal(scale.revision,first.revision+1,'Pure pageScale edit must persist')
 await a.apply(scale.document.rendering.engine.xml);await b.apply(scale.document.rendering.engine.xml)
 assert.equal(attr(parseNative(await b.capture()).model,'pageScale'),'1.25')
 report.cases.push({name:'pure-pageScale-public-patch',revision:scale.revision,converged:true})
 const all=parseNative(await a.capture());for(const [key,value] of Object.entries({background:'#fef4e8',page:'1',pageWidth:'960',pageHeight:'720',shadow:'1',fold:'0',math:'1'}))all.model.setAttribute(key,value)
 await a.apply(serialize(all.document));const properties=await service.saveCollaborativeEditor(content.id,{xml:await a.capture(),expectedRevision:scale.revision,requestId:'paper-properties'},service.dataRootId)
 await a.apply(properties.document.rendering.engine.xml);await b.apply(properties.document.rendering.engine.xml)
 const actual=parseNative(await b.capture()).model;for(const [key,value] of Object.entries({background:'#fef4e8',page:'1',pageWidth:'960',pageHeight:'720',shadow:'1',fold:'0',math:'1'}))assert.equal(attr(actual,key),value)
 await writeFile(join(out,'native-saved.drawio'),await b.capture());await b.page.screenshot({path:join(out,'native-saved.png')})
 report.cases.push({name:'background-format-shadow-fold-math-public-patch',revision:properties.revision,converged:true});report.ok=true
}catch(error){report.error=error.stack;process.exitCode=1}
finally{
 for(const c of clients)await c.context.close().catch(()=>{});await owned?.close();server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(root.startsWith(join(tmpdir(),'flymind-cloud-view-')));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});report.cleaned=true;await mkdir(out,{recursive:true});await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
