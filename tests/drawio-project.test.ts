import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {DOMParser,XMLSerializer} from '@xmldom/xmldom'
import type {DiagramContent} from '../src/drawing/core/model'
import {validateContent} from '../src/drawing/core/layers'
import {inspectDrawing} from '../src/drawing/core/drawing-quality'
import {canonicalContentJson,contentHash} from '../src/drawing/engine/content-hash'
import {createDrawingProject,validateDrawingProject,validateRenderingPreferences} from '../src/drawing/engine/project'
import {compileDrawio} from '../src/drawing/engine/drawio'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION,DEFAULT_SWIMLANE_PROFILE} from '../src/drawing/engine/constants'

const copy=<T>(value:T):T=>structuredClone(value)
async function fixture(name:string):Promise<DiagramContent>{
  return validateContent(JSON.parse(await readFile(new URL(`./fixtures/drawio-baseline/${name}.content.json`,import.meta.url),'utf8')))
}
const minimal:DiagramContent={schemaVersion:1,id:'project-test',title:'受理流程',kind:'swimlane',nodes:[
  {id:'start',label:'接入请求',kind:'start',laneId:'owner',phaseId:'intake'},
  {id:'done',label:'办理结束',kind:'end',laneId:'owner',phaseId:'intake'},
],edges:[{id:'next',source:'start',target:'done'}],lanes:[{id:'owner',label:'办理人'}],phases:[{id:'intake',label:'受理阶段'}],groups:[]}
const fixedTime={createdAt:1_700_000_000_000,updatedAt:1_700_000_000_123}
const compiledMinimal=()=>compileDrawio(copy(minimal))

test('content SHA-256 sorts object keys, preserves arrays and matches the standard digest',async()=>{
  const reordered=Object.fromEntries(Object.entries(minimal).reverse()) as unknown as DiagramContent
  reordered.nodes=minimal.nodes.map(n=>Object.fromEntries(Object.entries(n).reverse())) as DiagramContent['nodes']
  assert.equal(await contentHash(minimal),await contentHash(reordered))
  assert.equal(await contentHash(minimal),createHash('sha256').update(canonicalContentJson(minimal)).digest('hex'))
  assert.notEqual(await contentHash(minimal),await contentHash({...minimal,nodes:[...minimal.nodes].reverse()}))
  assert.equal(await contentHash(minimal),await contentHash({...minimal,nodes:minimal.nodes.map(n=>({...n,description:undefined}))}))
  assert.notEqual(await contentHash(minimal),await contentHash({...minimal,title:'另一项业务'}))
})

test('canonical content refuses non-JSON values rather than silently changing their meaning',()=>{
  const cycle:any={...minimal};cycle.self=cycle
  assert.throws(()=>canonicalContentJson(cycle),/cycles/)
  for(const invalid of [NaN,Infinity,BigInt(1),new Date(),()=>1])assert.throws(()=>canonicalContentJson({...minimal,extra:invalid} as any),/JSON|finite/)
  assert.throws(()=>canonicalContentJson({...minimal,nodes:new Array(1)}),/sparse/)
  assert.throws(()=>canonicalContentJson({...minimal,[Symbol('extra')]:1}),/JSON/)
})

