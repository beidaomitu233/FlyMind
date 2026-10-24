import {test} from 'node:test'
import assert from 'node:assert/strict'
import {technicalReferenceContent} from '../src/drawing/core/technical-sample'
import {layoutTechnical} from '../src/drawing/engine/drawio/technical-layout'

const sizes=(content:ReturnType<typeof technicalReferenceContent>)=>new Map(content.nodes.map(n=>[n.id,{width:180,height:n.label.includes('\n')?180:148,font:16,shape:'rectangle'}]))
test('technical reference places the dependency backbone between upper and lower auxiliary groups',()=>{
 const content=technicalReferenceContent(),layout=layoutTechnical(content,sizes(content)),region=(id:string)=>layout.regions.find(r=>r.id===id)!.box
 assert.equal(content.nodes.length,24);assert.equal(content.groups.length,9)
 assert.ok(region('frontend').x<region('gateway').x&&region('gateway').x<region('backend').x&&region('backend').x<region('storage').x)
 for(const id of ['schedule','messages','locks'])assert.ok(region(id).y+region(id).height<region('backend').y)
 for(const id of ['operations','observability'])assert.ok(region(id).y>region('backend').y+region('backend').height)
 for(const p of layout.placed)if(p.parent){const parent=region(p.parent);assert.ok(p.box.x>=0&&p.box.y>=0&&p.box.x+p.box.width<=parent.width&&p.box.y+p.box.height<=parent.height)}
})
test('technical role placement does not depend on reference ids or group array order',()=>{
 const original=technicalReferenceContent(),renamed=structuredClone(original),nodeIds=new Map(original.nodes.map((n,i)=>[n.id,'unit-'+i])),groupIds=new Map(original.groups.map((g,i)=>[g.id,'zone-'+i]))
 renamed.groups=renamed.groups.reverse().map(g=>({...g,id:groupIds.get(g.id)!,label:'区域'}));renamed.nodes=renamed.nodes.map(n=>({...n,id:nodeIds.get(n.id)!,...(n.groupId?{groupId:groupIds.get(n.groupId)}:{})}));renamed.edges=renamed.edges.map((e,i)=>({...e,id:'link-'+i,source:nodeIds.get(e.source)!,target:nodeIds.get(e.target)!}))
 const before=layoutTechnical(original,sizes(original)),after=layoutTechnical(renamed,sizes(renamed))
 for(const region of before.regions)assert.deepEqual(after.regions.find(r=>r.id===groupIds.get(region.id))!.box,region.box)
})
test('unknown ungrouped technology uses actual dependencies instead of inventing semantic layers',()=>{
 const content=technicalReferenceContent();content.groups=[];content.nodes=['a','b','c'].map(id=>({id,label:id,kind:'module',technology:'unregistered-component'}));content.edges=[{id:'ca',source:'c',target:'a'},{id:'ab',source:'a',target:'b'}]
 const result=layoutTechnical(content,sizes(content)),x=(id:string)=>result.placed.find(p=>p.node.id===id)!.box.x
 assert.equal(result.regions.length,0);assert.ok(x('c')<x('a')&&x('a')<x('b'))
})
test('vertical technical layout reserves label clearance using unrotated node widths',()=>{
 const content=technicalReferenceContent();content.groups=[{id:'app',label:'应用',kind:'layer'}];content.nodes=[{id:'a',kind:'module',label:'前端',technology:'vue',groupId:'app'},{id:'b',kind:'module',label:'服务',technology:'spring-boot',groupId:'app'}];content.edges=[{id:'call',source:'a',target:'b',label:'HTTP'}]
 const result=layoutTechnical(content,sizes(content),'vertical'),[a,b]=result.placed.sort((a,b)=>a.box.x-b.box.x)
 assert.ok(b.box.x-(a.box.x+a.box.width)>=64);assert.ok(result.regions[0].box.width>=b.box.x+b.box.width);assert.ok(result.regions.every(r=>r.box.y>=128))
})
