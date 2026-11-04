import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readBoundedInlineBytes} from '../server/mcp-native/inline-bytes'
const failure=(bytes:number)=>Object.assign(new Error('over budget'),{code:'LIMIT',bytes})

test('inline bytes preserve complete under-budget chunks',async()=>{
 const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(Buffer.from('中文'));c.enqueue(Buffer.from('abc'));c.close()}})
 assert.equal((await readBoundedInlineBytes(new Response(body),16,failure)).toString(),'中文abc')
})

test('known oversized length cancels before assembling its body',async()=>{
 let cancelled=false
 const response=new Response(new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(16))},cancel(){cancelled=true}}),{headers:{'Content-Length':'999999999'}})
 await assert.rejects(readBoundedInlineBytes(response,1024,failure),{code:'LIMIT',bytes:999999999})
 assert.equal(cancelled,true);assert.equal(response.body!.locked,false)
})

test('missing or false length cannot cause an unbounded stream allocation',async()=>{
 for(const headers of [{},{'Content-Length':'1'}]){
  let pulls=0,cancelled=false
  const response=new Response(new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array(4096))},cancel(){cancelled=true}}),{headers})
  await assert.rejects(readBoundedInlineBytes(response,6000,failure),{code:'LIMIT',bytes:8192})
  assert.equal(cancelled,true);assert.ok(pulls<=3);assert.equal(response.body!.locked,false)
 }
})

test('transport errors release the reader instead of returning partial bytes',async()=>{
 const response=new Response(new ReadableStream<Uint8Array>({pull(c){c.error(new Error('stream failed'))}}))
 await assert.rejects(readBoundedInlineBytes(response,100,failure),/stream failed/)
 assert.equal(response.body!.locked,false)
})

test('an unresponsive stream cancellation cannot keep an oversized request hanging',async()=>{
 let cancelled=false
 const response=new Response(new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(4096))},cancel(){cancelled=true;return new Promise<void>(()=>{})}}))
 const result=readBoundedInlineBytes(response,1000,failure)
 await assert.rejects(Promise.race([result,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('cancellation blocked')),500))]),{code:'LIMIT'})
 assert.equal(cancelled,true);assert.equal(response.body!.locked,false)
})
