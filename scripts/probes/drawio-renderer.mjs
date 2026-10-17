import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {chromium} from 'playwright-core';
import {createHash} from 'node:crypto';
import {RUNTIME_FONT_FAMILY,RUNTIME_FONT_SHA256} from '../../src/drawing/engine/runtime-assets.ts';
import {NativeDrawioRenderer} from '../../server/rendering/renderer.ts';
import {resolveRuntimeAssets,checkRuntimeAssets} from '../../server/rendering/assets.ts';
import {compileDrawio,projectDrawio,drawioRenderSignature} from '../../src/drawing/engine/drawio/index.ts';
import {createDrawingProject} from '../../src/drawing/engine/project.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(root,'output/playwright/drawio-renderer'),renderer=new NativeDrawioRenderer();await mkdir(out,{recursive:true});
const failuresOnly=process.argv.includes('--failures-only');
const report={startedAt:new Date().toISOString(),samples:[],failures:[]};
try{
 const content=JSON.parse(await readFile(resolve(root,'tests/fixtures/drawio-baseline/pbs-main.content.json'),'utf8')),base=await createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1});
 for(const name of failuresOnly?[]:['cold-pbs','warm-pbs-1','warm-pbs-2','warm-pbs-3','long-text','transparent','large-scale','legacy-alias','general-decoration','mixed-aliases']){
  const c=structuredClone(content);if(name==='long-text'){c.title='跨部门申请审核、风险澄清与交付确认'.repeat(10).slice(0,160);c.nodes[0].label='需要在规定时间内核验申请资料与服务目标，并由负责人确认后移交下一环节；'.repeat(5);c.nodes.push({id:'long-note',kind:'note',label:'浮动说明：保持真实业务关系，不用备注推动主流程排序。'.repeat(20).slice(0,500),laneId:'r04',phaseId:'p05'})}
  let project=name==='long-text'?await createDrawingProject(c,await compileDrawio(c),{createdAt:1,updatedAt:1}):base;
  if(name==='legacy-alias')project=await createDrawingProject(content,{...base.rendering.engine,xml:base.rendering.engine.xml.replaceAll('fontFamily=Noto Sans CJK SC','fontFamily=Microsoft YaHei')},{createdAt:1,updatedAt:1});
  if(name==='general-decoration')project=await createDrawingProject(content,{...base.rendering.engine,xml:base.rendering.engine.xml.replace('</root>','<mxCell id="generic" parent="1" vertex="1" value="普通装饰" style="rounded=0;whiteSpace=wrap;html=0;"><mxGeometry x="2200" y="40" width="200" height="80" as="geometry"/></mxCell></root>')},{createdAt:1,updatedAt:1});
  if(name==='mixed-aliases'){let index=0;const names=['Microsoft YaHei','Helvetica','Arial'];project=await createDrawingProject(content,{...base.rendering.engine,xml:base.rendering.engine.xml.replaceAll('fontFamily=Noto Sans CJK SC',()=>`fontFamily=${names[index++%3]}`)},{createdAt:1,updatedAt:1})}
  const result=await renderer.render(project,{background:name==='transparent'?'transparent':'white',scale:name==='large-scale'?4:1});assert.equal((await projectDrawio(result.nativeXML)).contentHash,project.rendering.engine.contentHash);assert.equal(drawioRenderSignature(result.nativeXML),drawioRenderSignature(project.rendering.engine.xml));
  const corner=await sharp(result.png).ensureAlpha().extract({left:0,top:0,width:1,height:1}).raw().toBuffer();assert.equal(corner[3],name==='transparent'?0:255);if(name!=='transparent')assert.deepEqual([...corner.slice(0,3)],[255,255,255]);
  const fontURLs=[...result.svg.matchAll(/url\(([^)]+)\)/g)].map(m=>m[1].trim().replace(/^["']|["']$/g,''));assert.ok(fontURLs.length>0);for(const url of fontURLs)assert.equal(createHash('sha256').update(Buffer.from(url.slice(url.indexOf(',')+1),'base64')).digest('hex'),RUNTIME_FONT_SHA256);
  await writeFile(resolve(out,name+'.png'),result.png);await writeFile(resolve(out,name+'.svg'),result.svg);if(result.nativeSVG)await writeFile(resolve(out,name+'.native.svg'),result.nativeSVG);await writeFile(resolve(out,name+'.drawio'),result.nativeXML);
  report.samples.push({name,width:result.width,height:result.height,scale:result.scale,pngBytes:result.png.length,svgBytes:Buffer.byteLength(result.svg),runtime:result.runtime,timings:result.timings,warnings:result.warnings,nativeSnapshotUnchanged:true});console.log(JSON.stringify(report.samples.at(-1)));
 }
 for(const [name,fn] of [
  ['timeout',()=>renderer.render(base,{timeoutMs:1})],
  ['timeout-live',()=>renderer.render(base,{timeoutMs:300})],
  ['abort-live',async()=>{const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),350);try{return await renderer.render(base,{signal:abort.signal})}finally{clearTimeout(timer)}}],
  ['unsupported-font',async()=>{const p=await createDrawingProject(content,{...base.rendering.engine,xml:base.rendering.engine.xml.replaceAll('fontFamily=Noto Sans CJK SC','fontFamily=Unsupplied Font')},{createdAt:1,updatedAt:1});return renderer.render(p)}],
  ['abort',()=>renderer.render(base,{signal:AbortSignal.abort()})],
  ['invalid-xml',()=>renderer.render({...base,rendering:{...base.rendering,engine:{...base.rendering.engine,xml:'<!DOCTYPE a><a/>'}}})],
  ['missing-browser',()=>checkRuntimeAssets({...resolveRuntimeAssets(),browserExecutable:resolve(out,'missing-browser')})],
  ['missing-font',()=>checkRuntimeAssets({...resolveRuntimeAssets(),fontRoot:resolve(out,'missing-font')})]
 ]){try{await fn();throw Error(`Expected ${name} rejection`)}catch(e){assert.ok(!e.message.startsWith('Expected'));report.failures.push({name,code:e.code??e.message.split(':')[0],message:e.message})}}
 const recoveryContent={...content,title:'中断后新快照验证'},recoveryProject=await createDrawingProject(recoveryContent,await compileDrawio(recoveryContent),{createdAt:1,updatedAt:1}),recovery=await renderer.render(recoveryProject);assert.ok(recovery.nativeXML.includes('中断后新快照验证'));report.recoveryAfterFailure={newSnapshot:true,width:recovery.width,height:recovery.height};
 const portableBrowser=await chromium.launch({headless:true,executablePath:resolveRuntimeAssets().browserExecutable});try{const page=await portableBrowser.newPage({viewport:{width:1965,height:1000}}),external=[];await page.route('**/*',route=>{external.push(route.request().url());return route.abort()});await page.setContent('<style>body{margin:0}</style>'+await readFile(resolve(out,'cold-pbs.svg'),'utf8'));await page.evaluate(async family=>{await document.fonts.load(`16px \"${family}\"`,'中文流程');await document.fonts.ready;if(!document.fonts.check(`16px \"${family}\"`,'中文流程'))throw Error('portable font missing')},RUNTIME_FONT_FAMILY);assert.equal(external.length,0);await page.screenshot({path:resolve(out,'portable-svg.png'),fullPage:true});report.portableSVG={fontLoaded:true,externalRequests:external}}finally{await portableBrowser.close()}
 if(report.samples.length){const warm=report.samples.filter(s=>s.name.startsWith('warm-')).map(s=>s.timings.totalMs).sort((a,b)=>a-b);report.performance={coldMs:report.samples[0].timings.totalMs,warmCount:warm.length,warmObservedP95Ms:warm[Math.ceil(warm.length*.95)-1],note:'Three warm samples only; not a production percentile guarantee.'};}report.ok=true;
}catch(e){report.ok=false;report.error=e.stack;process.exitCode=1}
finally{await renderer.close();await writeFile(resolve(out,failuresOnly?'failure-modes.json':'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
