import {test} from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {CloudCollaborationRooms} from '../server/cloud/collaboration'

class ResponseStub extends EventEmitter{
 destroyed=false;writableEnded=false;writableLength=0;frames:string[]=[]
 status(){return this}set(){return this}flushHeaders(){}
 write(frame:string){this.frames.push(frame);return true}
 end(){this.writableEnded=true}
 event(){const frame=this.frames.at(-1)!;return {type:/event: ([^\n]+)/.exec(frame)![1],data:JSON.parse(/data: ([^\n]+)/.exec(frame)![1])}}
}
const xml=(label:string)=>`<mxfile><diagram id="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" parent="1" vertex="1" value="${label}"/></root></mxGraphModel></diagram></mxfile>`
const record=(revision:number,value:string,group='one')=>({revision,workspaceGroupId:group,document:{rendering:{engine:{xml:value}}},largeUnusedPayload:{value:'irrelevant'}})
const principal={user:{id:'u'},session:{id:'s'},team:{id:'t'}}
function setup(){
 const rooms=new CloudCollaborationRooms({} as any,{intervalMs:30000}),peers=()=>[...(rooms as any).peers] as any[]
 async function connect(data:{team?:string;id?:string;root?:string;record:any;since?:number;history?:()=>Promise<any>}){
  const response=new ResponseStub(),workspace={diagrams:{getDrawing:async()=>data.record},store:{getNativeDrawingRevision:data.history??(async()=>data.record)}}
  await rooms.connect({team:data.team??'t',id:data.id??'d',root:data.root??'r',token:'token',principal,workspace,response,since:data.since} as any)
  return {response,peer:peers().find(p=>p.response===response)}
 }
 return {rooms,peers,connect}
}

test('equal XML shares only compact state while snapshots retain current metadata',async()=>{
 const s=setup();try{
  const a=await s.connect({record:record(1,xml('a'),'first')})
  const b=await s.connect({record:record(1,xml('a'),'second')})
  assert.strictEqual(a.peer.last,b.peer.last)
  assert.deepEqual(Object.keys(a.peer.last).sort(),['revision','xml'])
  assert.equal(a.response.event().data.record.workspaceGroupId,'first')
  assert.equal(b.response.event().data.record.workspaceGroupId,'second')
  assert.equal('workspace' in a.peer,false);assert.equal('principal' in a.peer,false)
  ;(s.rooms as any).sendRecord(a.peer,record(2,xml('b'),'new'))
  ;(s.rooms as any).sendRecord(b.peer,record(2,xml('b'),'other'))
  assert.strictEqual(a.peer.last,b.peer.last)
  assert.equal(a.response.event().type,'revision');assert.equal(b.response.event().data.fromRevision,1)
  assert.equal(b.response.event().data.record.workspaceGroupId,'other')
 }finally{s.rooms.close()}
})

test('sharing requires matching team, drawing, root, revision and exact XML',async()=>{
 const s=setup();try{
  const a=await s.connect({record:record(1,xml('a'))})
  for(const options of [{team:'other'},{id:'other'},{root:'other'},{record:record(2,xml('a'))},{record:record(1,xml('b'))}]){
   const b=await s.connect({record:record(1,xml('a')),...options});assert.notStrictEqual(a.peer.last,b.peer.last)
  }
 }finally{s.rooms.close()}
})

test('since shares historical state and sends the requested patch before advancing',async()=>{
 const s=setup();try{
  const a=await s.connect({record:record(1,xml('old'))})
  const original=(s.rooms as any).sendRecord;let prior:any
  ;(s.rooms as any).sendRecord=function(peer:any,...args:any[]){prior=peer.last;return original.call(this,peer,...args)}
  const b=await s.connect({record:record(2,xml('new')),since:1,history:async()=>record(1,xml('old'))})
  assert.strictEqual(prior,a.peer.last);assert.equal(b.response.event().type,'revision')
  assert.equal(b.response.event().data.fromRevision,1);assert.equal(b.response.event().data.revision,2)
  assert.notStrictEqual(b.peer.last,a.peer.last)
 }finally{s.rooms.close()}
})

test('disconnect releases compact state even while historical lookup is pending',async()=>{
 const s=setup();let resolveHistory!:(value:any)=>void
 try{
  const a=await s.connect({record:record(1,xml('old'))}),shared=a.peer.last
  const b=await s.connect({record:record(1,xml('old'))});assert.strictEqual(shared,b.peer.last)
  a.response.emit('close');assert.equal(a.peer.last,undefined);assert.ok(!s.peers().includes(a.peer))
  b.response.emit('close');assert.equal(b.peer.last,undefined)
  const c=await s.connect({record:record(1,xml('old'))});assert.notStrictEqual(c.peer.last,shared)
  const pending=s.connect({record:record(2,xml('new')),since:1,history:()=>new Promise(resolve=>{resolveHistory=resolve})})
  await Promise.resolve();await Promise.resolve()
  const waiting=s.peers().find(p=>p!==c.peer);assert.ok(waiting)
  waiting.response.emit('close');resolveHistory(record(1,xml('old')));await pending
  assert.equal(waiting.last,undefined);assert.ok(!s.peers().includes(waiting))
 }finally{s.rooms.close()}
})
