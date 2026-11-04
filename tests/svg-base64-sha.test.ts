import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {sha256Base64} from '../server/rendering/base64-sha'
import {packageNativeSVGResourceFonts} from '../server/rendering/svg-fonts'
import {BROWSER_FONT_MANIFEST} from '../src/drawing/engine/browser-font-manifest'

const oldHash=(value:string)=>createHash('sha256').update(Buffer.from(value,'base64')).digest('hex')

test('canonical base64 SHA matches full decode at padding and chunk boundaries',()=>{
 for(const size of [0,1,2,3,4,49150,49151,49152,49153,49154,98305]){
  const bytes=Buffer.alloc(size);for(let i=0;i<size;i++)bytes[i]=(i*79+31)%256
  const value=bytes.toString('base64')
  assert.equal(sha256Base64(value),oldHash(value),`bytes=${size}`)
 }
})

test('permissive noncanonical base64 remains identical to Buffer.from',()=>{
 const values=['','YQ','YQ=','YQ===','YR==','YWJ=','YW=Jj','YWJj=', 'YW Jj\nZA==','-_8=','+/8=','Y!W@J#j','💡YWJj','a','====','AA==garbage','A'.repeat(65535)+'!AAAA','A'.repeat(65536)+' Zg==']
 let state=0x12345678
 const alphabet='AZaz09+/=_-!? \n\t中'
 for(let i=0;i<200;i++){let value='';for(let j=0;j<i;j++){state=(Math.imul(state,1664525)+1013904223)>>>0;value+=alphabet[state%alphabet.length]}values.push(value)}
 for(const value of values)assert.equal(sha256Base64(value),oldHash(value),JSON.stringify(value.slice(-32)))
})

test('font SHA validation still rejects untrusted embedded resources and bad supply',async()=>{
 const file=BROWSER_FONT_MANIFEST.files[0],bytes=await readFile(new URL(`../resources/fonts/web/${file.file}`,import.meta.url)),fonts=[{bytes,sha256:file.sha256,format:'woff2' as const,unicodeRange:file.unicodeRange}]
 const source=(body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">${body}</svg>`
 const packaged=packageNativeSVGResourceFonts(source('<text>ABC</text>'),fonts)
 assert.ok(packaged.includes('data:font/woff2;base64,'))
 for(const body of ['<image href="data:font/otf;base64,YmFk"/>','<rect fill="url(data:font/otf;base64,Y m F k)"/>'])assert.throws(()=>packageNativeSVGResourceFonts(source(body),fonts),{code:'FONT_NOT_EMBEDDED'})
 assert.throws(()=>packageNativeSVGResourceFonts(source('<image href="https://external.invalid/x"/>'),fonts),{code:'UNRESOLVED_RESOURCE'})
 assert.throws(()=>packageNativeSVGResourceFonts(source('<text>A</text>'),[{...fonts[0],bytes:Buffer.from('bad')}]),{code:'FONT_HASH_MISMATCH'})
})