test('v3 project roundtrip retains swimlane content, metadata times and visual standards without mutating inputs',async()=>{
  const content=await fixture('swimlane'),before=JSON.stringify(content)
  const preferences={theme:'forest' as const,orientation:'vertical' as const,nodeDefaults:{task:{width:220,height:88,fontSize:18,fill:'#ffffff'}},edgeDefaults:{route:'orthogonal' as const,width:2,dashed:false}}
  const engine=await compileDrawio(content,{preferences}),engineBefore=JSON.stringify(engine)
  const project=await createDrawingProject(content,engine,{...fixedTime,preferences})
  assert.equal(project.schemaVersion,3)
  assert.deepEqual(project.content,content)
  assert.deepEqual(project.rendering.preferences,preferences)
  assert.deepEqual(project.rendering.profile,DEFAULT_SWIMLANE_PROFILE)
  assert.equal(project.rendering.engine.version,DRAWIO_VERSION)
  assert.equal(project.rendering.engine.adapterVersion,DRAWIO_ADAPTER_VERSION)
  assert.equal(project.createdAt,fixedTime.createdAt)
  assert.equal(project.updatedAt,fixedTime.updatedAt)
  assert.deepEqual(await validateDrawingProject(project),project)
  assert.deepEqual(await validateDrawingProject(JSON.parse(JSON.stringify(project))),project)
  const changing=copy(project),pending=validateDrawingProject(changing)
  changing.rendering.engine.xml='changed during validation'
  changing.rendering.engine.contentHash='0'.repeat(64)
  changing.content.nodes[0].label='changed during validation'
  assert.deepEqual(await pending,project)
  assert.equal(JSON.stringify(content),before)
  assert.equal(JSON.stringify(engine),engineBefore)
  preferences.nodeDefaults.task.width=333
  content.nodes[0].label='外部对象后续修改'
  engine.xml='外部对象后续修改'
  assert.notEqual(project.content.nodes[0].label,content.nodes[0].label)
  assert.notEqual(project.rendering.engine.xml,engine.xml)
  assert.equal(project.rendering.preferences.nodeDefaults!.task!.width,220)
})

test('PBS existing quality failures remain structurally valid manual draft content',async()=>{
  const content=await fixture('pbs-main')
  assert.equal(inspectDrawing(content).passed,false)
  const engine=await compileDrawio(content)
  const project=await createDrawingProject(content,engine,fixedTime)
  assert.deepEqual(project.content,content)
  assert.equal(project.content.nodes.length,23)
  assert.equal(project.content.edges.length,26)
  assert.equal(inspectDrawing(project.content).score,38)
  assert.deepEqual(await validateDrawingProject(project),project)
})

test('create defaults timestamps together and preserves explicitly supplied old times',async()=>{
  const engine=await compiledMinimal(),before=Date.now()
  const fresh=await createDrawingProject(minimal,engine)
  assert.ok(fresh.createdAt>=before&&fresh.createdAt<=Date.now())
  assert.equal(fresh.createdAt,fresh.updatedAt)
  const supplied=await createDrawingProject(minimal,engine,{createdAt:fixedTime.createdAt})
  assert.equal(supplied.updatedAt,fixedTime.createdAt)
  const updatedOnly=await createDrawingProject(minimal,engine,{updatedAt:fixedTime.updatedAt})
  assert.equal(updatedOnly.createdAt,fixedTime.updatedAt)
  assert.equal(updatedOnly.updatedAt,fixedTime.updatedAt)
})

test('formal validation rejects stale hashes and independently reprojects XML even with a fresh claimed hash',async()=>{
  const engine=await compiledMinimal(),project=await createDrawingProject(minimal,engine,fixedTime)
  const stale=copy(project);stale.content.nodes[0].label='变更业务名称'
  await assert.rejects(validateDrawingProject(stale),/Content hash/)
  stale.rendering.engine.contentHash=await contentHash(stale.content)
  await assert.rejects(validateDrawingProject(stale),/projection.*match/)
  const tampered=copy(project),doc=new DOMParser().parseFromString(tampered.rendering.engine.xml,'text/xml')
  const element=Array.from(doc.getElementsByTagName('*')).find(el=>el.getAttribute('fmId')==='start'&&el.getAttribute('fmType')==='node')
  assert.ok(element,'native XML must expose the business binding')
  element.setAttribute('label','篡改后的受理动作')
  tampered.rendering.engine.xml=new XMLSerializer().serializeToString(doc)
  await assert.rejects(validateDrawingProject(tampered),/projection.*match/)
  const invalid=copy(project);invalid.rendering.engine.xml='<not-a-drawio-document/>'
  await assert.rejects(validateDrawingProject(invalid))
})

