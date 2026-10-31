import {test} from 'node:test'
import assert from 'node:assert/strict'
import {businessContent} from './fixtures/native-business'
import {compileDrawio,patchDrawio,projectDrawio} from '../src/drawing/engine/drawio'
import {createDrawingProject} from '../src/drawing/engine/project'
import {parseNative,serialize,attr} from '../src/drawing/engine/drawio/xml'
import {mainEntry,box,setBox,styleValue,cellSignature,appendObject} from '../src/drawing/engine/drawio/state'
import {absoluteRouteBox,inspectNativeLayout} from '../src/drawing/engine/drawio/routing'
import {assertNoWorseLocalLayout} from '../src/drawing/engine/drawio/local-layout'
import type {DiagramContent,DiagramKind} from '../src/drawing/core/model'
import type {DrawingProjectV3,DrawioEngineDocument} from '../src/drawing/engine/types'
const project=async(kind:DiagramKind,orientation?:'vertical'|'horizontal')=>{const content=businessContent(kind,'incremental-'+kind);return createDrawingProject(content,await compileDrawio(content,{preferences:orientation?{orientation}:{}}),{preferences:orientation?{orientation}:{},createdAt:1,updatedAt:1})}
const adopt=async(base:DrawingProjectV3,engine:DrawioEngineDocument)=>({...base,content:(await projectDrawio(engine.xml)).content,rendering:{...base.rendering,engine}})
const nodeSnapshot=(base:DrawingProjectV3)=>{const n=parseNative(base.rendering.engine.xml);return new Map(base.content.nodes.map(node=>[node.id,cellSignature(mainEntry(n,'node',node.id))]))}
const unchanged=(before:Map<string,string>,after:ReturnType<typeof parseNative>,except:string[]=[])=>{for(const [id,signature]of before)if(!except.includes(id))assert.equal(cellSignature(mainEntry(after,'node',id)),signature,id)}

for(const orientation of ['vertical','horizontal']as const)test(`technical ${orientation}: root additions avoid nested shapes/titles and share fresh styles without changing human objects`,async()=>{
 const base=await project('technical',orientation),original=base.rendering.engine.xml,n=parseNative(original),owner=mainEntry(n,'node','entry'),icon=n.cells.get(owner.id+':technology-icon')!
 icon.cell.setAttribute('style',attr(icon.cell,'style')+';rotation=17;');setBox(icon,{width:62,height:56});base.rendering.engine.xml=serialize(n.document)
 const source=base.rendering.engine.xml,before=nodeSnapshot(base),iconSignature=cellSignature(icon),node={id:'new-cache',kind:'module' as const,label:'Redis',technology:'redis'},engine=await patchDrawio(base,[{op:'add_node',node}]),result=parseNative(engine.xml)
 assert.deepEqual(inspectNativeLayout(result),[]);unchanged(before,result);assert.equal(cellSignature(result.cells.get(icon.id)!),iconSignature)
 const fresh=parseNative((await compileDrawio({...base.content,nodes:[...base.content.nodes,node]},{preferences:base.rendering.preferences})).xml)
 assert.equal(attr(mainEntry(result,'node',node.id).cell,'style'),attr(mainEntry(fresh,'node',node.id).cell,'style'))
 assert.equal(styleValue(mainEntry(result,'node',node.id),'fillColor'),'none');assert.equal(styleValue(mainEntry(result,'node',node.id),'fontColor'),'#262c35')
 assert.equal(base.rendering.engine.xml,source)
})

test('technical multiple rounds add, rename, move between groups and delete preserve unrelated cells and reroute incident edges',async()=>{
 let base=await project('technical');const stable=nodeSnapshot(base),node={id:'cache',kind:'module' as const,label:'Redis',technology:'redis',groupId:'app'}
 base=await adopt(base,await patchDrawio(base,[{op:'add_node',node},{op:'add_edge',edge:{id:'cache-edge',source:'task',target:'cache'}}]))
 assert.deepEqual(inspectNativeLayout(parseNative(base.rendering.engine.xml)),[])
 const beforeMove=nodeSnapshot(base);base=await adopt(base,await patchDrawio(base,[{op:'update_node',id:'cache',changes:{groupId:'service',label:'Redis缓存'}}]));const moved=parseNative(base.rendering.engine.xml)
 assert.equal(attr(mainEntry(moved,'node','cache').cell,'parent'),mainEntry(moved,'layer','service').id);unchanged(beforeMove,moved,['cache']);assert.deepEqual(inspectNativeLayout(moved),[])
 base=await adopt(base,await patchDrawio(base,[{op:'remove_node',id:'cache'}]));unchanged(stable,parseNative(base.rendering.engine.xml));assert.equal(base.content.nodes.some(n=>n.id==='cache'),false)
})

