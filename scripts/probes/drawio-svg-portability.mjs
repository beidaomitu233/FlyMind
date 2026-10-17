import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {NativeDrawioRenderer} from '../../server/rendering/renderer.ts';
import {resolveRuntimeAssets} from '../../server/rendering/assets.ts';
import {svgDrawingSignature} from '../../server/rendering/svg-fonts.ts';
import {compileDrawio} from '../../src/drawing/engine/drawio/index.ts';
import {createDrawingProject} from '../../src/drawing/engine/project.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=resolve(root,'output/playwright/drawio-renderer'),renderer=new NativeDrawioRenderer(),report={startedAt:new Date().toISOString()};let browser;
const sha=b=>createHash('sha256').update(b).digest('hex');
try{
 const content=JSON.parse(await readFile(resolve(root,'tests/fixtures/drawio-baseline/pbs-main.content.json'),'utf8')),engine=await compileDrawio(content);let index=0;const names=['Microsoft YaHei','Helvetica','Arial'],project=await createDrawingProject(content,{...engine,xml:engine.xml.replaceAll('fontFamily=Noto Sans CJK SC',()=>`fontFamily=${names[index++%3]}`)},{createdAt:1,updatedAt:1}),result=await renderer.render(project);
 assert.ok(result.nativeSVG);await writeFile(resolve(out,'mixed-aliases.native.svg'),result.nativeSVG);await writeFile(resolve(out,'mixed-aliases.svg'),result.svg);await writeFile(resolve(out,'mixed-aliases.png'),result.png);
 const oldSVG=await readFile(resolve(out,'font-duplicates-baseline/mixed-aliases.svg'),'utf8'),oldPNG=await readFile(resolve(out,'font-duplicates-baseline/mixed-aliases.png'));
 assert.equal(svgDrawingSignature(result.nativeSVG),svgDrawingSignature(result.svg));assert.equal(svgDrawingSignature(oldSVG),svgDrawingSignature(result.svg));assert.equal(sha(oldPNG),sha(result.png));
 report.invariants={rawNativeToPackaged:true,oldEmbeddedToPackaged:true,pngBytesIdentical:true,singleFontFace:(result.svg.match(/@font-face/g)||[]).length===1,oldSVGBytes:Buffer.byteLength(oldSVG),packagedSVGBytes:Buffer.byteLength(result.svg),nativeSVGBytes:Buffer.byteLength(result.nativeSVG)};assert.equal(report.invariants.singleFontFace,true);
 browser=await chromium.launch({headless:true,executablePath:resolveRuntimeAssets().browserExecutable});const images=[];
 for(const [name,svg,families] of [['before',oldSVG,names],['after',result.svg,['Noto Sans CJK SC']]]){
  const page=await browser.newPage({viewport:{width:1965,height:1000}}),external=[];await page.route('**/*',route=>{external.push(route.request().url());return route.abort()});await page.setContent('<style>body{margin:0}</style>'+svg);await page.evaluate(async families=>{for(const family of families)await document.fonts.load(`16px "${family}"`,'中文流程');await document.fonts.ready;if(!families.every(f=>document.fonts.check(`16px "${f}"`,'中文流程')))throw Error('font not ready')},families);const png=await page.screenshot({path:resolve(out,`mixed-portable-${name}.png`),fullPage:true});assert.equal(external.length,0);images.push(png);await page.close();
 }
 assert.equal(sha(images[0]),sha(images[1]));report.offline={bothFontsReady:true,externalRequests:[],screenshotsByteIdentical:true};report.timings=result.timings;report.ok=true;
}catch(e){report.ok=false;report.error=e.stack;process.exitCode=1}
finally{await renderer.close();await browser?.close();await mkdir(out,{recursive:true});await writeFile(resolve(out,'svg-portability.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}
