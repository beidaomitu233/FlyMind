import {test} from 'node:test'
import assert from 'node:assert/strict'
import {HeavyWorkRunner,svgInputJSONBytes} from '../server/heavy-work/runner'

const exact=(value:unknown)=>Buffer.byteLength(JSON.stringify(value))

test('plain SVG inputs match JSON UTF-8 bytes including chunk edges and surrogate cases',()=>{
 const samples=['','ascii','中文𠮷😀','"\\/\b\f\n\r\t\u0000\u001f','\ud800','\udc00','\ud800\ud800\udc00','\udc00\ud800','\u2028\u2029',
  'x'.repeat(65535)+'𠮷', 'x'.repeat(65535)+'\ud800\ud800\udc00', 'x'.repeat(65535)+'\udc00\ud800\udc00']
 let seed=0x12345678
 for(let i=0;i<100;i++){let s='';for(let j=0;j<127;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;s+=String.fromCharCode(seed&0xffff)}samples.push(s)}
 for(const svg of samples){
  for(const input of [{svg},{svg,fontFile:'C:\\字体\\x.otf'},{fontFile:'é𠮷',svg}]){
   const operation='fontFile'in input?'svg-fonts':'svg-metadata'
   assert.equal(svgInputJSONBytes(operation,input),exact(input))
  }
 }
})

test('only ordinary exact data records use the fast path; getters, proxies and toJSON retain original behavior',async()=>{
 const runner=new HeavyWorkRunner({availableMemory:async()=>1}),error=Error('getter executed');let calls=0
 const getter={get svg():string{calls++;throw error}}
 assert.equal(svgInputJSONBytes('svg-metadata',getter),undefined);assert.equal(calls,0)
 assert.throws(()=>runner.run('svg-metadata',getter),error);assert.equal(calls,1)
 const value={svg:'x',toJSON(){calls++;return {svg:'valid'}}}
 assert.equal(svgInputJSONBytes('svg-metadata',value),undefined);await assert.rejects(runner.run('svg-metadata',value),{code:'HEAVY_WORK_MEMORY_LOW'});assert.equal(calls,2)
 const log:string[]=[],proxy=new Proxy({svg:'x'},{get(target,key,receiver){log.push('get:'+String(key));return Reflect.get(target,key,receiver)},ownKeys(target){log.push('keys');return Reflect.ownKeys(target)}})
 assert.equal(svgInputJSONBytes('svg-metadata',proxy),undefined);assert.deepEqual(log,[])
 const expectedLog:string[]=[],reference=new Proxy({svg:'x'},{get(target,key,receiver){expectedLog.push('get:'+String(key));return Reflect.get(target,key,receiver)},ownKeys(target){expectedLog.push('keys');return Reflect.ownKeys(target)}})
 JSON.stringify(reference);await assert.rejects(runner.run('svg-metadata',proxy),{code:'HEAVY_WORK_MEMORY_LOW'});assert.deepEqual(log,expectedLog)
 const cyclic:any={svg:'x'};cyclic.extra=cyclic
 for(const input of [{svg:1n},cyclic])assert.throws(()=>runner.run('svg-metadata',input),TypeError)
 for(const input of [{svg:'x',extra:'y'},{svg:'x',fontFile:'x',extra:1},Object.create(null,{svg:{value:'x',enumerable:true}}),{svg:1},{svg:'x',[Symbol('s')]:1},Object.defineProperty({svg:'x'},'hidden',{value:1})])assert.equal(svgInputJSONBytes('svg-metadata',input),undefined)
 assert.equal(svgInputJSONBytes('compile',{svg:'x'}),undefined)
 const inherited=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON')
 try{Object.defineProperty(Object.prototype,'toJSON',{value(){return 'changed'},configurable:true});assert.equal(svgInputJSONBytes('svg-metadata',{svg:'x'}),undefined)}finally{if(inherited)Object.defineProperty(Object.prototype,'toJSON',inherited);else delete (Object.prototype as any).toJSON}
 await runner.close()
})

test('actual 96 MiB JSON boundary remains inclusive without serializing another full copy',async()=>{
 const limit=96*1024*1024,svg='a'.repeat(limit-10),runner=new HeavyWorkRunner({availableMemory:async()=>1})
 assert.equal(svgInputJSONBytes('svg-metadata',{svg}),limit)
 await assert.rejects(runner.run('svg-metadata',{svg}),{code:'HEAVY_WORK_MEMORY_LOW'})
 await assert.rejects(runner.run('svg-metadata',{svg:svg+'a'}),{code:'HEAVY_WORK_INPUT_LIMIT'})
 await runner.close()
})