test('a labeled service-to-new-root-cache edge reserves a real label channel after manual node/icon styling',async()=>{
 const base=await project('technical'),n=parseNative(base.rendering.engine.xml),vue=mainEntry(n,'node','entry'),icon=n.cells.get(vue.id+':technology-icon')!
 vue.cell.setAttribute('style',attr(vue.cell,'style')+';fillColor=#fff4d8;strokeColor=#8a5d12;strokeWidth=3;');icon.cell.setAttribute('style',attr(icon.cell,'style')+';rotation=12;');base.rendering.engine.xml=serialize(n.document)
 const source=base.rendering.engine.xml,before=nodeSnapshot(base),iconSignature=cellSignature(icon),oldEdge=cellSignature(mainEntry(n,'edge','call'))
 const engine=await patchDrawio(base,[{op:'add_node',node:{id:'cache',kind:'module',label:'Redis',technology:'redis'}},{op:'add_edge',edge:{id:'cache-edge',source:'task',target:'cache',label:'缓存'}}]),after=parseNative(engine.xml)
 assert.deepEqual(inspectNativeLayout(after),[]);unchanged(before,after);assert.equal(cellSignature(after.cells.get(icon.id)!),iconSignature);assert.equal(cellSignature(mainEntry(after,'edge','call')),oldEdge);assert.equal((await projectDrawio(engine.xml)).content.edges.find(edge=>edge.id==='cache-edge')?.label,'缓存');assert.equal(base.rendering.engine.xml,source)
})

for(const kind of ['technical','architecture']as const)test(`${kind}: new logical group/node/edge use this type's visual strategy`,async()=>{
 const base=await project(kind),group={id:'new-group',label:'新增组件'},node={id:'ops',kind:'module' as const,label:kind==='technical'?'Jenkins':'交付管理',groupId:group.id,...(kind==='technical'?{technology:'jenkins'}:{items:['交付核验']})}
 const engine=await patchDrawio(base,[{op:'add_container',collection:'groups',item:group},{op:'add_node',node},{op:'add_edge',edge:{id:'new-edge',source:'ops',target:'task'}}]),n=parseNative(engine.xml),layer=mainEntry(n,'layer',group.id),entry=mainEntry(n,'node',node.id)
 assert.deepEqual(inspectNativeLayout(n),[]);unchanged(nodeSnapshot(base),n)
 if(kind==='technical'){assert.equal(styleValue(layer,'fillColor'),'none');assert.equal(styleValue(layer,'startSize'),'0');assert.equal(styleValue(layer,'dashed'),'1');assert.equal(styleValue(entry,'fillColor'),'none');assert.equal(styleValue(mainEntry(n,'edge','new-edge'),'strokeColor'),'#41454a');assert.equal(styleValue(mainEntry(n,'edge','new-edge'),'curved'),'1');assert.equal(styleValue(mainEntry(n,'edge','new-edge'),'dashed'),'1')}
 else {assert.equal(attr(layer.object,'fmArchitectureBand'),'1');assert.equal(styleValue(layer,'horizontal'),'0');assert.equal(styleValue(layer,'startSize'),'100');assert.ok(n.cells.has(layer.id+':title'));assert.equal(attr(entry.object,'fmArchitectureGrid'),'1')}
})

for(const orientation of ['vertical','horizontal']as const)test(`flow ${orientation}: inserted action stays near its real predecessor instead of the diagram bottom`,async()=>{
 const base=await project('flowchart',orientation),old=nodeSnapshot(base),engine=await patchDrawio(base,[{op:'remove_edge',id:'a'},{op:'add_node',node:{id:'insert',kind:'task',label:'登记资料'}},{op:'add_edge',edge:{id:'i1',source:'start',target:'insert'}},{op:'add_edge',edge:{id:'i2',source:'insert',target:'task'}}]),n=parseNative(engine.xml),s=absoluteRouteBox(n,mainEntry(n,'node','start')),added=absoluteRouteBox(n,mainEntry(n,'node','insert')),last=absoluteRouteBox(n,mainEntry(n,'node','end'))
 unchanged(old,n);assert.deepEqual(inspectNativeLayout(n),[]);assert.ok(orientation==='vertical'?added.y<last.y+last.h:added.x<last.x+last.w);assert.ok(Math.hypot(added.x-s.x,added.y-s.y)<800)
})

test('mindmap new topic uses its actual parent neighborhood and retains existing branch geometry',async()=>{
 const base=await project('mindmap','horizontal'),before=nodeSnapshot(base),engine=await patchDrawio(base,[{op:'add_node',node:{id:'new-topic',kind:'topic',label:'检查条件',parentId:'root'}}]),n=parseNative(engine.xml)
 unchanged(before,n);assert.deepEqual(inspectNativeLayout(n),[]);assert.equal((await projectDrawio(engine.xml)).content.nodes.find(node=>node.id==='new-topic')?.parentId,'root')
})

