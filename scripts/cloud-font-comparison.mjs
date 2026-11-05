// Linux candidate gate: independent short processes render each fixed model
// serially, with default full OTF and compact WOFF2 budgets respectively.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

if(process.platform!=='linux')throw Error('Linux font comparison is required')
const kinds=['swimlane','flowchart','architecture','mindmap','dataflow','technical'],args=process.argv.slice(2)
const digest=value=>createHash('sha256').update(value).digest('hex')

if(args[0]==='--child'){
 const [,kind,mode,directory,...extra]=args
 if(extra.length||!kinds.includes(kind)||!['full','selected'].includes(mode)||!directory||!resolve(directory).startsWith(resolve(tmpdir())+sep))throw Error('Invalid comparison child')
 assert.equal(process.env.FLYMIND_MEMORY_PROFILE,mode==='selected'?'compact-1g':undefined)
 const [{NativeDrawioRenderer},{compactFontSubset},{parseNative},{compileDrawio},{createDrawingProject},{sampleFor},{extractContent},{svgDrawingSignature},{drawioRenderSignature},{HEAVY_MEMORY_PROFILE}]=await Promise.all([
  import('../lib/server/rendering/renderer.js'),import('../lib/server/rendering/compact-fonts.js'),import('../lib/src/drawing/engine/drawio/xml.js'),import('../lib/src/drawing/engine/drawio/index.js'),import('../lib/src/drawing/engine/project.js'),import('../lib/src/drawing/core/samples.js'),import('../lib/src/drawing/core/layers.js'),import('../lib/server/rendering/svg-fonts.js'),import('../lib/src/drawing/engine/drawio/index.js'),import('../lib/server/heavy-work/memory-profile.js')
 ])
 assert.equal(HEAVY_MEMORY_PROFILE.svgHeapMiB,mode==='selected'?160:256)
 assert.equal(HEAVY_MEMORY_PROFILE.svgRssBytes,(mode==='selected'?256:384)*1024*1024)
 const content={...extractContent(sampleFor(kind)),id:'font-comparison-'+kind},compiled=await compileDrawio(content)
 assert.ok(compactFontSubset(compiled.xml,parseNative(compiled.xml)),'Sample must exercise compact path: '+kind)
 const project=await createDrawingProject(content,compiled,{createdAt:1,updatedAt:1}),renderer=new NativeDrawioRenderer()
 let result
 try{result=await renderer.render(project,{scale:1,background:'white'})}finally{await renderer.close()}
 const report={kind,mode,projectSHA256:digest(JSON.stringify(project)),sourceXMLSHA256:digest(project.rendering.engine.xml),nativeXMLSHA256:digest(result.nativeXML),nativeXMLSignatureSHA256:digest(drawioRenderSignature(result.nativeXML)),nativeSVGSignature:svgDrawingSignature(result.nativeSVG),width:result.width,height:result.height,scale:result.scale,svgHeapMiB:HEAVY_MEMORY_PROFILE.svgHeapMiB,svgRssBytes:HEAVY_MEMORY_PROFILE.svgRssBytes}
 await writeFile(join(directory,kind+'-'+mode+'.png'),result.png,{flag:'wx',mode:0o600})
 await writeFile(join(directory,kind+'-'+mode+'.json'),JSON.stringify(report),{flag:'wx',mode:0o600})
}else{
 if(args.length)throw Error('Invalid comparison arguments')
 const {default:sharp}=await import('sharp'),{drawioCapabilities}=await import('../lib/src/drawing/engine/profiles.js')
 assert.deepEqual(drawioCapabilities().supportedKinds,kinds)
 const directory=await mkdtemp(join(tmpdir(),'flymind-font-comparison-')),cases=[]
 try{
  for(const kind of kinds){
   for(const mode of ['full','selected']){
    const env={...process.env};delete env.FLYMIND_MEMORY_PROFILE;if(mode==='selected')env.FLYMIND_MEMORY_PROFILE='compact-1g'
    const status=await new Promise((yes,no)=>{const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',kind,mode,directory],{env,stdio:'inherit',windowsHide:true});child.once('error',no);child.once('close',(code,signal)=>yes({code,signal}))})
    assert.deepEqual(status,{code:0,signal:null},kind+' '+mode+' render failed')
   }
   const full=JSON.parse(await readFile(join(directory,kind+'-full.json'),'utf8')),selected=JSON.parse(await readFile(join(directory,kind+'-selected.json'),'utf8'))
   for(const field of ['kind','projectSHA256','sourceXMLSHA256','nativeXMLSignatureSHA256','nativeSVGSignature','width','height','scale'])assert.deepEqual(selected[field],full[field],kind+' '+field)
   const a=await sharp(join(directory,kind+'-full.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(join(directory,kind+'-selected.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true})
   assert.equal(a.info.width,b.info.width,kind);assert.equal(a.info.height,b.info.height,kind);assert.equal(a.info.channels,4);assert.equal(b.info.channels,4);assert.ok(a.data.equals(b.data),kind+' PNG RGBA changed')
   cases.push(kind)
  }
 }finally{assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
 console.log(JSON.stringify({ok:true,comparison:'default full OTF vs compact selected WOFF2; exact PNG RGBA and native drawing signatures',cases}))
}
