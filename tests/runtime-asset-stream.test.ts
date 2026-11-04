import {test} from 'node:test'
import assert from 'node:assert/strict'
import {constants,createReadStream} from 'node:fs'
import {copyFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {checkRuntimeAssets,resolveRuntimeAssets,streamAssetSHA256,streamContainsUTF8,verifyBrowserFontStream} from '../server/rendering/assets'
import {DRAWIO_VERSION} from '../src/drawing/engine/constants'
import {RUNTIME_FONT_FILE,RUNTIME_FONT_SHA256} from '../src/drawing/engine/runtime-assets'

async function* chunks(bytes:Buffer,size:number){for(let offset=0;offset<bytes.length;offset+=size)yield bytes.subarray(offset,offset+size)}
test('UTF-8 scan matches whole-string semantics over all byte boundaries',async()=>{
 const input=Buffer.concat([Buffer.from('图𠮷 EditorUi.VERSION="31.5.3" 尾'),Buffer.from([0xff,0xe4,0xb8])])
 for(let size=1;size<=input.length+1;size++)for(const needle of ['','图𠮷','EditorUi.VERSION="31.5.3"','尾�','not present'])assert.equal(await streamContainsUTF8(chunks(input,size),needle),input.toString('utf8').includes(needle))
})
test('matching early does not hide errors later in the stream',async()=>{
 const failure=Error('late input failure');let readAfterMatch=false
 async function* late(){yield Buffer.from('MATCH');readAfterMatch=true;throw failure}
 await assert.rejects(streamContainsUTF8(late(),'MATCH'),failure);assert.equal(readAfterMatch,true)
 await assert.rejects(streamAssetSHA256(late()),failure)
})
test('chunked SHA is exact for empty, binary and real fixed font',async()=>{
 for(const bytes of [Buffer.alloc(0),Buffer.from([0,255,0,1,254]),Buffer.from('𠮷字体')])for(const size of [1,2,7])assert.equal(await streamAssetSHA256(chunks(bytes,size)),createHash('sha256').update(bytes).digest('hex'))
 const assets=resolveRuntimeAssets();assert.equal(await streamAssetSHA256(createReadStream(resolve(assets.fontRoot,RUNTIME_FONT_FILE))),RUNTIME_FONT_SHA256)
 assert.equal(await streamContainsUTF8(createReadStream(resolve(assets.drawioRoot,'js/app.min.js')),`EditorUi.VERSION="${DRAWIO_VERSION}"`),true)
})
test('asset validation preserves missing/version/font/license errors with split version text',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-asset-stream-')),assets=resolveRuntimeAssets(root),actual=resolveRuntimeAssets()
 try{
  await assert.rejects(checkRuntimeAssets(assets),{code:'DRAWIO_MISSING'})
  await mkdir(join(assets.drawioRoot,'js'),{recursive:true});await mkdir(assets.fontRoot,{recursive:true});await mkdir(resolve(assets.browserExecutable,'..'),{recursive:true})
  await writeFile(join(assets.drawioRoot,'js/app.min.js'),'wrong');await writeFile(join(assets.fontRoot,RUNTIME_FONT_FILE),'wrong');await writeFile(join(assets.fontRoot,'OFL.txt'),'wrong');await writeFile(assets.browserExecutable,'fixture')
  await assert.rejects(checkRuntimeAssets(assets),{code:'DRAWIO_VERSION_MISMATCH'})
  await writeFile(join(assets.drawioRoot,'js/app.min.js'),'x'.repeat(65530)+`EditorUi.VERSION="${DRAWIO_VERSION}"`+'tail')
  await assert.rejects(checkRuntimeAssets(assets),{code:'FONT_HASH_MISMATCH'})
  await copyFile(resolve(actual.fontRoot,RUNTIME_FONT_FILE),resolve(assets.fontRoot,RUNTIME_FONT_FILE))
  await assert.rejects(checkRuntimeAssets(assets),{code:'FONT_LICENSE_HASH_MISMATCH'})
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-asset-stream-'));await rm(root,{recursive:true,force:true})}
})

test('WOFF2 preflight handles short reads and checks through EOF using a bounded buffer',async()=>{
 const data=Buffer.alloc(150000,0xa5),file={file:'font.woff2',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}
 let position=0,reads=0,closed=0,flags=0,maxRequest=0
 const openFont=async(_path:string,value:number)=>{flags=value;return {
  async stat(){return {isFile:()=>true,size:data.length}},
  async read(buffer:Buffer,offset:number,length:number,at:null){assert.equal(at,null);reads++;maxRequest=Math.max(maxRequest,length);const size=Math.min(7000,length,data.length-position);data.copy(buffer,offset,position,position+size);position+=size;return {bytesRead:size}},
  async close(){closed++}
 }}
 await verifyBrowserFontStream('isolated',file,openFont)
 assert.equal(maxRequest,65536);assert.ok(reads>2);assert.equal(position,data.length);assert.equal(closed,1);assert.equal(flags,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
})

test('WOFF2 preflight rejects truncation, growth, mutation and late I/O errors, then closes',async()=>{
 const expected=Buffer.from('fixed content'),file={file:'font.woff2',bytes:expected.length,sha256:createHash('sha256').update(expected).digest('hex')}
 for(const mode of ['short','growth','mutation','late-error','stat-error','not-file'] as const){
  const data=mode==='short'?expected.subarray(0,-1):mode==='growth'?Buffer.concat([expected,Buffer.from('!')]):mode==='mutation'?Buffer.from('Fixed content'):expected
  let pos=0,closed=0,reads=0
  const openFont=async()=>({
   async stat(){if(mode==='stat-error')throw Error('stat error');return {isFile:()=>mode!=='not-file',size:expected.length}},
   async read(buffer:Buffer,offset:number,length:number){reads++;if(mode==='late-error'&&pos===data.length)throw Error('late read error');const count=Math.min(length,data.length-pos);data.copy(buffer,offset,pos,pos+count);pos+=count;return {bytesRead:count}},
   async close(){closed++}
  })
  await assert.rejects(verifyBrowserFontStream('isolated',file,openFont),{code:'BROWSER_FONT_HASH_MISMATCH'},mode)
  assert.equal(closed,1,mode);if(mode==='late-error')assert.ok(reads>=2,mode);if(mode==='growth')assert.ok(pos>expected.length,mode)
 }
})

test('WOFF2 preflight pins the opened file while subsequent checks observe replacement',async()=>{
 const data=Buffer.from('fixed original'),file={file:'font.woff2',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}
 let pathContents=data,closed=0
 const replacing=async()=>{const opened=pathContents;pathContents=Buffer.from('changed bytes!');let position=0;return {
  async stat(){return {isFile:()=>true,size:opened.length}},
  async read(buffer:Buffer,offset:number,length:number){const size=Math.min(length,opened.length-position);opened.copy(buffer,offset,position,position+size);position+=size;return {bytesRead:size}},
  async close(){closed++}
 }}
 await verifyBrowserFontStream('isolated',file,replacing)
 await assert.rejects(verifyBrowserFontStream('isolated',file,replacing),{code:'BROWSER_FONT_HASH_MISMATCH'});assert.equal(closed,2)
})

test('WOFF2 preflight bounds a continuously growing stream and rejects empty buffers',async()=>{
 let reads=0,closed=0;const file={file:'font.woff2',bytes:3,sha256:'0'.repeat(64)}
 const openFont=async()=>({async stat(){return {isFile:()=>true,size:3}},async read(buffer:Buffer){reads++;buffer[0]=97;return {bytesRead:1}},async close(){closed++}})
 await assert.rejects(verifyBrowserFontStream('isolated',file,openFont),{code:'BROWSER_FONT_HASH_MISMATCH'});assert.equal(reads,4);assert.equal(closed,1)
 await assert.rejects(verifyBrowserFontStream('isolated',file,openFont,Buffer.alloc(0)),{code:'BROWSER_FONT_HASH_MISMATCH'});assert.equal(reads,4);assert.equal(closed,1)
})

test('WOFF2 preflight retains close-error precedence and closes after fstat mismatch',async()=>{
 let closed=0;const closeError=Error('close failure'),file={file:'font.woff2',bytes:3,sha256:'0'.repeat(64)}
 const openFont=async()=>({async stat(){return {isFile:()=>true,size:2}},async read(){throw Error('unexpected read')},async close(){closed++;throw closeError}})
 await assert.rejects(verifyBrowserFontStream('isolated',file,openFont),error=>error===closeError);assert.equal(closed,1)
})
