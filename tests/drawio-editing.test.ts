import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {compileDrawio,normalizeDrawioEdits,projectDrawio,patchDrawio,drawioRenderSignature} from '../src/drawing/engine/drawio/index'
import {createDrawingProject} from '../src/drawing/engine/project'
import {operationSchema,contentSchema} from '../server/contracts'
import {applyContentOperations,composeDocument,extractContent,validateContent} from '../src/drawing/core/layers'
import {attr,children,element,parseNative,serialize,type NativeDocument,type NativeCell} from '../src/drawing/engine/drawio/xml'
import {mainEntry,businessType,geometry,removeEntry} from '../src/drawing/engine/drawio/state'
import {inspectNativeLayout} from '../src/drawing/engine/drawio/routing'
async function base(){const content=JSON.parse(await readFile(new URL('./fixtures/drawio-baseline/pbs-main.content.json',import.meta.url),'utf8'));return createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1})}
const edit=(xml:string,fn:(n:NativeDocument)=>void)=>{const n=parseNative(xml);fn(n);return serialize(n.document)}
function clone(n:NativeDocument,e:NativeCell,id:string){const obj=e.object.cloneNode(true) as Element;obj.setAttribute('id',id);if(obj.nodeName!=='mxCell')children(obj,'mxCell')[0].removeAttribute('id');n.root.appendChild(obj);for(const child of [...n.cells.values()].filter(x=>attr(x.cell,'parent')===e.id)){const copy=clone(n,child,id+':'+child.id);copy.cell.setAttribute('parent',id)}return {id,object:obj,cell:obj.nodeName==='mxCell'?obj:children(obj,'mxCell')[0]}}
test('JSON null clears optional update fields consistently, while required, add and content fields reject null',()=>{
 const content={id:'clear-fields',title:'清除',kind:'flowchart',nodes:[{id:'a',label:'A',kind:'task',laneId:'l',phaseId:'p',groupId:'g',parentId:'b',color:'#123456',description:'正文',items:['条目'],badge:'标记'},{id:'b',label:'B',kind:'task'}],edges:[{id:'ab',source:'a',target:'b',label:'关系',kind:'feedback'}],lanes:[{id:'l',label:'角色'}],phases:[{id:'p',label:'阶段'}],groups:[{id:'g',label:'层',kind:'layer',color:'#123456'}]}
 const d=composeDocument(content),nodeFields=['laneId','phaseId','groupId','parentId','color','description','items','badge'],ops=JSON.parse(JSON.stringify([{op:'update_node',id:'a',changes:Object.fromEntries(nodeFields.map(k=>[k,null]))},{op:'update_edge',id:'ab',changes:{label:null,kind:null}},{op:'update_container',collection:'groups',id:'g',changes:{color:null,kind:null}}])).map((o:unknown)=>operationSchema.parse(o))
 const result=extractContent(applyContentOperations(d,ops));for(const key of nodeFields)assert.ok(!Object.hasOwn(result.nodes[0],key));for(const key of ['label','kind'])assert.ok(!Object.hasOwn(result.edges[0],key));for(const key of ['color','kind'])assert.ok(!Object.hasOwn(result.groups[0],key));assert.equal(d.nodes[0].description,'正文');assert.ok(!JSON.stringify(result).includes(':null'))
 for(const [op,id,fields] of [['update_node','a',['label','kind']],['update_edge','ab',['source','target']],['update_container','g',['label']]] as const)for(const field of fields){const invalid={op,id,...(op==='update_container'?{collection:'groups'}:{}),changes:{[field]:null}};assert.equal(operationSchema.safeParse(invalid).success,false);assert.throws(()=>applyContentOperations(d,[invalid]),/不能清除/)}
 for(const invalid of [{op:'add_node',node:{id:'c',label:'C',kind:'task',phaseId:null}},{op:'add_edge',edge:{id:'ba',source:'b',target:'a',kind:null}},{op:'add_container',collection:'groups',item:{id:'g2',label:'层2',kind:null}}]){assert.equal(operationSchema.safeParse(invalid).success,false);assert.throws(()=>applyContentOperations(d,[invalid]),/null/)}
 for(const bad of [{...content,nodes:[{id:'a',label:'A',kind:'task',phaseId:null}]},{...content,edges:[{id:'ab',source:'a',target:'b',kind:null}]},{...content,groups:[{id:'g',label:'层',kind:null}]}]){assert.equal(contentSchema.safeParse(bad).success,false);assert.throws(()=>validateContent(bad),/null/)}
})
test('normalizer assigns clone IDs from base native identity and keeps copied internal endpoints',async()=>{
 const b=await base(),xml=edit(b.rendering.engine.xml,n=>{const a=clone(n,mainEntry(n,'node','n01'),'copy-a'),c=clone(n,mainEntry(n,'node','n02'),'copy-b'),edge=clone(n,mainEntry(n,'edge','e01'),'copy-edge');edge.cell.setAttribute('source',a.id);edge.cell.setAttribute('target',c.id)})
 await assert.rejects(()=>projectDrawio(xml,b.content),/DUPLICATE_BINDING/)
 const result=await normalizeDrawioEdits(xml,b),n=parseNative(result.xml)
 const a=attr(n.cells.get('copy-a')!.object,'fmId')!,c=attr(n.cells.get('copy-b')!.object,'fmId')!,edgeId=attr(n.cells.get('copy-edge')!.object,'fmId')!
 assert.notEqual(a,'n01');assert.notEqual(c,'n02');assert.equal(result.content.edges.find(e=>e.id===edgeId)!.source,a);assert.equal(result.content.edges.find(e=>e.id===edgeId)!.target,c)
 assert.deepEqual(result.content.nodes.find(x=>x.id==='n01'),b.content.nodes.find(x=>x.id==='n01'));assert.equal(result.content.nodes.length,25)
 assert.deepEqual((await projectDrawio(result.xml)).content,result.content)
 assert.deepEqual(await normalizeDrawioEdits(result.xml,b),{...result,diagnostics:[]})
})
test('explicit new business shapes receive identities, new native edges between business cells become flow, ordinary shapes stay decorations',async()=>{
 const b=await base(),xml=edit(b.rendering.engine.xml,n=>{
  const parent=mainEntry(n,'node','n01').cell.getAttribute('parent')
  const node=element(n.document,'mxCell',{id:'new-intent',value:'原生新增业务',fmType:'node',fmKind:'task',vertex:1,parent,style:'rounded=1;'});node.appendChild(element(n.document,'mxGeometry',{x:40,y:400,width:200,height:64,as:'geometry'}));n.root.appendChild(node)
  n.root.appendChild(element(n.document,'mxCell',{id:'unknown',value:'装饰',vertex:1,parent:'1'}))
  const edge=element(n.document,'mxCell',{id:'native-edge',edge:1,parent:'1',source:'fm:node:n01',target:'new-intent'});edge.appendChild(element(n.document,'mxGeometry',{relative:1,as:'geometry'}));n.root.appendChild(edge)
  n.root.appendChild(element(n.document,'mxCell',{id:'decoration-edge',edge:1,parent:'1',source:'unknown',target:'new-intent'}))
 })
 const p=await normalizeDrawioEdits(xml,b);assert.equal(p.content.nodes.length,24);assert.equal(p.content.edges.length,27);assert.equal(p.content.edges.at(-1)!.kind,'flow');assert.ok(p.content.nodes.at(-1)!.id.startsWith('node_'));assert.ok(p.xml.includes('decoration-edge'));assert.equal(p.content.nodes.at(-1)!.laneId,'r01')
})
test('native reparent updates explicit role/phase attributes without guessing geometry',async()=>{
 const b=await base(),xml=edit(b.rendering.engine.xml,n=>{const e=mainEntry(n,'node','n02'),parent=[...n.cells.values()].find(e=>attr(e.object,'fmRole')==='intersection'&&attr(e.object,'fmLaneId')==='r04'&&attr(e.object,'fmPhaseId')==='p03')!;e.cell.setAttribute('parent',parent.id)})
 await assert.rejects(()=>projectDrawio(xml,b.content),/OWNERSHIP_MISMATCH/)
 const result=await normalizeDrawioEdits(xml,b);assert.equal(result.content.nodes.find(n=>n.id==='n02')!.laneId,'r04');assert.equal(result.content.nodes.find(n=>n.id==='n02')!.phaseId,'p03')
})
test('native node deletion requires native removal of associated edges; disconnected surviving edges remain an error draft',async()=>{
 const b=await base(),xml=edit(b.rendering.engine.xml,n=>{const e=mainEntry(n,'node','n16');removeEntry(n,e.id)})
 await assert.rejects(()=>normalizeDrawioEdits(xml,b),/NATIVE_DELETE_INCOMPLETE/);const complete=edit(b.rendering.engine.xml,n=>{for(const e of [...n.cells.values()])if(attr(e.cell,'edge')==='1'&&['fm:node:n16'].some(id=>attr(e.cell,'source')===id||attr(e.cell,'target')===id))removeEntry(n,e.id);removeEntry(n,mainEntry(n,'node','n16').id)});const result=await normalizeDrawioEdits(complete,b);assert.equal(result.content.nodes.length,22);assert.ok(!result.content.edges.some(e=>['e03','e04'].includes(e.id)));assert.ok(result.content.edges.some(e=>e.id==='e01'))
 await assert.rejects(()=>normalizeDrawioEdits(edit(b.rendering.engine.xml,n=>mainEntry(n,'edge','e01').cell.removeAttribute('target')),b),/DISCONNECTED_BUSINESS_EDGE/)
 await assert.rejects(()=>normalizeDrawioEdits(edit(b.rendering.engine.xml,n=>mainEntry(n,'node','n02').cell.setAttribute('parent','1')),b),/UNASSIGNED_NODE/)
})
test('render signature ignores viewport/format/default-zero but detects native geometry/style/decorations',async()=>{
 const b=await base(),xml=b.rendering.engine.xml,sig=drawioRenderSignature(xml)
 assert.equal(drawioRenderSignature(edit(xml,n=>{n.model.setAttribute('dx','245');n.model.setAttribute('dy','900');n.model.setAttribute('grid','0');n.model.setAttribute('pageWidth','999');n.file.setAttribute('modified','now');const e=mainEntry(n,'lane','r01');geometry(e).removeAttribute('y')})),sig)
 assert.notEqual(drawioRenderSignature(edit(xml,n=>geometry(mainEntry(n,'node','n01')).setAttribute('x','123'))),sig)
 assert.notEqual(drawioRenderSignature(edit(xml,n=>mainEntry(n,'node','n01').cell.setAttribute('style','ellipse;'))),sig)
 assert.notEqual(drawioRenderSignature(edit(xml,n=>n.root.appendChild(element(n.document,'mxCell',{id:'decor',vertex:1,parent:'1',value:'new'})))),sig)
})
test('normalizer rejects locked changes and identity ambiguity without mutating its base',async()=>{
 const b=await base();b.rendering.engine.xml=edit(b.rendering.engine.xml,n=>{const e=mainEntry(n,'node','n01');e.cell.setAttribute('style',e.cell.getAttribute('style')+'locked=1;')});const before=JSON.stringify(b)
 await assert.rejects(()=>normalizeDrawioEdits(edit(b.rendering.engine.xml,n=>mainEntry(n,'node','n01').object.setAttribute('label','override')),b),/LOCKED_OBJECT/)
 const restored=await normalizeDrawioEdits(edit(b.rendering.engine.xml,n=>mainEntry(n,'node','n02').object.setAttribute('fmId','changed')),b);assert.equal(restored.content.nodes.find(n=>n.id==='n02')!.label,b.content.nodes.find(n=>n.id==='n02')!.label);assert.ok(restored.diagnostics.some(d=>d.code==='CONFIRMED_ID_RESTORED'))
 assert.equal(JSON.stringify(b),before)
})
test('save A identity acknowledgement may lag behind a newer B snapshot without losing B text or clone identities',async()=>{
 const b=await base(),rawA=edit(b.rendering.engine.xml,n=>{const c=clone(n,mainEntry(n,'node','n01'),'late-copy');c.cell.setAttribute('style',c.cell.getAttribute('style')+'locked=1;')})
 const a=await normalizeDrawioEdits(rawA,b),stored=await createDrawingProject(a.content,{...b.rendering.engine,xml:a.xml,contentHash:a.contentHash},{createdAt:1,updatedAt:2}),id=attr(parseNative(a.xml).cells.get('late-copy')!.object,'fmId')
 const rawB=edit(rawA,n=>([...n.cells.values()].find(e=>attr(e.cell,'parent')===mainEntry(n,'node','n02').id&&attr(e.object,'fmRole')==='title')??mainEntry(n,'node','n02')).object.setAttribute('label','B 在保存A期间继续输入'))
 const savedB=await normalizeDrawioEdits(rawB,stored)
 assert.equal(attr(parseNative(savedB.xml).cells.get('late-copy')!.object,'fmId'),id);assert.equal(savedB.content.nodes.find(n=>n.id==='n02')!.label,'B 在保存A期间继续输入');assert.equal(savedB.content.nodes.length,24)
})
test('save A acknowledgement for a new cell with no ID and an unbound edge preserves newer B labels',async()=>{
 const b=await base(),rawA=edit(b.rendering.engine.xml,n=>{const parent=mainEntry(n,'node','n01').cell.getAttribute('parent'),node=element(n.document,'mxCell',{id:'pending-node',value:'A',fmType:'node',fmKind:'task',vertex:1,parent});node.appendChild(element(n.document,'mxGeometry',{x:70,y:300,width:200,height:64,as:'geometry'}));n.root.appendChild(node);const edge=element(n.document,'mxCell',{id:'pending-edge',edge:1,parent:'1',source:'fm:node:n01',target:'pending-node'});edge.appendChild(element(n.document,'mxGeometry',{relative:1,as:'geometry'}));n.root.appendChild(edge)})
 const a=await normalizeDrawioEdits(rawA,b),stored=await createDrawingProject(a.content,{...b.rendering.engine,xml:a.xml,contentHash:a.contentHash},{createdAt:1,updatedAt:2}),rawB=edit(rawA,n=>{n.cells.get('pending-node')!.cell.setAttribute('value','B尚未收到A元数据');n.cells.get('pending-edge')!.cell.setAttribute('value','B条件')})
 const newer=await normalizeDrawioEdits(rawB,stored),aNative=parseNative(a.xml),n=parseNative(newer.xml);assert.equal(attr(n.cells.get('pending-node')!.object,'fmId'),attr(aNative.cells.get('pending-node')!.object,'fmId'));assert.equal(attr(n.cells.get('pending-edge')!.object,'fmId'),attr(aNative.cells.get('pending-edge')!.object,'fmId'));assert.equal(newer.content.nodes.at(-1)!.label,'B尚未收到A元数据');assert.equal(newer.content.edges.at(-1)!.label,'B条件')
})
test('editor may explicitly unlock its native lock owner before editing; AI content patches cannot do so',async()=>{
 const b=await base();b.rendering.engine.xml=edit(b.rendering.engine.xml,n=>{const e=mainEntry(n,'node','n01'),p=n.cells.get(e.cell.getAttribute('parent'))!;p.cell.setAttribute('style',p.cell.getAttribute('style')+'locked=1;')})
 const unlocked=edit(b.rendering.engine.xml,n=>{const e=mainEntry(n,'node','n01'),p=n.cells.get(e.cell.getAttribute('parent'))!;p.cell.setAttribute('style',p.cell.getAttribute('style').replace('locked=1;',''));e.object.setAttribute('label','解锁后编辑')})
 assert.equal((await normalizeDrawioEdits(unlocked,b)).content.nodes[0].label,'解锁后编辑')
 await assert.rejects(()=>patchDrawio(b,[{op:'update_node',id:'n01',changes:{description:'AI cannot bypass ancestor lock'}}]),/LOCKED_OBJECT/)
 const reparent=edit(b.rendering.engine.xml,n=>{const e=mainEntry(n,'node','n01'),parent=[...n.cells.values()].find(e=>attr(e.object,'fmRole')==='intersection'&&attr(e.object,'fmLaneId')==='r04'&&attr(e.object,'fmPhaseId')==='p01')!;e.cell.setAttribute('parent',parent.id)})
 await assert.rejects(()=>normalizeDrawioEdits(reparent,b),/LOCKED_OBJECT/)
})
test('two rounds of structural AI patches add, reconnect, move and delete actual cells while retaining unrelated layout',async()=>{
 const b=await base();b.rendering.engine.xml=edit(b.rendering.engine.xml,n=>{const e=mainEntry(n,'node','n15');geometry(e).setAttribute('x','137');e.cell.setAttribute('style',e.cell.getAttribute('style')+'rotation=3;');const edge=mainEntry(n,'edge','e25'),g=geometry(edge),points=element(n.document,'Array',{as:'points'});points.appendChild(element(n.document,'mxPoint',{x:210,y:2700}));g.appendChild(points)})
 const before=parseNative(b.rendering.engine.xml),untouched=serialize(mainEntry(before,'node','n15').object),waypoints=serialize(geometry(mainEntry(before,'edge','e25')))
 const first=await patchDrawio(b,[{op:'add_node',node:{id:'new-step',label:'补充复核',kind:'task',laneId:'r04',phaseId:'p02',description:'新增业务步骤'}},{op:'add_edge',edge:{id:'new-edge',source:'n06',target:'new-step',label:'需要补充'}},{op:'update_edge',id:'e11',changes:{source:'new-step',kind:'feedback',label:'继续执行'}}])
 const p1=await projectDrawio(first.xml),b1=await createDrawingProject(p1.content,first,{createdAt:1,updatedAt:2});assert.equal(p1.content.nodes.length,24);assert.equal(p1.content.edges.find(e=>e.id==='e11')!.source,'new-step')
 const second=await patchDrawio(b1,[{op:'update_node',id:'new-step',changes:{laneId:'r01',phaseId:'p03',label:'移交复核'}},{op:'remove_node',id:'n16'},{op:'remove_edge',id:'new-edge'},{op:'update_edge',id:'e11',changes:{kind:'flow'}}])
 const p2=await projectDrawio(second.xml),n=parseNative(second.xml);assert.equal(p2.content.nodes.find(n=>n.id==='new-step')!.laneId,'r01');assert.ok(!p2.content.nodes.some(n=>n.id==='n16'));assert.ok(!p2.content.edges.some(e=>['new-edge','e03','e04'].includes(e.id)));assert.equal(serialize(mainEntry(n,'node','n15').object),untouched);assert.equal(serialize(geometry(mainEntry(n,'edge','e25'))),waypoints)
})
test('container add/reorder/remove uses the native table and preserves unknown decorations when a container is removed',async()=>{
 const content={schemaVersion:1 as const,id:'container-crud',title:'容器编辑',kind:'swimlane' as const,nodes:[{id:'a',label:'提交',kind:'task' as const,laneId:'r01',phaseId:'p03'},{id:'b',label:'办理',kind:'task' as const,laneId:'r04',phaseId:'p05'}],edges:[{id:'ab',source:'a',target:'b',label:'已提交'}],lanes:[{id:'r01',label:'申请人'},{id:'r04',label:'经办人'}],phases:[{id:'p03',label:'受理'},{id:'p05',label:'交付'}],groups:[]}
 const b=await createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1}),a=await patchDrawio(b,[{op:'add_container',collection:'lanes',item:{id:'review',label:'复核人'},index:1},{op:'add_container',collection:'phases',item:{id:'review-phase',label:'复核阶段'},index:2},{op:'add_node',node:{id:'review-node',label:'独立复核',kind:'task',laneId:'review',phaseId:'review-phase'}}])
 const p=await projectDrawio(a.xml);assert.equal(p.content.lanes[1].id,'review');assert.equal(p.content.phases[2].id,'review-phase')
 a.xml=edit(a.xml,n=>{const parent=mainEntry(n,'node','review-node').cell.getAttribute('parent');const e=element(n.document,'mxCell',{id:'keep-decor',vertex:1,value:'人工装饰',parent});e.appendChild(element(n.document,'mxGeometry',{x:20,y:10,width:80,height:30,as:'geometry'}));n.root.appendChild(e)})
 const b1=await createDrawingProject(p.content,a,{createdAt:1,updatedAt:2}),last=await patchDrawio(b1,[{op:'reorder_container',collection:'phases',id:'p05',index:0},{op:'remove_container',collection:'lanes',id:'review',moveTo:'r04'},{op:'remove_container',collection:'phases',id:'review-phase',moveTo:'p03'}])
 const p2=await projectDrawio(last.xml);assert.equal(p2.content.phases[0].id,'p05');assert.equal(p2.content.nodes.find(n=>n.id==='review-node')!.laneId,'r04');assert.equal(p2.content.nodes.find(n=>n.id==='review-node')!.phaseId,'p03');assert.ok(last.xml.includes('keep-decor'));assert.equal(attr(parseNative(last.xml).cells.get('keep-decor')!.cell,'parent'),'1')
 assert.equal(p2.content.nodes.length,3);assert.deepEqual(p2.content.edges,content.edges)
 const final=parseNative(last.xml),edge=mainEntry(final,'edge','ab')
 const issues=inspectNativeLayout(final).filter(issue=>['ROUTE_THROUGH_SHAPE','LABEL_OVERLAP_SHAPE','LABEL_OVERLAP_LABEL','ROUTE_THROUGH_LABEL','LABEL_TOO_FAR_FROM_EDGE'].includes(issue.code)&&issue.cellIds.includes(edge.id));assert.deepEqual(issues,[],'ordinary container editing must retain the original collision/near-line gates')
})
test('crowded PBS container reorder rejects an unsafe label slot without mutating the source',async()=>{
 const b=await base();assert.equal(b.content.nodes.length,23);assert.equal(b.content.edges.length,26)
 const a=await patchDrawio(b,[{op:'add_container',collection:'lanes',item:{id:'review',label:'复核人'},index:1},{op:'add_container',collection:'phases',item:{id:'review-phase',label:'复核阶段'},index:2},{op:'add_node',node:{id:'review-node',label:'独立复核',kind:'task',laneId:'review',phaseId:'review-phase'}}]),project=await createDrawingProject((await projectDrawio(a.xml)).content,a,{createdAt:1,updatedAt:2})
 // The pure compiler receives the document, not permission to advance the
 // caller's revision. A rejected candidate must leave both completely intact.
 const record={revision:2,document:project},before=JSON.stringify(record),xml=project.rendering.engine.xml,hash=project.rendering.engine.contentHash
 await assert.rejects(()=>patchDrawio(record.document,[{op:'reorder_container',collection:'phases',id:'p05',index:0},{op:'remove_container',collection:'lanes',id:'review',moveTo:'r04'},{op:'remove_container',collection:'phases',id:'review-phase',moveTo:'p03'}]),/ROUTING_LABEL_NO_SPACE: 连线 e17 的 145×28px/)
 assert.equal(JSON.stringify(record),before);assert.equal(record.revision,2);assert.equal(project.rendering.engine.xml,xml);assert.equal(project.rendering.engine.contentHash,hash)
 assert.equal((await projectDrawio(xml)).contentHash,hash);assert.equal(project.content.nodes.length,24);assert.equal(project.content.edges.length,26);assert.ok(project.content.lanes.some(l=>l.id==='review'));assert.ok(project.content.phases.some(p=>p.id==='review-phase'))
})
test('long text grows only its local business range while notes neither occupy steps nor stretch phases',async()=>{
 const b=await base();b.rendering.engine.xml=edit(b.rendering.engine.xml,n=>{const note=mainEntry(n,'node','n21'),parent=mainEntry(n,'node','n01').cell.getAttribute('parent');note.cell.setAttribute('parent',parent);geometry(note).setAttribute('y','9000');const e=element(n.document,'mxCell',{id:'far-decoration',vertex:1,parent});e.appendChild(element(n.document,'mxGeometry',{x:10,y:10000,width:100,height:100,as:'geometry'}));n.root.appendChild(e)})
 const added=await patchDrawio(b,[{op:'add_node',node:{id:'local',label:'局部添加',kind:'task',laneId:'r01',phaseId:'p01'}},{op:'add_node',node:{id:'note-a',label:'浮动A'.repeat(80),kind:'note',phaseId:'p01'}},{op:'add_node',node:{id:'note-b',label:'浮动B'.repeat(80),kind:'note',phaseId:'p01'}}]),n=parseNative(added.xml)
 assert.ok(Number(geometry(mainEntry(n,'node','local')).getAttribute('y'))<2000);assert.ok(Number(geometry(mainEntry(n,'phase','p01')).getAttribute('height'))<3000)
 const na=geometry(mainEntry(n,'node','note-a')),nb=geometry(mainEntry(n,'node','note-b'));assert.ok(Number(nb.getAttribute('y'))>=Number(na.getAttribute('y'))+Number(na.getAttribute('height')))
 const p=await projectDrawio(added.xml),b1=await createDrawingProject(p.content,added,{createdAt:1,updatedAt:2}),grown=await patchDrawio(b1,[{op:'update_node',id:'n02',changes:{label:'需要在规定时间内完成申请资料与目标的复核并确认后续执行事项。'.repeat(12)}}]),g=parseNative(grown.xml)
 assert.ok(Number(geometry(mainEntry(g,'node','n02')).getAttribute('height'))>64);assert.equal(geometry(mainEntry(g,'node','n21')).getAttribute('y'),'9000');assert.equal(geometry(g.cells.get('far-decoration')!).getAttribute('y'),'10000')
})
test('phase-free swimlanes can add a first phase and remove the last phase with explicit membership updates',async()=>{
 const content={schemaVersion:1 as const,id:'phase-free',title:'可选阶段',kind:'swimlane' as const,nodes:[{id:'a',label:'A',kind:'task' as const,laneId:'one'},{id:'b',label:'B',kind:'task' as const,laneId:'two'}],edges:[{id:'ab',source:'a',target:'b'}],lanes:[{id:'one',label:'甲'},{id:'two',label:'乙'}],phases:[],groups:[]},b=await createDrawingProject(content,await compileDrawio(content),{createdAt:1,updatedAt:1})
 const first=await patchDrawio(b,[{op:'add_container',collection:'phases',item:{id:'p',label:'第一阶段'}},{op:'update_node',id:'a',changes:{phaseId:'p'}},{op:'update_node',id:'b',changes:{phaseId:'p'}}]),p1=await projectDrawio(first.xml),b1=await createDrawingProject(p1.content,first,{createdAt:1,updatedAt:2})
 const operations=JSON.parse(JSON.stringify([{op:'update_node',id:'a',changes:{phaseId:null}},{op:'update_node',id:'b',changes:{phaseId:null}},{op:'remove_container',collection:'phases',id:'p'},{op:'remove_container',collection:'lanes',id:'one',moveTo:'two'}])).map((o:unknown)=>operationSchema.parse(o))
 const last=await patchDrawio(b1,operations),p2=await projectDrawio(last.xml);assert.equal(p2.content.phases.length,0);assert.equal(p2.content.lanes.length,1);assert.equal(p2.content.nodes[0].laneId,'two');assert.ok(!Object.hasOwn(p2.content.nodes[0],'phaseId'));assert.ok(p2.xml.includes('阶段 / 角色'))
})
test('normalization preserves confirmed index gaps after deletions, including unrelated locked identities',async()=>{
 const b=await base();b.rendering.engine.xml=edit(b.rendering.engine.xml,n=>{const e=mainEntry(n,'node','n23');e.cell.setAttribute('style',e.cell.getAttribute('style')+'locked=1;')})
 const removed=await patchDrawio(b,[{op:'remove_node',id:'n16'}]),p=await projectDrawio(removed.xml),stored=await createDrawingProject(p.content,removed,{createdAt:1,updatedAt:2}),old=parseNative(removed.xml),raw=edit(removed.xml,n=>clone(n,mainEntry(n,'node','n01'),'gap-copy'))
 const normalized=await normalizeDrawioEdits(raw,stored),n=parseNative(normalized.xml);assert.equal(serialize(mainEntry(n,'node','n23').object),serialize(mainEntry(old,'node','n23').object));assert.deepEqual((await projectDrawio(normalized.xml)).content,normalized.content)
 const noChange=await normalizeDrawioEdits(removed.xml,stored);assert.equal(drawioRenderSignature(noChange.xml),drawioRenderSignature(removed.xml))
})
