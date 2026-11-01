import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {readFile} from 'node:fs/promises'
import {runHeavyWork} from '../server/heavy-work/runner'
import {inspectSVGCPU} from '../server/heavy-work/svg'
import {resolveRuntimeAssets} from '../server/rendering/assets'
import {RUNTIME_FONT_FILE,RUNTIME_FONT_SHA256} from '../src/drawing/engine/runtime-assets'
import {inspectNativeSVGResources} from '../server/rendering/svg-resources'

test('isolated artifact inspection validates complete XML and dimensions',async()=>{
 assert.deepEqual(await runHeavyWork('svg-metadata',{svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><text>流程</text></svg>'}),{valid:true})
 for(const svg of ['<html/>','<svg width="0" height="-1"/>','<svg width="10" height="10"><g></svg>','<!DOCTYPE svg [<!ENTITY ext SYSTEM "file:///private">]><svg width="1" height="1"/>']){
  await assert.rejects(runHeavyWork('svg-metadata',{svg}),{code:'EXPORT_RENDER_INVALID'})
 }
 assert.throws(()=>inspectSVGCPU({svg:'<svg width="10" height="10"/>'+'x'.repeat(96*1024*1024)}),{code:'OUTPUT_BUDGET'})
})

test('killable SVG packaging preserves text and embeds the exact original export font',async()=>{
 const source='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><text x="8" y="30" font-family="Noto Sans CJK SC">确认流程 → 完成</text></svg>'
 const {svg}=await runHeavyWork<{svg:string}>('svg-fonts',{svg:source,fontFile:resolve(resolveRuntimeAssets().fontRoot,RUNTIME_FONT_FILE)})
 assert.ok(svg.includes('确认流程 → 完成'));assert.ok(svg.includes('data-runtime-font="canonical"'))
 const fonts=inspectNativeSVGResources(svg).urls.filter(url=>url.startsWith('data:font/'))
 assert.equal(fonts.length,1)
 const bytes=Buffer.from(fonts[0].slice(fonts[0].indexOf(',')+1),'base64')
 assert.equal(createHash('sha256').update(bytes).digest('hex'),RUNTIME_FONT_SHA256)
 assert.ok(bytes.equals(await readFile(resolve(resolveRuntimeAssets().fontRoot,RUNTIME_FONT_FILE))))
 assert.deepEqual(await runHeavyWork('svg-metadata',{svg}),{valid:true})
})

test('worker rejects unsafe SVG and cancellation without entering artifact publication',async()=>{
 const fontFile=resolve(resolveRuntimeAssets().fontRoot,RUNTIME_FONT_FILE)
 await assert.rejects(runHeavyWork('svg-fonts',{svg:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="https://external.invalid/private"/></svg>',fontFile}),{code:'UNRESOLVED_RESOURCE'})
 await assert.rejects(runHeavyWork('svg-fonts',{svg:'<svg width="1" height="1"/>',fontFile},{signal:AbortSignal.abort()}),{code:'HEAVY_WORK_ABORTED'})
})