test('native geometry changes remain solely in XML and survive project validation verbatim',async()=>{
  const project=await createDrawingProject(minimal,await compiledMinimal(),fixedTime)
  const doc=new DOMParser().parseFromString(project.rendering.engine.xml,'text/xml')
  const geometry=doc.getElementsByTagName('mxGeometry')[0]
  assert.ok(geometry)
  geometry.setAttribute('x','721')
  geometry.setAttribute('y','397')
  project.rendering.engine.xml=new XMLSerializer().serializeToString(doc)
  const validated=await validateDrawingProject(project)
  assert.equal(validated.rendering.engine.xml,project.rendering.engine.xml)
  assert.deepEqual(validated.content,minimal)
  assert.deepEqual(validated.rendering.preferences,{})
  assert.equal(validated.updatedAt,fixedTime.updatedAt)
})

test('v3 schema rejects unknown fields at every layer, visual content and invalid references',async()=>{
  const project=await createDrawingProject(minimal,await compiledMinimal(),fixedTime)
  const mutations:Array<(v:any)=>void>=[
    v=>{v.revision=1},v=>{v.workspaceGroupId='a'},v=>{v.rendering.positions={}},
    v=>{v.rendering.profile.extra=true},v=>{v.rendering.engine.other='x'},
    v=>{v.content.positions={}},v=>{v.content.nodes[0].x=10},v=>{v.content.nodes[0].order=1},
    v=>{v.content.edges[0].points=[]},v=>{v.content.lanes[0].width=300},v=>{v.content.phases[0].height=200},
    v=>{v.content.groups=[{id:'g',label:'业务层',position:10}]},v=>{v.content.groups=[{id:'g',label:'业务层',kind:null}]},
    v=>{v.content.nodes[0].laneId='missing'},v=>{v.content.nodes[0].phaseId=null},
    v=>{delete v.content.edges},v=>{delete v.content.id},v=>{delete v.rendering.preferences},
  ]
  for(const mutate of mutations){const invalid=copy(project);mutate(invalid);await assert.rejects(validateDrawingProject(invalid))}
  await assert.rejects(createDrawingProject(minimal,project.rendering.engine,{positions:{}} as any),/options.positions/)
  for(const options of [{profile:null},{preferences:null},{createdAt:null},{updatedAt:null}])await assert.rejects(createDrawingProject(minimal,project.rendering.engine,options as any))
})

test('v3 rejects incompatible format, engine, adapter, profile and malformed timestamps',async()=>{
  const project=await createDrawingProject(minimal,await compiledMinimal(),fixedTime)
  const mutations:Array<(v:any)=>void>=[
    v=>{v.schemaVersion=2},v=>{v.schemaVersion=4},v=>{v.content.schemaVersion=2},
    v=>{v.rendering.engine.name='other'},v=>{v.rendering.engine.version='next'},v=>{v.rendering.engine.adapterVersion='2'},
    v=>{v.rendering.profile.id='unknown'},v=>{v.rendering.profile.version='2'},
    v=>{v.rendering.preferences.orientation='diagonal'},
    v=>{v.rendering.engine.contentHash='invalid'},v=>{v.rendering.engine.xml=''},
    v=>{v.createdAt=0},v=>{v.updatedAt=-1},v=>{v.createdAt=NaN},v=>{v.updatedAt=Infinity},
    v=>{v.updatedAt=1.1},v=>{v.updatedAt=8_640_000_000_000_001},v=>{v.createdAt='2026-10-16'},
    v=>{v.updatedAt=v.createdAt-1},
  ]
  for(const mutate of mutations){const invalid=copy(project);mutate(invalid);await assert.rejects(validateDrawingProject(invalid))}
})

