import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {resolve,join} from 'node:path'
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {runHeavyWork} from '../server/heavy-work/runner'
import {inspectSVGCPU,packageSVGCPU} from '../server/heavy-work/svg'
import {resolveRuntimeAssets} from '../server/rendering/assets'
import {RUNTIME_FONT_FILE,RUNTIME_FONT_SHA256} from '../src/drawing/engine/runtime-assets'
import {inspectNativeSVGResources} from '../server/rendering/svg-resources'
import {BROWSER_FONT_MANIFEST} from '../src/drawing/engine/browser-font-manifest'
import {svgVisibleCharacters,svgDrawingSignature} from '../server/rendering/svg-fonts'

test('isolated artifact inspection validates complete XML and dimensions',async()=>{
 assert.deepEqual(await runHeavyWork('svg-metadata',{svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><text>流程</text></svg>'}),{valid:true})
 for(const svg of ['<html/>','<svg width="0" height="-1"/>','<svg width="10" height="10"><g></svg>','<!DOCTYPE svg [<!ENTITY ext SYSTEM "file:///private">]><svg width="1" height="1"/>']){
  await assert.rejects(runHeavyWork('svg-metadata',{svg}),{code:'EXPORT_RENDER_INVALID'})
 }
 assert.throws(()=>inspectSVGCPU({svg:'<svg width="10" height="10"/>'+'x'.repeat(96*1024*1024)}),{code:'OUTPUT_BUDGET'})
})

test('killable SVG packaging preserves text with only pinned offline WOFF2 coverage',async()=>{
 const source='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="8" y="30" font-family="Noto Sans CJK SC">确认流程 → 完成</text></svg>'
 const {svg}=await runHeavyWork<{svg:string}>('svg-fonts',{svg:source,fontFile:resolve(resolveRuntimeAssets().fontRoot,RUNTIME_FONT_FILE)})
 assert.ok(svg.includes('确认流程 → 完成'));assert.ok(svg.includes('data-runtime-font="canonical"'))
 const fonts=inspectNativeSVGResources(svg).urls.filter(url=>url.startsWith('data:font/'))
 assert.ok(fonts.length>=1);const approved=new Set<string>(BROWSER_FONT_MANIFEST.files.map(file=>file.sha256))
 for(const url of fonts){assert.ok(url.startsWith('data:font/woff2;'));assert.ok(approved.has(createHash('sha256').update(Buffer.from(url.slice(url.indexOf(',')+1),'base64')).digest('hex')))}
 assert.ok(Buffer.byteLength(svg)<2_000_000);assert.equal(svgDrawingSignature(svg),svgDrawingSignature(source))
 assert.deepEqual(await runHeavyWork('svg-metadata',{svg}),{valid:true})
})

test('font selection decodes entities and HTML text; variation uses the original complete supply',async()=>{
 const source='<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><text font-family="Arial" font-weight="bold">Latin 标点，&#x9F98;𠮷</text><foreignObject width="200" height="80"><div xmlns="http://www.w3.org/1999/xhtml">&#x9F8D; &amp; 完成</div></foreignObject></svg>'
 const points=svgVisibleCharacters(source)!;assert.ok(points.has(0x9f98));assert.ok(points.has(0x9f8d));assert.ok(points.has(0x20bb7));assert.ok(points.has(0x26))
 const fontFile=resolve(resolveRuntimeAssets().fontRoot,RUNTIME_FONT_FILE),result=await runHeavyWork<{svg:string}>('svg-fonts',{svg:source,fontFile})
 assert.equal(svgDrawingSignature(result.svg),svgDrawingSignature(source));assert.ok(!inspectNativeSVGResources(result.svg).urls.some(url=>url.startsWith('http')))
 const variation=source.replace('Latin','Latin ❤️'),fallback=await runHeavyWork<{svg:string}>('svg-fonts',{svg:variation,fontFile})
 const fonts=inspectNativeSVGResources(fallback.svg).urls.filter(url=>url.startsWith('data:font/'))
 assert.equal(fonts.length,1);assert.equal(createHash('sha256').update(Buffer.from(fonts[0].slice(fonts[0].indexOf(',')+1),'base64')).digest('hex'),RUNTIME_FONT_SHA256)
})

test('derived and complex text conservatively uses full font selection',()=>{
 for(const body of [
  '<text style="text-transform:uppercase">ß</text>',
  '<text text-transform="uppercase">a</text>',
  '<style>.x:before{content:"额外"}</style><text>a</text>',
  '<text style="content:&quot;额外&quot;">a</text>',
  '<style>.x{\\74 ext-transform:uppercase}</style><text>a</text>',
  '<foreignObject><input xmlns="http://www.w3.org/1999/xhtml" value="额外"/></foreignObject>',
  '<text>e&#x301;</text>', '<text>가</text>', '<text>العربية</text>', '<text>❤️</text>'
 ])assert.equal(svgVisibleCharacters(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`),undefined,body)
})

test('simple draw.io inline flex labels select pinned offline fonts without changing the drawing',async()=>{
 const styles=[
  'display: flex; align-items: unsafe center; justify-content: unsafe flex-start; width: 738px; height: 1px; padding-top: 40px; margin-left: 8px;',
  'height: 1px; justify-content: unsafe center; display: flex; align-items: unsafe center; width: 182px; padding-top: 147px; margin-left: 17px;',
  'display: flex; align-items: unsafe flex-start; justify-content: unsafe center; width: 182px; height: 1px;',
  'display: flex; align-items: unsafe flex-end; justify-content: unsafe flex-start; width: 182px; height: 1px;'
 ]
 const source=`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><foreignObject width="200" height="80"><div xmlns="http://www.w3.org/1999/xhtml" style="${styles[0]}">核对中文需求 &amp; 𠮷</div><div xmlns="http://www.w3.org/1999/xhtml" style="${styles[1]}">完成</div><div xmlns="http://www.w3.org/1999/xhtml" style="${styles[2]}">开始</div><div xmlns="http://www.w3.org/1999/xhtml" style="${styles[3]}">结束</div></foreignObject></svg>`
 const points=svgVisibleCharacters(source);assert.ok(points);assert.ok(points.has(0x20bb7));assert.ok(points.has(0x26))
 const {svg}=await packageSVGCPU({svg:source,fontFile:resolve(resolveRuntimeAssets().fontRoot,RUNTIME_FONT_FILE)})
 assert.equal(svgDrawingSignature(svg),svgDrawingSignature(source));for(const style of styles)assert.ok(svg.includes(style));assert.ok(svg.includes('核对中文需求 &amp; 𠮷'))
 const resources=inspectNativeSVGResources(svg),fonts=resources.urls.filter(url=>url.startsWith('data:font/'))
 assert.ok(fonts.length>0);assert.ok(fonts.every(url=>url.startsWith('data:font/woff2;')));assert.ok(!resources.urls.some(url=>/^https?:/i.test(url)))
 const approved=new Set<string>(BROWSER_FONT_MANIFEST.files.map(file=>file.sha256))
 for(const url of fonts)assert.ok(approved.has(createHash('sha256').update(Buffer.from(url.slice(url.indexOf(',')+1),'base64')).digest('hex')))
 assert.ok(Buffer.byteLength(svg)<2_000_000)
})

test('flex exception rejects generated text and unfamiliar or ambiguous inline CSS',()=>{
 for(const style of [
  'content:额外;justify-content:unsafe center',
  'text-transform:uppercase;justify-content:unsafe center',
  'x-content:value;justify-content:unsafe center',
  'align-content:center;justify-content:unsafe center',
  'justify-content:unsafe center!important',
  'justify-content:unsafe center;justify-content:unsafe flex-start',
  'justify-content:unsafe center;unknown:value',
  'justify-content:unsafe center;;display:flex',
  'justify-content:unsafe center;--custom:value',
  'justify-content:unsafe center;display:calc(1)',
  'justify-content:unsafe center;display:/*x*/flex',
  'justify-content:unsafe center;display:&quot;flex&quot;',
  'justify-content:unsafe center;\\74 ext-transform:uppercase',
  'justify-content:unsafe center;display:flex;broken',
  'justify-content:unsafe center;align-items:unsafe baseline',
  'justify-content:unsafe center;align-items:flex-end',
  'justify-content:unsafe center;align-items:unsafe flex-end!important',
  'justify-content:unsafe center;align-items:unsafe flex-end;align-items:unsafe flex-start',
  'justify-content:unsafe center;align-items:unsafe flex-end;content:secret',
  'justify-content:unsafe left',
  'justify-content:unsafe center;width:-1px'
 ])assert.equal(svgVisibleCharacters(`<svg xmlns="http://www.w3.org/2000/svg"><text style="${style}">文字</text></svg>`),undefined,style)
 for(const body of [
  '<style>.x{justify-content:unsafe center}</style><text>文字</text>',
  '<style>.x:before{content:"额外"}</style><text>文字</text>',
  '<text style="justify-content:unsafe center">e&#x301;</text>',
  '<text style="justify-content:unsafe center">❤️</text>',
  '<foreignObject><input xmlns="http://www.w3.org/1999/xhtml" style="justify-content:unsafe center" value="额外"/></foreignObject>'
 ])assert.equal(svgVisibleCharacters(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`),undefined,body)
})

test('new flex alignment still embeds the full pinned font when generated content is present',async()=>{
 const source='<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><foreignObject width="80" height="40"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:unsafe flex-end;justify-content:unsafe center;content:secret">文字</div></foreignObject></svg>'
 assert.equal(svgVisibleCharacters(source),undefined)
 const {svg}=await packageSVGCPU({svg:source,fontFile:resolve(resolveRuntimeAssets().fontRoot,RUNTIME_FONT_FILE)})
 assert.equal(svgDrawingSignature(svg),svgDrawingSignature(source))
 const fonts=inspectNativeSVGResources(svg).urls.filter(url=>url.startsWith('data:font/'))
 assert.equal(fonts.length,1);assert.ok(fonts[0].startsWith('data:font/otf;'))
 assert.equal(createHash('sha256').update(Buffer.from(fonts[0].slice(fonts[0].indexOf(',')+1),'base64')).digest('hex'),RUNTIME_FONT_SHA256)
})

test('missing subset falls back to original font; altered subset fails closed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-u40-font-')),fontFile=join(root,'font.otf')
 try{
  await copyFile(resolve(resolveRuntimeAssets().fontRoot,RUNTIME_FONT_FILE),fontFile)
  const input={svg:'<svg xmlns="http://www.w3.org/2000/svg"><text>ABC</text></svg>',fontFile}
  const fallback=await packageSVGCPU(input),urls=inspectNativeSVGResources(fallback.svg).urls.filter(url=>url.startsWith('data:font/'))
  assert.equal(urls.length,1);assert.equal(createHash('sha256').update(Buffer.from(urls[0].slice(urls[0].indexOf(',')+1),'base64')).digest('hex'),RUNTIME_FONT_SHA256)
  await mkdir(join(root,'web'));await writeFile(join(root,'web',BROWSER_FONT_MANIFEST.files[0].file),'corrupt')
  await assert.rejects(packageSVGCPU(input),{code:'FONT_HASH_MISMATCH'})
 }finally{await rm(root,{recursive:true,force:true})}
})

test('worker rejects unsafe SVG and cancellation without entering artifact publication',async()=>{
 const fontFile=resolve(resolveRuntimeAssets().fontRoot,RUNTIME_FONT_FILE)
 await assert.rejects(runHeavyWork('svg-fonts',{svg:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="https://external.invalid/private"/></svg>',fontFile}),{code:'UNRESOLVED_RESOURCE'})
 await assert.rejects(runHeavyWork('svg-fonts',{svg:'<svg width="1" height="1"/>',fontFile},{signal:AbortSignal.abort()}),{code:'HEAVY_WORK_ABORTED'})
})
