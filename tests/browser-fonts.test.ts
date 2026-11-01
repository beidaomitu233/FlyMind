import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import express from 'express'
import {spawn} from 'node:child_process'
import {BROWSER_FONT_MANIFEST,browserFontCSS} from '../src/drawing/engine/browser-fonts'
import {RUNTIME_FONT_SHA256,runtimeFontCSS} from '../src/drawing/engine/runtime-assets'
import {businessLibraryConfiguration} from '../src/drawing/engine/drawio-host/library'
import {runtimeAssetsRouter,resolveRuntimeAssets,verifyBrowserFonts} from '../server/rendering/assets'

test('fixed WOFF2 supply has exact SHA/size, disjoint Unicode coverage and complete source manifest',async()=>{
 const coverage=new Set<number>();let total=0
 assert.equal(BROWSER_FONT_MANIFEST.sourceSha256,RUNTIME_FONT_SHA256)
 assert.equal(BROWSER_FONT_MANIFEST.metricsVerified,true)
 const core=await readFile(resolve('scripts/browser-font-core.txt'),'utf8');assert.ok(!core.includes('\r'),'fixed font core corpus must use LF');assert.equal(createHash('sha256').update(core).digest('hex'),BROWSER_FONT_MANIFEST.coreCorpusSha256)
 for(const file of BROWSER_FONT_MANIFEST.files){
  const bytes=await readFile(resolve('resources/fonts/web',file.file));assert.equal(bytes.length,file.bytes);assert.equal(bytes.toString('ascii',0,4),'wOF2');assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256)
  let count=0
  for(const range of file.unicodeRange.split(',')){const [start,end]=range.slice(2).split('-').map(v=>parseInt(v,16));for(let cp=start;cp<=(end??start);cp++){assert.ok(!coverage.has(cp),'overlapping font face');coverage.add(cp);count++}}
  assert.equal(count,file.characters);total+=bytes.length
 }
 assert.equal(coverage.size,44810);assert.equal(coverage.size,BROWSER_FONT_MANIFEST.characters);assert.equal(BROWSER_FONT_MANIFEST.files[0].bytes,137316);assert.ok(total<14000000)
 assert.deepEqual(await verifyBrowserFonts(resolve('resources/fonts')),{files:95,characters:44810})
})

test('only browser opt-in uses WOFF2 ranges; every face preserves OTF fallback and export default stays original',()=>{
 const css=browserFontCSS(['Noto Sans CJK SC'])
 assert.equal((css.match(/@font-face/g)||[]).length,95);assert.equal((css.match(/format\("opentype"\)/g)||[]).length,95);assert.ok(css.includes('unicode-range:'));assert.ok(css.includes('?v='+RUNTIME_FONT_SHA256))
 assert.throws(()=>browserFontCSS(['external font']))
 assert.equal(businessLibraryConfiguration().fontCss,runtimeFontCSS());assert.ok(!runtimeFontCSS().includes('woff2'));assert.equal(businessLibraryConfiguration(undefined,true).fontCss,'','native save must not eagerly embed all browser range URLs')
})

test('HTTP serves only fixed verified webfonts immutable; missing/modified bytes cannot be returned as font data',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'flymind-web-fonts-')),assets=resolveRuntimeAssets(),file=BROWSER_FONT_MANIFEST.files[0]
 await mkdir(join(temp,'web'));await writeFile(join(temp,'web',file.file),'bad')
 const app=express();app.use('/bad',runtimeAssetsRouter({...assets,fontRoot:temp}));app.use(runtimeAssetsRouter(assets));app.use((error:any,_req:any,res:any,_next:any)=>res.status(500).json({code:error.code??'ERROR'}));const server=createServer(app)
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port
 try{
  const response=await fetch(origin+'/runtime-assets/fonts/web/'+file.file+'?v='+file.sha256);assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/font\/woff2/);assert.equal(response.headers.get('cache-control'),'public, max-age=31536000, immutable');assert.equal((await response.arrayBuffer()).byteLength,file.bytes)
  assert.equal((await fetch(origin+'/runtime-assets/fonts/web/unknown.woff2')).status,404)
  const bad=await fetch(origin+'/bad/runtime-assets/fonts/web/'+file.file);assert.equal(bad.status,500);assert.equal((await bad.json()).code,'BROWSER_FONT_HASH_MISMATCH')
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(temp,{recursive:true,force:true,maxRetries:3})}
})

test('packaged setup installs all fixed shards into an independent resource cache without a font build tool',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-font-install-'))
 try{
  const result=await new Promise<{code:number|null;error:string}>((yes,no)=>{const child=spawn(process.execPath,['scripts/setup-drawio-runtime.mjs','--only-fonts','--resources-root='+root],{stdio:['ignore','ignore','pipe'],windowsHide:true,shell:false});let error='';child.stderr.on('data',b=>error=(error+b).slice(-1500));child.once('error',no);child.once('close',code=>yes({code,error}))})
  assert.equal(result.code,0,result.error);assert.deepEqual(await verifyBrowserFonts(join(root,'fonts')),{files:95,characters:44810})
  assert.equal(createHash('sha256').update(await readFile(join(root,'fonts','NotoSansCJKsc-Regular.otf'))).digest('hex'),RUNTIME_FONT_SHA256)
 }finally{await rm(root,{recursive:true,force:true,maxRetries:3})}
})
