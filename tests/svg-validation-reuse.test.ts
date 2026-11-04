import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import sharp from 'sharp'
import {inspectNativeSVGResources} from '../server/rendering/svg-resources'
import {inspectSVGCPU} from '../server/heavy-work/svg'
import {runHeavyWork,transferSVGProof,readVerifiedSVG} from '../server/heavy-work/runner'
import {resolveRuntimeAssets} from '../server/rendering/assets'
import {RUNTIME_FONT_FILE} from '../src/drawing/engine/runtime-assets'
import {createNativeCanvasProject} from '../src/drawing/engine/native-canvas'
import {exportSnapshotHash,prepareNativeArtifacts} from '../server/exports/artifacts'

const source='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="12"><text font-family="Arial">流程</text></svg>'
const fontFile=resolve(resolveRuntimeAssets().fontRoot,RUNTIME_FONT_FILE)
const nativeXML='<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
function oldValid(svg:string){try{inspectSVGCPU({svg});return true}catch{return false}}

test('same XML DOM returns the old dimension result, with unusual lengths falling back',()=>{
 for(const attrs of ['width="20" height="12"','viewBox="0 0 20 12"','viewBox="0 0 0 12"','width="Infinity" height="1"','width="0x20" height="1"','viewBox="0 0 0x20 1e1"','width="-0" height="1"','']){
  const svg=`<svg ${attrs}><g/></svg>`,actual=inspectNativeSVGResources(svg,{inspectDimensions:true})
  assert.equal(actual.metadataValid,oldValid(svg),attrs)
 }
 const long=`<svg width="1" height="1" viewBox="${'0 '.repeat(3000)}"/>`
 assert.equal(inspectNativeSVGResources(long,{inspectDimensions:true}).metadataValid,undefined);assert.equal(oldValid(long),true)
 assert.deepEqual(inspectNativeSVGResources('<svg/>'),{urls:[],links:[]})
})
test('unserializable heavy-work input still throws synchronously',()=>{
 assert.throws(()=>runHeavyWork('compile',{input:1n}),/BigInt/)
})

test('only a genuine fixed child result can transfer a proof; changed, proxy and accessor outputs fail closed',async()=>{
 const forged={svg:source,metadataValid:true},target={svg:source};transferSVGProof(forged,target);assert.equal(readVerifiedSVG(target),undefined)
 const packaged=await runHeavyWork<{svg:string;metadataValid?:true}>('svg-fonts',{svg:source,fontFile});assert.equal(packaged.metadataValid,true)
 const result={svg:packaged.svg};transferSVGProof(packaged,result);assert.equal(readVerifiedSVG(result),packaged.svg)
 assert.equal(readVerifiedSVG({...result}),undefined)
 const original=result.svg;result.svg='<svg/>';assert.equal(readVerifiedSVG(result),undefined);result.svg=original;assert.equal(readVerifiedSVG(result),original)
 let getter=false;Object.defineProperty(result,'svg',{get(){getter=true;return original},configurable:true});assert.equal(readVerifiedSVG(result),undefined);assert.equal(getter,false)
 const proxy=new Proxy(result,{getOwnPropertyDescriptor(){throw Error('unexpected proxy trap')}});assert.equal(readVerifiedSVG(proxy),undefined)
 const invalid=await runHeavyWork<{svg:string;metadataValid?:true}>('svg-fonts',{svg:source.replace(' width="20" height="12"',''),fontFile});assert.equal(invalid.metadataValid,undefined)
 const unverified={svg:invalid.svg};transferSVGProof(invalid,unverified);assert.equal(readVerifiedSVG(unverified),undefined)
})

test('validated output skips repeated worker, captures verified SVG, and preserves cancellation/errors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-svg-proof-'))
 try{
  const snapshot=await createNativeCanvasProject(nativeXML,{id:'fixture',title:'图形',createdAt:1,updatedAt:2})
  const job:any={id:'job',diagramId:'fixture',dataRootId:'root',revision:1,leaseToken:'lease',snapshot,snapshotSha256:exportSnapshotHash(snapshot),options:{}}
  const packaged=await runHeavyWork<{svg:string;metadataValid?:true}>('svg-fonts',{svg:source,fontFile})
  const png=await sharp({create:{width:20,height:12,channels:4,background:'#ffffff'}}).png().toBuffer()
  const rendered:any={png,svg:packaged.svg,width:20,height:12,scale:1,nativeXML,runtime:{},timings:{totalMs:1,browserStartMs:0,loadMs:0,exportMs:0},warnings:[]}
  transferSVGProof(packaged,rendered)
  await assert.rejects(prepareNativeArtifacts(root,job,rendered,Date.now(),{signal:AbortSignal.abort()}),{code:'HEAVY_WORK_ABORTED'})
  await assert.rejects(prepareNativeArtifacts(root,job,rendered,Date.now(),{signal:AbortSignal.abort(),get timeoutMs(){throw Error('must not read timeout')}}),{code:'HEAVY_WORK_ABORTED'})
  await assert.rejects(prepareNativeArtifacts(root,job,rendered,Date.now(),{timeoutMs:0}),{code:'HEAVY_WORK_INVALID'})
  const initial=snapshot.createdAt;Object.defineProperty(snapshot,'createdAt',{enumerable:true,configurable:true,get(){rendered.svg='<svg>corrupt';return initial}})
  const result=await prepareNativeArtifacts(root,job,rendered,Date.now(),{timeoutMs:1});await result.publish()
  const path=join(root,'artifacts','fixture','r1','exports','job','lease',result.manifest.files.svg.filename)
  assert.equal(await readFile(path,'utf8'),packaged.svg);assert.equal(rendered.svg,'<svg>corrupt')
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-svg-proof-'));await rm(root,{recursive:true,force:true})}
})
