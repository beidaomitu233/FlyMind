import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compileDrawio,projectDrawio,patchDrawio} from '../src/drawing/engine/drawio'
import {createDrawingProject} from '../src/drawing/engine/project'
import {attr,children,parseNative,serialize,type NativeDocument} from '../src/drawing/engine/drawio/xml'
import {mainEntry,mainEntries,businessType,geometry,styleValue,cellSignature,setStyle,setBox} from '../src/drawing/engine/drawio/state'
import {absoluteRouteBox,inspectNativeLayout,routeNativeEdges,type RoutePoint} from '../src/drawing/engine/drawio/routing'
import {isOuterReturn,assertOuterSeparation} from '../src/drawing/engine/drawio/return-routing'
import {outerReturnContent} from './fixtures/drawing-quality/outer-return'

export function returnEvidence(n:NativeDocument,horizontal:boolean){
 const vertices=[...n.cells.values()].filter(e=>attr(e.cell,'vertex')==='1'&&attr(e.object,'fmControlled')!=='1').map(e=>absoluteRouteBox(n,e)),boundary=Math.max(...vertices.map(b=>horizontal?b.y+b.h:b.x+b.w))
 return ['feedback','unmarked'].map(id=>{
  const e=mainEntry(n,'edge',id),g=geometry(e),s=absoluteRouteBox(n,n.cells.get(attr(e.cell,'source')!)!),t=absoluteRouteBox(n,n.cells.get(attr(e.cell,'target')!)!),origin=n.cells.get(attr(e.cell,'parent')!),p=attr(e.cell,'parent')==='1'?{x:0,y:0}:absoluteRouteBox(n,origin)
  const points:RoutePoint[]=[{x:s.x+Number(styleValue(e,'exitX'))*s.w,y:s.y+Number(styleValue(e,'exitY'))*s.h},...children(g,'Array').flatMap(a=>children(a,'mxPoint').map(x=>({x:Number(attr(x,'x'))+p.x,y:Number(attr(x,'y'))+p.y}))),{x:t.x+Number(styleValue(e,'entryX'))*t.w,y:t.y+Number(styleValue(e,'entryY'))*t.h}]
  for(let i=1;i<points.length;i++)assert.ok(points[i-1].x===points[i].x||points[i-1].y===points[i].y,id+' diagonal')
  const outer=points.slice(1).filter((b,i)=>horizontal?b.y===points[i].y&&b.y>boundary+16&&Math.abs(b.x-points[i].x)>32:b.x===points[i].x&&b.x>boundary+16&&Math.abs(b.y-points[i].y)>32)
  assert.ok(outer.length,id+' does not use whole-drawing perimeter')
  return {id,boundary,channel:horizontal?outer[0].y:outer[0].x,points}
 })
}
for(const kind of ['flowchart','swimlane'] as const)for(const orientation of ['vertical','horizontal'] as const)test(kind+' '+orientation+': marked and real unmarked returns use independent whole-drawing channels',async()=>{
 const content=outerReturnContent(kind),engine=await compileDrawio(content,{preferences:{orientation}}),n=parseNative(engine.xml)
 assert.deepEqual((await projectDrawio(engine.xml)).content,content)
 const evidence=returnEvidence(n,orientation==='horizontal');assert.notEqual(evidence[0].channel,evidence[1].channel)
 assert.deepEqual(inspectNativeLayout(n),[])
})
test('same-rank handoff is not reverse; explicit feedback still routes outside without changing other human cells',async()=>{
 const content=outerReturnContent('swimlane'),engine=await compileDrawio(content),n=parseNative(engine.xml),s=mainEntry(n,'node','a'),t=mainEntry(n,'node','b')
 const byId=new Map([s,t].map(e=>[e.id,absoluteRouteBox(n,e)]));byId.get(t.id)!.y=byId.get(s.id)!.y+3
 assert.equal(isOuterReturn(n,mainEntry(n,'edge','f2'),byId,false),false)
 const old=mainEntry(n,'edge','f1');setStyle(old,{strokeColor:'#247246'});setBox(mainEntry(n,'node','start'),{x:33});const before=new Map([...n.cells].map(([id,e])=>[id,cellSignature(e)]))
 await routeNativeEdges(n,[mainEntry(n,'edge','feedback')])
 for(const [id,signature]of before)if(id!==mainEntry(n,'edge','feedback').id)assert.equal(cellSignature(n.cells.get(id)!),signature,id+' unrelated cell changed')
 const project=await createDrawingProject(content,{...engine,xml:serialize(n.document)},{createdAt:1,updatedAt:1}),patched=await patchDrawio(project,[{op:'update_node',id:'a',changes:{label:'更新申请文案'}}]),next=parseNative(patched.xml)
 for(const edge of mainEntries(n).filter(e=>businessType(e)==='edge'))assert.equal(cellSignature(next.cells.get(edge.id)!),cellSignature(edge),'text patch changed route')
})
for(const kind of ['flowchart','swimlane'] as const)test(kind+': changing only edge kind invokes outer routing and preserves unrelated cells/paint',async()=>{
 const content=outerReturnContent(kind),engine=await compileDrawio(content),n=parseNative(engine.xml),edge=mainEntry(n,'edge','f2');setStyle(edge,{strokeColor:'#246824',strokeWidth:3})
 const p=await createDrawingProject(content,{...engine,xml:serialize(n.document)},{createdAt:1,updatedAt:1}),changed=await patchDrawio(p,[{op:'update_edge',id:'f2',changes:{kind:'feedback'}}]),next=parseNative(changed.xml)
 assert.equal(styleValue(mainEntry(next,'edge','f2'),'strokeColor'),'#246824');assert.equal(styleValue(mainEntry(next,'edge','f2'),'strokeWidth'),'3')
 assert.notEqual(cellSignature(mainEntry(next,'edge','f2')),cellSignature(edge))
 for(const[id,e]of n.cells)if(id!==edge.id)assert.equal(cellSignature(next.cells.get(id)!),cellSignature(e),id+' unrelated cell changed')
 assert.equal((await projectDrawio(changed.xml)).content.edges.find(e=>e.id==='f2')!.kind,'feedback');assert.deepEqual(inspectNativeLayout(next),[])
})
test('opposite shared return leg rejects without changing immutable human routes',()=>{
 const routes=new Map([['human',[{x:0,y:12},{x:80,y:12}]],['new-return',[{x:100,y:12},{x:20,y:12}]]]),before=JSON.stringify([...routes])
 assert.throws(()=>assertOuterSeparation(routes,new Set(['new-return'])),/ROUTING_RETURN_OVERLAP/);assert.equal(JSON.stringify([...routes]),before)
})
