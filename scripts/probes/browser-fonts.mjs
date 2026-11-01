// Isolated real native Host; no production URLs/accounts/API writes.
import assert from 'node:assert/strict'
import express from 'express'
import {createServer} from 'node:http'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {randomUUID,createHash} from 'node:crypto'
import {launchHiddenBrowser} from '../../server/rendering/hidden-browser.ts'
import {runtimeAssetsRouter,resolveRuntimeAssets,checkRuntimeAssets} from '../../server/rendering/assets.ts'
import {DrawioHostController} from '../../src/drawing/engine/drawio-host/controller.ts'
import {drawioHostURL} from '../../src/drawing/engine/drawio-host/library.ts'
import {compileDrawio,normalizeDrawioEdits} from '../../src/drawing/engine/drawio/index.ts'
import {createDrawingProject} from '../../src/drawing/engine/project.ts'
import {extractContent} from '../../src/drawing/core/layers.ts'
import {sampleFor} from '../../src/drawing/core/samples.ts'
import {technicalReferenceContent} from '../../src/drawing/core/technical-sample.ts'
import {NativeDrawioRenderer} from '../../server/rendering/renderer.ts'
import {RUNTIME_FONT_SHA256} from '../../src/drawing/engine/runtime-assets.ts'
import {browserFontCSS} from '../../src/drawing/engine/browser-fonts.ts'
const out=process.env.FLYMIND_PROBE_OUTPUT??'output/playwright/u39-browser-fonts',report={cases:[]};let owned,server,renderer
await mkdir(out,{recursive:true});await checkRuntimeAssets()
try{
 const app=express();app.get('/font-probe',(_req,res)=>res.type('html').send('<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe style="width:1600px;height:1100px;border:0"></iframe><script>addEventListener("message",e=>{const f=document.querySelector("iframe");if(e.source===f.contentWindow&&e.origin===location.origin&&typeof e.data==="string")window.__nativeMessage(e.data,e.origin)});window.__send=(data,origin)=>document.querySelector("iframe").contentWindow.postMessage(data,origin)</script>'))
 app.use(runtimeAssetsRouter());server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port
 owned=await launchHiddenBrowser(resolveRuntimeAssets().browserExecutable)
 const flow={...extractContent(sampleFor('flowchart')),id:'font-small',title:'浏览器字体流程验证'},technical=technicalReferenceContent('font-technical'),pbs={...JSON.parse(await readFile('tests/fixtures/drawio-baseline/pbs-main.content.json','utf8')),id:'font-pbs'}
 let editedProject
 for(const [content,web] of (process.env.FLYMIND_FONT_DEBUG_SMALL==='1'?[[flow,true]]:[[flow,false],[flow,true],[technical,true],[pbs,true]])){
  const project=await createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1}),context=await owned.browser.newContext({viewport:{width:1600,height:1100},serviceWorkers:'block'}),page=await context.newPage(),requests=[],target={};let controller,yes,no
  page.setDefaultTimeout(15000);page.on('console',m=>{if(['warning','error'].includes(m.type())){report.fontDiagnostics??=[];report.fontDiagnostics.push(m.text().slice(0,500))}});page.on('requestfinished',r=>{if(r.url().includes('/runtime-assets/fonts/'))requests.push({path:new URL(r.url()).pathname,bytes:r.sizes().then(s=>Math.max(0,s.responseBodySize))})})
  await page.exposeBinding('__nativeMessage',async(_source,data,eventOrigin)=>{if(web&&JSON.parse(data).event==='configure'){const frame=page.frames().find(f=>f.url().includes('/drawio/'));await frame.addStyleTag({content:browserFontCSS()})}controller?.handle({source:target,origin:eventOrigin,data})})
  await page.goto(origin+'/font-probe');const post=(data,targetOrigin)=>{void page.evaluate(({data,targetOrigin})=>window.__send(data,targetOrigin),{data,targetOrigin}).catch(e=>no?.(e))}
  function load(xml,initialized=false){controller?.dispose();return new Promise((resolve,reject)=>{yes=resolve;no=reject;controller=new DrawioHostController({sessionKey:randomUUID(),initialXML:xml,title:content.title,origin,source:()=>target,post,browserFonts:web,initializedEngine:initialized,onReady:resolve,onError:e=>reject(Error(e.code+': '+e.message))})})}
  try{
   const start=performance.now(),ready=load(project.rendering.engine.xml);await page.locator('iframe').evaluate((f,url)=>f.src=url,drawioHostURL(origin,project.rendering.engine.xml));await ready;const frame=page.frames().find(f=>f.url().includes('/drawio/'));assert.ok(frame)
   controller.fit();await frame.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await frame.evaluate(()=>document.fonts.ready);const coldReadyMs=Math.round(performance.now()-start)
   const label=await frame.evaluate(labels=>{const known=new Set(labels);return [...document.querySelectorAll('.geDiagramContainer div,.geDiagramContainer text')].find(e=>{const b=e.getBoundingClientRect();return e.children.length===0&&known.has(e.textContent)&&b.width>2&&b.height>2&&b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight})?.textContent},content.nodes.filter(n=>n.kind!=='note').map(n=>n.label));assert.ok(label,'No business text visible in current native viewport');const node=content.nodes.find(n=>n.label===label);await frame.getByText(label,{exact:true}).first().dblclick();await frame.locator('.mxCellEditor:visible').waitFor();await page.keyboard.press('Escape')
   const fonts=[];for(const r of requests)fonts.push({path:r.path,bytes:await r.bytes});const beforeWarm=requests.length,warmStart=performance.now();await load(project.rendering.engine.xml,true);await frame.evaluate(()=>document.fonts.ready);const warmReadyMs=Math.round(performance.now()-warmStart)
   assert.equal(requests.length,beforeWarm,'warm native load must reuse font cache')
   const record={kind:content.kind,browserFonts:web,nodes:content.nodes.length,coldReadyMs,warmReadyMs,fontRequests:fonts.length,uniqueFontFiles:new Set(fonts.map(f=>f.path)).size,fontBytes:fonts.reduce((n,f)=>n+f.bytes,0),fonts,editable:true,warmAdditionalFontRequests:requests.length-beforeWarm}
   report.lastMeasured=record
   if(web){assert.ok(fonts.every(f=>f.path.endsWith('.woff2')),'normal supported browser must not preload OTF fallback');await page.locator('iframe').screenshot({path:out+'/'+content.kind+'.png'})}
   if(web&&content.kind==='flowchart'){
    const label='校验𠮷结果';await frame.getByText(node.label,{exact:true}).first().dblclick();await frame.locator('.mxCellEditor:visible').fill(label);const xml=await controller.commitAndCaptureXML(),result=await normalizeDrawioEdits(xml,project);assert.equal(result.content.nodes.find(n=>n.id===node.id).label,label)
    await writeFile(out+'/edited.drawio',result.xml);editedProject=await createDrawingProject(result.content,{...project.rendering.engine,xml:result.xml,contentHash:result.contentHash},{createdAt:1,updatedAt:2})
    await load((await compileDrawio(technical)).xml,true);await frame.evaluate(()=>document.fonts.ready)
    await load(await readFile(out+'/edited.drawio','utf8'),true);await frame.evaluate(()=>document.fonts.ready);await frame.getByText(label,{exact:true}).first().dblclick();await frame.locator('.mxCellEditor:visible').waitFor();await page.keyboard.press('Escape');await page.locator('iframe').screenshot({path:out+'/edited-reopened.png'});record.editedSavedReopenedLabel=label;record.switchedToTechnicalAndBack=true
    const afterSave=[];for(const r of requests)afterSave.push({path:r.path,bytes:await r.bytes});assert.ok(afterSave.every(f=>f.path.endsWith('.woff2')));assert.ok(new Set(afterSave.map(f=>f.path)).size<95);record.afterEditSwitchReopen={requests:afterSave.length,uniqueFontFiles:new Set(afterSave.map(f=>f.path)).size,fontBytes:afterSave.reduce((n,f)=>n+f.bytes,0),noOTFFallback:true}
   }
   report.cases.push(record)
  }finally{controller?.dispose();await context.close()}
 }
 await owned.close();owned=undefined
 renderer=new NativeDrawioRenderer();const exported=await renderer.render(editedProject);assert.ok(exported.svg.includes('校验𠮷结果'));const match=/data:font\/otf;base64,([^"\)]+)/.exec(exported.svg);assert.ok(match);assert.equal(createHash('sha256').update(Buffer.from(match[1],'base64')).digest('hex'),RUNTIME_FONT_SHA256);assert.ok(!exported.svg.includes('FlyMindCJKWeb-'))
 await writeFile(out+'/edited-export.png',exported.png);await writeFile(out+'/edited-export.svg',exported.svg);report.export={sameChineseLabel:true,originalOTFFontSHA:RUNTIME_FONT_SHA256,pngBytes:exported.png.length};report.ok=true
}catch(e){report.error=e.message;process.exitCode=1}finally{await owned?.close();await renderer?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
