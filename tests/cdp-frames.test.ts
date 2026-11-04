import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCDPFrameDecoder} from '../server/rendering/cdp-frames'
import {NativeRenderError} from '../server/rendering/types'

function oldDecoder(deliver:(message:object)=>void,limit:number){
 let buffered=Buffer.alloc(0)
 return (chunk:Buffer)=>{
  buffered=Buffer.concat([buffered,chunk]);if(buffered.length>limit)throw new NativeRenderError('BROWSER_PROTOCOL_FAILED','CDP frame budget exceeded')
  let end:number
  while((end=buffered.indexOf(0))!==-1){const frame=buffered.subarray(0,end);buffered=buffered.subarray(end+1);if(!frame.length)continue
   try{const message:unknown=JSON.parse(frame.toString('utf8'));if(!message||typeof message!=='object'||Array.isArray(message))throw Error();deliver(message)}catch{throw new NativeRenderError('BROWSER_PROTOCOL_FAILED','Invalid private CDP frame')}
  }
 }
}
function outcome(factory:typeof oldDecoder,chunks:Buffer[],limit=1024*1024){
 const messages:object[]=[],decode=factory(value=>messages.push(value),limit);let failure:{code?:string;message?:string}|undefined
 for(const chunk of chunks)try{decode(chunk)}catch(error){const e=error as {code?:string;message?:string};failure={code:e.code,message:e.message};break}
 return {messages,failure}
}

test('fragmented UTF-8, empty frames and multiple messages match the former transport',()=>{
 const frames=[{id:1,text:'中文𠮷😀\\n'}, {id:2,object:{items:[1,true,null],empty:''}}, {id:3,value:'x'.repeat(70000)}]
 const bytes=Buffer.concat([Buffer.from('\0'+frames.map(JSON.stringify).join('\0')+'\0\0'),Buffer.from('{"partial":')])
 for(const width of [1,2,3,7,8191,65535,131072]){const chunks=[];for(let i=0;i<bytes.length;i+=width)chunks.push(bytes.subarray(i,i+width));assert.deepEqual(outcome(createCDPFrameDecoder,chunks),outcome(oldDecoder,chunks),`chunk ${width}`)}
})

test('malformed input, non-object JSON, callback failure and pre-parse budget match',()=>{
 for(const chunks of [
  [Buffer.from('{bad}\0')],[Buffer.from('null\0')],[Buffer.from('[1]\0')],[Buffer.from('false\0')],
  [Buffer.from('{}\0'),Buffer.from('{"bad":\xff}\0','binary')],
  [Buffer.from('{}\0{}\0{}\0')], [Buffer.from('{"x"'),Buffer.from(':1}\0')]
 ])for(const limit of [5,8,100])assert.deepEqual(outcome(createCDPFrameDecoder,chunks,limit),outcome(oldDecoder,chunks,limit))
 for(const factory of [createCDPFrameDecoder,oldDecoder]){const decode=factory(()=>{throw Error('consumer failure')},100);assert.throws(()=>decode(Buffer.from('{}\0')),{code:'BROWSER_PROTOCOL_FAILED',message:'BROWSER_PROTOCOL_FAILED: Invalid private CDP frame'})}
})

test('reentrant delivery sees already-buffered messages before newly supplied bytes',()=>{
 function run(factory:typeof oldDecoder){const ids:number[]=[],inner=Buffer.from('{"id":3}\0');let decode:(chunk:Buffer)=>void
  decode=factory(value=>{const id=(value as {id:number}).id;ids.push(id);if(id===1)decode(inner)},100)
  decode(Buffer.from('{"id":1}\0{"id":2}\0'));return ids
 }
 assert.deepEqual(run(createCDPFrameDecoder),run(oldDecoder));assert.deepEqual(run(createCDPFrameDecoder),[1,2,3])
})

test('single-byte fragments use bounded slabs rather than retaining a buffer per chunk',()=>{
 const payload=Buffer.from('{"value":"'+'a'.repeat(140000)+'"}\0'),expected=Math.ceil(payload.length/(64*1024))+1
 const original=Buffer.allocUnsafe;let allocations=0,received=0
 try{Buffer.allocUnsafe=((size:number)=>{allocations++;return original(size)}) as typeof Buffer.allocUnsafe
  const decode=createCDPFrameDecoder(()=>received++,payload.length+1)
  for(let i=0;i<payload.length;i++)decode(payload.subarray(i,i+1))
  assert.equal(received,1);assert.ok(allocations<=expected,`allocated ${allocations} buffers, expected <= ${expected}`)
 }finally{Buffer.allocUnsafe=original}
})

test('small sequential messages reuse their slab without reusing delivered frames',()=>{
 const original=Buffer.allocUnsafe;let slabAllocations=0
 try{Buffer.allocUnsafe=((size:number)=>{if(size===65536)slabAllocations++;return original(size)}) as typeof Buffer.allocUnsafe
  const messages:object[]=[],decode=createCDPFrameDecoder(value=>messages.push(value))
  for(let i=0;i<100;i++)decode(Buffer.from(JSON.stringify({id:i})+'\0'))
  assert.equal(slabAllocations,1);assert.deepEqual(messages,Array.from({length:100},(_,id)=>({id})))
 }finally{Buffer.allocUnsafe=original}
})