test('historical overlap permits wording, but a larger overlap with identical cell IDs is rejected',async()=>{
 const base=await project('technical'),n=parseNative(base.rendering.engine.xml),a=mainEntry(n,'node','entry'),b=mainEntry(n,'node','task');setBox(b,{x:box(a).x+box(a).width-20,y:box(a).y});b.cell.setAttribute('parent',attr(a.cell,'parent')!);b.object.setAttribute('fmGroupId','app')
 base.content.nodes.find(node=>node.id==='task')!.groupId='app';const projected=await projectDrawio(serialize(n.document));base.content=projected.content;base.rendering.engine={...base.rendering.engine,xml:serialize(n.document),contentHash:projected.contentHash}
 const changed=await patchDrawio(base,[{op:'update_node',id:'entry',changes:{label:'Vue UI'}}]);assert.ok(inspectNativeLayout(parseNative(changed.xml)).some(i=>i.code==='NODE_OVERLAP'))
 const worse=parseNative(changed.xml);setBox(mainEntry(worse,'node','task'),{x:box(a).x+box(a).width-60});assert.throws(()=>assertNoWorseLocalLayout(n,worse),/LOCAL_LAYOUT_CONFLICT/)
})

test('no safe bounded group slot rejects atomically and locked human containers are never expanded',async()=>{
 const base=await project('architecture'),n=parseNative(base.rendering.engine.xml),layer=mainEntry(n,'layer','app');layer.cell.setAttribute('style',attr(layer.cell,'style')+';locked=1;');base.rendering.engine.xml=serialize(n.document);const source=base.rendering.engine.xml
 await assert.rejects(patchDrawio(base,[{op:'add_node',node:{id:'locked-child',kind:'module',label:'新模块',groupId:'app'}}]),/LOCKED_OBJECT/);assert.equal(base.rendering.engine.xml,source)
 const {placeLocalNode}=await import('../src/drawing/engine/drawio/local-layout'),candidate=mainEntry(n,'node','entry');layer.cell.setAttribute('style',attr(layer.cell,'style')+';locked=0;');setBox(candidate,{width:50000,height:50000});assert.throws(()=>placeLocalNode(n,candidate,layer,base.content,base.content.nodes[0],false),/LOCAL_CONTAINER_NO_SPACE/);assert.equal(base.rendering.engine.xml,source)
})

test('a genuinely packed technical group cannot expand through neighboring human groups; rejected patch leaves source untouched',async()=>{
 const base=await project('technical'),n=parseNative(base.rendering.engine.xml),parent=mainEntry(n,'layer','app'),bounds=absoluteRouteBox(n,parent)
 // Existing component occupies this private group's body. Two empty business
 // groups form real right/bottom neighbors, with no legal expansion corridor.
 for(const [id,label,shape]of [
  ['right-wall','人工右侧组',{x:bounds.x+bounds.w,y:bounds.y,width:1000,height:2000}],
  ['bottom-wall','人工下侧组',{x:bounds.x,y:bounds.y+bounds.h,width:3000,height:1000}]
 ]as const){base.content.groups.push({id,label});appendObject(n,'wall-'+id,label,{fmType:'layer',fmRole:'main',fmId:id,fmIndex:String(base.content.groups.length-1)},{vertex:1,parent:'1',style:'shape=rectangle;container=1;startSize=0;'},shape)}
 const projected=await projectDrawio(serialize(n.document));base.content=projected.content;base.rendering.engine={...base.rendering.engine,xml:serialize(n.document),contentHash:projected.contentHash};const source=base.rendering.engine.xml
 await assert.rejects(patchDrawio(base,[{op:'add_node',node:{id:'cannot-fit',kind:'module',label:'Redis',technology:'redis',groupId:'app'}}]),/LOCAL_CONTAINER_NO_SPACE/)
 assert.equal(base.rendering.engine.xml,source);assert.equal(base.content.nodes.some(node=>node.id==='cannot-fit'),false)
})

test('new objects avoid saved unrelated label/route occupancy and leave the complete saved edge subtree unchanged',async()=>{
 const base=await project('flowchart'),before=parseNative(base.rendering.engine.xml),edge=mainEntry(before,'edge','b'),signature=cellSignature(edge),children=new Map([...before.cells.values()].filter(e=>attr(e.cell,'parent')===edge.id).map(e=>[e.id,cellSignature(e)]))
 const changed=await patchDrawio(base,[{op:'add_node',node:{id:'independent',kind:'task',label:'检查凭证'}}]),n=parseNative(changed.xml)
 assert.deepEqual(inspectNativeLayout(n),[]);assert.equal(cellSignature(mainEntry(n,'edge','b')),signature)
 for(const [id,signature]of children)assert.equal(cellSignature(n.cells.get(id)!),signature)
})

test('the same historical route/shape conflict cannot hide an increased crossing length',async()=>{
 const base=await project('flowchart'),before=parseNative(base.rendering.engine.xml),start=absoluteRouteBox(before,mainEntry(before,'node','start')),target=absoluteRouteBox(before,mainEntry(before,'node','task')),obstacle=mainEntry(before,'node','end'),middle=(start.y+start.h+target.y)/2
 setBox(obstacle,{x:start.x+start.w/2-20,y:middle-10,width:40,height:20});assert.ok(inspectNativeLayout(before).some(issue=>issue.code==='ROUTE_THROUGH_SHAPE'&&issue.cellIds.includes(obstacle.id)))
 const after=parseNative(serialize(before.document));setBox(mainEntry(after,'node','end'),{y:middle-30,height:60})
 assert.throws(()=>assertNoWorseLocalLayout(before,after),/LOCAL_LAYOUT_CONFLICT/)
})