test('preferences accept only visual defaults with precise nested types and bounds',()=>{
  assert.deepEqual(validateRenderingPreferences({}),{})
  assert.deepEqual(validateRenderingPreferences({orientation:'horizontal'}),{orientation:'horizontal'})
  const bad=[
    {content:minimal},{positions:{start:{x:10}}},{ranks:{}},{objects:{}},{styles:{}},{nodes:[]},
    {theme:'missing'},{orientation:'diagonal'},{theme:null},{nodeDefaults:[]},
    {nodeDefaults:{start:{x:10}}},{nodeDefaults:{unknown:{width:100}}},{nodeDefaults:{task:{width:0}}},
    {nodeDefaults:{task:{fontSize:49}}},{nodeDefaults:{task:{shape:'star'}}},{nodeDefaults:{task:{fill:'red'}}},
    {nodeDefaults:{task:{label:'业务内容'}}},{edgeDefaults:{points:[]}},{edgeDefaults:{sourcePort:'left'}},
    {edgeDefaults:{width:9}},{edgeDefaults:{route:'auto'}},{edgeDefaults:{dashed:'true'}},{edgeDefaults:{color:null}},
  ]
  for(const value of bad)assert.throws(()=>validateRenderingPreferences(value))
})

test('fixed swimlane profile rejects unavailable edge routes while general preferences retain the enum',async()=>{
  const engine=await compiledMinimal()
  for(const route of ['straight','curved'] as const){
    const preferences={edgeDefaults:{route}}
    assert.deepEqual(validateRenderingPreferences(preferences),preferences)
    await assert.rejects(createDrawingProject(minimal,engine,{...fixedTime,preferences}),/only orthogonal edge routes/)
    const project=await createDrawingProject(minimal,engine,fixedTime)
    project.rendering.preferences=preferences
    await assert.rejects(validateDrawingProject(project),/only orthogonal edge routes/)
  }
  const project=await createDrawingProject(minimal,engine,{...fixedTime,preferences:{edgeDefaults:{route:'orthogonal'}}})
  assert.equal(project.rendering.preferences.edgeDefaults!.route,'orthogonal')
})

test('fixed profile requires width 64 and supports floating note defaults except shape',async()=>{
  const engine=await compiledMinimal()
  for(const width of [32,63]){
    const preferences={nodeDefaults:{task:{width}}}
    assert.deepEqual(validateRenderingPreferences(preferences),preferences)
    await assert.rejects(createDrawingProject(minimal,engine,{...fixedTime,preferences}),/width of at least 64/)
    const project=await createDrawingProject(minimal,engine,fixedTime)
    project.rendering.preferences=preferences
    await assert.rejects(validateDrawingProject(project),/width of at least 64/)
  }
  const minimum=await createDrawingProject(minimal,engine,{...fixedTime,preferences:{nodeDefaults:{task:{width:64,height:32}}}})
  assert.equal(minimum.rendering.preferences.nodeDefaults!.task!.width,64)
  assert.equal(minimum.rendering.preferences.nodeDefaults!.task!.height,32)
  for(const note of [{shape:'rectangle' as const},{shape:'rounded' as const}]){
    const preferences={nodeDefaults:{note}}
    assert.deepEqual(validateRenderingPreferences(preferences),preferences)
    await assert.rejects(createDrawingProject(minimal,engine,{...fixedTime,preferences}),/does not support note shape defaults/)
    const project=await createDrawingProject(minimal,engine,fixedTime)
    project.rendering.preferences=preferences
    await assert.rejects(validateDrawingProject(project),/does not support note shape defaults/)
  }
  const content:DiagramContent={...copy(minimal),nodes:[...copy(minimal.nodes),{id:'memo',label:'浮动业务说明',kind:'note'}]}
  const preferences={nodeDefaults:{note:{width:180,height:64,fontSize:19,fill:'#ffffff',stroke:'#123456',textColor:'#654321'}}}
  const native=await compileDrawio(content,{preferences})
  const noteProject=await createDrawingProject(content,native,{...fixedTime,preferences})
  assert.deepEqual(noteProject.rendering.preferences,preferences)
  assert.deepEqual(noteProject.content,content)
  assert.deepEqual(await validateDrawingProject(noteProject),noteProject)
  assert.deepEqual((await createDrawingProject(minimal,engine,{...fixedTime,preferences:{nodeDefaults:{note:{}}}})).rendering.preferences,{nodeDefaults:{note:{}}})
})
