import {test} from 'node:test'
import assert from 'node:assert/strict'
import {NativeDiagramService} from '../server/application/native-diagrams'

function harness(count:number,convert:(record:{id:number})=>Promise<unknown>){
 const service=Object.create(NativeDiagramService.prototype) as any
 service.available=()=>{}
 service.store={listStored:async()=>Array.from({length:count},(_,id)=>({id}))}
 service.synchronizedRecord=convert
 return service as NativeDiagramService
}

test('listRecords validates a bounded number in parallel and preserves list order',async()=>{
 let active=0,peak=0
 const service=harness(12,async record=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,(12-record.id)%3));active--;return {id:record.id}})
 assert.deepEqual(await service.listRecords(),Array.from({length:12},(_,id)=>({id})))
 assert.equal(peak,2);assert.equal(active,0)
})

test('listRecords stops scheduling when validation fails and preserves the error',async()=>{
 const visited:number[]=[],problem=new Error('invalid project'),service=harness(8,async record=>{
  visited.push(record.id)
  if(record.id===0)throw problem
  await new Promise(resolve=>setTimeout(resolve,5));return record
 })
 await assert.rejects(service.listRecords(),error=>error===problem)
 await new Promise(resolve=>setTimeout(resolve,10))
 assert.ok(visited.length<=2)
})

test('empty lists do not invoke validation',async()=>{
 const service=harness(0,async()=>{throw Error('unexpected validation')})
 assert.deepEqual(await service.listRecords(),[])
})

test('a failure releases unscheduled source references without waiting for another validation',async()=>{
 let release!:()=>void;const waiting=new Promise<void>(resolve=>release=resolve)
 const records=Array.from({length:10},(_,id)=>({id,payload:'x'.repeat(1000)})),service=Object.create(NativeDiagramService.prototype) as any
 service.available=()=>{};service.store={listStored:async()=>records}
 service.synchronizedRecord=async(record:{id:number})=>{if(record.id===0){await Promise.resolve();throw Error('broken')}await waiting;return record}
 try{await assert.rejects(service.listRecords(),/broken/);assert.ok(records.every(record=>record===undefined))}finally{release()}
})

test('bounded work reports the first started failure rather than starting later invalid records',async()=>{
 const visited:number[]=[],service=harness(3,async record=>{visited.push(record.id);if(record.id===2)throw Error('third');await new Promise(resolve=>setTimeout(resolve,record.id===0?2:10));throw Error('first started')})
 await assert.rejects(service.listRecords(),/first started/);assert.deepEqual(visited,[0,1])
})
