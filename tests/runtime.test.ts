import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile,writeFile,mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import sharp from 'sharp'
import { DiagramStore, PROJECT_ROOT } from '../server/store'
import { extractContent,projectDocument } from '../src/drawing/core/layers'
import { sampleFor } from '../src/drawing/core/samples'
import {copy} from '../src/drawing/core/model'

test('SQLite 创建时间不可被编辑覆盖，列表最新创建在前',async()=>{
  const root=await mkdtemp(join(tmpdir(),'flymind-dates-'))
  try{const store=new DiagramStore(root);await store.init();const old=sampleFor('flowchart');old.id='old';old.createdAt=1
    const first=await store.create(old);assert.ok(first.createdAt!>1)
    await new Promise(r=>setTimeout(r,8));const next=copy(old);next.id='new';const newest=await store.create(next)
    const changed=copy(first.document);changed.createdAt=Date.now()+100000;changed.title='旧图编辑'
    await store.update('old',1,changed);assert.equal((await store.get('old')).createdAt,first.createdAt)
    assert.ok((await store.list()).findIndex(r=>r.document.id==='new')<(await store.list()).findIndex(r=>r.document.id==='old'));assert.ok(newest.createdAt!>first.createdAt!)
    assert.equal((await readFile(store.databasePath)).subarray(0,15).toString(),'SQLite format 3')
  }finally{await rm(root,{recursive:true,force:true})}
})

test('共享文件存储：并发修改仅成功一次，非法增量修改不改变文件', async()=>{
  const root=await mkdtemp(join(tmpdir(),'flymind-store-'))
  try {
    const store=new DiagramStore(root);await store.init()
    const d=sampleFor('swimlane');d.id='test-version'
    await store.create(d)
    const saved=projectDocument((await store.get(d.id)).document);assert.equal(saved.schemaVersion,2);assert.ok(saved.content);assert.ok(saved.rendering);assert.ok(!Object.hasOwn(saved.content,'presentation'))
    const results=await Promise.allSettled([
      store.patch(d.id,1,[{op:'set_title',title:'版本 A'}]),
      new DiagramStore(root).patch(d.id,1,[{op:'set_title',title:'版本 B'}])
    ])
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
    assert.equal((await store.get(d.id)).revision,2)
    const before=JSON.stringify(await store.get(d.id))
    await assert.rejects(store.patch(d.id,2,[{op:'set_title',title:'不应保存'},{op:'remove_container',collection:'lanes',id:'customer'}]),/moveTo/)
    assert.equal(JSON.stringify(await store.get(d.id)),before)
    await assert.rejects(store.get('../outside'),/图形 ID/)
    const locked=copy((await store.get(d.id)).document);locked.presentation.objects={groups:{pair:['request','screen']},locked:['request'],order:locked.nodes.map(n=>n.id)}
    await store.update(d.id,2,locked);const frozen=await store.get(d.id);assert.ok(frozen.document.presentation.positions.request.width)
    await assert.rejects(store.patch(d.id,3,[{op:'update_node',id:'request',changes:{label:'不应修改'}}]),/锁定/)
    await assert.rejects(store.patch(d.id,3,[{op:'remove_node',id:'request'}]),/锁定/)
    await assert.rejects(store.patch(d.id,3,[{op:'set_node_presentation',id:'request',position:{x:0}}]),/锁定/)
    const enlarged=await store.patch(d.id,3,[{op:'add_node',node:{id:'new',label:'增加步骤',kind:'task',laneId:'customer',phaseId:'intake'}}]);assert.deepEqual(enlarged.document.presentation.positions.request,frozen.document.presentation.positions.request)
    // Undoing a lock restores the preceding rendering snapshot and unlocks it.
    const unlocked=copy(locked);unlocked.presentation.objects!.locked=[]
    await store.update(d.id,4,unlocked);assert.equal((await store.get(d.id)).revision,5)
  } finally {await rm(root,{recursive:true,force:true})}
})

test('真实 STDIO MCP：发现工具、读取规则、生成五类图片、读改与冲突保护', async()=>{
  const root=await mkdtemp(join(tmpdir(),'flymind-mcp-'))
  const env=Object.fromEntries(Object.entries(process.env).filter((v):v is [string,string]=>typeof v[1]==='string'))
  const transport=new StdioClientTransport({command:process.execPath,args:[join(PROJECT_ROOT,'lib/server/mcp-legacy.js')],cwd:PROJECT_ROOT,env:{...env,FLYMIND_DATA_DIR:root,FLYMIND_AUTO_WEB:'0'},stderr:'pipe'})
  const client=new Client({name:'flymind-integration-test',version:'1.0.0'})
  let diagnostics='';transport.stderr?.on('data',b=>diagnostics+=b.toString())
  const call=async(name:string,args:Record<string,unknown>)=>{
    const result=await client.callTool({name,arguments:args})
    assert.ok(!result.isError,JSON.stringify(result.content)+'\n'+diagnostics)
    return result
  }
  try {
    await client.connect(transport)
    const tools=(await client.listTools()).tools
    assert.equal(tools.length,18)
    for(const tool of tools){assert.ok(tool.title);assert.ok(tool.outputSchema);assert.equal(tool.annotations?.openWorldHint,false);assert.equal(typeof tool.annotations?.readOnlyHint,'boolean');assert.equal(typeof tool.annotations?.idempotentHint,'boolean')}
    const create=tools.find(t=>t.name==='create_diagram')!
    const schema=(create.inputSchema.properties as any).content
    assert.equal(schema.additionalProperties,false);assert.ok(schema.properties.nodes.items.properties.label);assert.ok(!schema.properties.nodes.items.properties.x)
    assert.match(schema.properties.edges.items.properties.kind.description,/feedback/)
    assert.match(schema.properties.nodes.items.properties.description.description,/不塞参数预算或连续步骤/)
    const patch=(tools.find(t=>t.name==='patch_diagram')!.inputSchema.properties as any).operations
    assert.equal(patch.items.oneOf?.length||patch.items.anyOf?.length,11)
    const guide=await call('get_drawing_guide',{kind:'swimlane'})
    assert.equal((guide.structuredContent as any).standardVersion,'1.1');assert.ok((guide.structuredContent as any).guide.includes('绘图内容标准 1.1'))
    const standard=await client.readResource({uri:'flymind://drawing-standard'});assert.ok((standard.contents[0] as any).text.includes('每次绘制与修改'))
    const qualityDraft=sampleFor('flowchart');qualityDraft.id='quality-draft';qualityDraft.nodes[0].label='大段说明'.repeat(30)
    const validation=(await call('validate_diagram',{content:extractContent(qualityDraft)})).structuredContent as any;assert.equal(validation.valid,false);assert.ok(validation.quality.issues.some((i:any)=>i.code==='long_label'))
    const rejected=await client.callTool({name:'create_diagram',arguments:{content:extractContent(qualityDraft)}});assert.equal(rejected.isError,true);assert.equal(JSON.parse((rejected.content as any[])[0].text).error.code,'QUALITY_FAILED');await assert.rejects(new DiagramStore(root).get('quality-draft'))
    qualityDraft.nodes[0].label='开始';await call('create_diagram',{content:extractContent(qualityDraft)})
    const annotation=await client.callTool({name:'patch_diagram',arguments:{id:qualityDraft.id,expectedRevision:1,operations:[{op:'add_node',node:{id:'just-explanation',label:'需要调整审批流程',kind:'note'}}]}});assert.equal(annotation.isError,true);assert.match((annotation.content as any[])[0].text,/annotation_only_change/);assert.equal((await new DiagramStore(root).get(qualityDraft.id)).revision,1)
    await call('patch_diagram',{id:qualityDraft.id,expectedRevision:1,editIntent:'annotation',operations:[{op:'add_node',node:{id:'requested-note',label:'用户要求的批注',kind:'note'}}]})
    const group=(await call('create_workspace_group',{name:'MCP 项目'})).structuredContent as any
    assert.equal(group.group.name,'MCP 项目')
    assert.ok((guide.content as any[]).some(c=>c.type==='text'&&c.text.includes('expectedRevision')))
    assert.ok((guide.structuredContent as any).guide.includes('MCP 输入规则：先后、分支和回流'))
    assert.ok((guide.structuredContent as any).sample.edges.some((e:any)=>e.kind==='feedback'))
    for(const kind of ['swimlane','flowchart','architecture','mindmap','dataflow'] as const){
      const document=sampleFor(kind);document.id='integration-'+kind
      const result=await call('create_diagram',{content:extractContent(document),workspaceGroupId:group.group.id}),data=result.structuredContent as any
      assert.equal(data.workspaceGroupId,group.group.id);assert.equal(typeof data.updatedAt,'number')
      assert.equal(data.revision,1)
      assert.ok(data.exportedAt>=data.updatedAt);assert.equal(data.quality.passed,true)
      assert.equal(typeof data.createdAt,'number')
      const png=(result.content as any[]).find(c=>c.type==='image')
      assert.ok(png&&png.mimeType==='image/png')
      const info=await sharp(Buffer.from(png.data,'base64')).metadata()
      assert.ok(info.width!>100&&info.height!>100&&info.width!<=4096&&info.height!<=4096)
      assert.ok((await readFile(data.files.svg,'utf8')).includes('data-node-id'))
      assert.ok((await readFile(data.files.drawio,'utf8')).includes('<mxfile'))
      assert.equal(JSON.parse(await readFile(data.files.json,'utf8')).id,document.id)
      const content=JSON.parse(await readFile(data.files.json,'utf8'));assert.ok(!Object.hasOwn(content,'presentation'));assert.ok(content.nodes.every((n:any)=>!Object.hasOwn(n,'order')))
      const workspace=JSON.parse(await readFile(data.files['project.json'],'utf8'));assert.equal(workspace.schemaVersion,2);assert.deepEqual(workspace.content,content)
      assert.ok(data.editorUrl.includes('diagram='+document.id))
      const linked=(result.content as any[]).find(c=>c.type==='resource_link'&&c.uri===data.resources.json)
      assert.ok(linked)
      const resource=await client.readResource({uri:linked.uri})
      assert.equal(JSON.parse((resource.contents[0] as any).text).id,document.id)
      const imageResource=await client.readResource({uri:data.resources.png})
      assert.equal((imageResource.contents[0] as any).mimeType,'image/png');assert.equal((imageResource.contents[0] as any).blob,png.data)
    }
    const grouped=(await call('list_diagrams',{workspaceGroupId:group.group.id,sortBy:'created'})).structuredContent as any
    assert.equal(grouped.diagrams.length,5)
    assert.equal(((await call('list_workspace_groups',{})).structuredContent as any).groups.length,1)
    const renamed=(await call('rename_workspace_group',{id:group.group.id,expectedRevision:1,name:'项目已改名'})).structuredContent as any
    assert.equal(renamed.group.revision,2)
    await call('move_diagram_to_group',{id:'integration-flowchart',workspaceGroupId:null,expectedWorkspaceGroupId:group.group.id})
    const staleMove=await client.callTool({name:'move_diagram_to_group',arguments:{id:'integration-flowchart',workspaceGroupId:group.group.id,expectedWorkspaceGroupId:group.group.id}});assert.equal(staleMove.isError,true)
    await call('delete_workspace_group',{id:group.group.id,expectedRevision:2})
    assert.equal(((await call('get_diagram',{id:'integration-swimlane'})).structuredContent as any).workspaceGroupId,null)
    const latest=await call('get_diagram',{id:'integration-swimlane'})
    const data=latest.structuredContent as any
    const changed=await call('patch_diagram',{id:data.diagramId,expectedRevision:data.revision,operations:[{op:'update_node',id:'request',changes:{label:'AI 再次修改'}}]})
    assert.equal((changed.structuredContent as any).revision,2)
    const conflict=await client.callTool({name:'patch_diagram',arguments:{id:data.diagramId,expectedRevision:1,operations:[{op:'set_title',title:'过期覆盖'}]}})
    assert.equal(conflict.isError,true)
    const error=JSON.parse((conflict.content as any[])[0].text).error;assert.equal(error.code,'CONFLICT');assert.equal(error.currentRevision,2)
    const after=(await call('get_diagram',{id:data.diagramId})).structuredContent as any
    assert.equal(after.content.nodes.find((n:any)=>n.id==='request').label,'AI 再次修改')
    assert.equal(after.content.title,data.title)
    const config=(await call('get_rendering_config',{id:data.diagramId})).structuredContent as any
    const exported=await call('export_diagram',{id:data.diagramId}),secondExport=await call('export_diagram',{id:data.diagramId});assert.notEqual((exported.structuredContent as any).files.png,(secondExport.structuredContent as any).files.png);assert.equal((secondExport.structuredContent as any).updatedAt,(exported.structuredContent as any).updatedAt)
    const configured=await call('configure_rendering',{id:data.diagramId,expectedRevision:config.revision,rendering:{...config.rendering,nodeDefaults:{task:{width:250,height:100,shape:'rounded'}},edgeDefaults:{route:'straight'}}})
    assert.equal((configured.structuredContent as any).revision,3)
    const contentAfter=(await call('get_diagram',{id:data.diagramId})).structuredContent as any;assert.deepEqual(contentAfter.content,after.content);assert.ok(!Object.hasOwn(contentAfter,'document'))
    contentAfter.content.nodes[0].label='只修改内容'
    await call('update_diagram',{id:data.diagramId,expectedRevision:3,content:contentAfter.content})
    const configAfter=(await call('get_rendering_config',{id:data.diagramId})).structuredContent as any;assert.equal(configAfter.rendering.nodeDefaults.task.width,250);assert.equal(configAfter.rendering.edgeDefaults.route,'straight')
    const mixed=await client.callTool({name:'create_diagram',arguments:{content:{...contentAfter.content,id:'mixed-invalid',presentation:{positions:{}}}}});assert.equal(mixed.isError,true)
    const mixedPatch=await client.callTool({name:'patch_diagram',arguments:{id:data.diagramId,expectedRevision:4,operations:[{op:'update_node',id:'request',changes:{order:1}}]}});assert.equal(mixedPatch.isError,true)
    assert.equal(((await call('get_diagram',{id:data.diagramId})).structuredContent as any).revision,4)
    const visual=(await call('get_rendering_config',{id:data.diagramId})).structuredContent as any
    visual.rendering.objects={groups:{pair:['request','screen']},locked:['request'],order:contentAfter.content.nodes.map((n:any)=>n.id)}
    await call('configure_rendering',{id:data.diagramId,expectedRevision:4,rendering:visual.rendering})
    const lockedConfig=(await call('get_rendering_config',{id:data.diagramId})).structuredContent as any
    assert.ok(lockedConfig.rendering.positions.request.width);assert.equal(lockedConfig.rendering.objects.groups.pair.length,2)
    const blocked=await client.callTool({name:'patch_diagram',arguments:{id:data.diagramId,expectedRevision:5,operations:[{op:'update_node',id:'request',changes:{label:'不应覆盖锁定对象'}}]}})
    assert.equal(blocked.isError,true);assert.match((blocked.content as any[])[0].text,/锁定/)
    lockedConfig.rendering.objects.locked=[]
    await call('configure_rendering',{id:data.diagramId,expectedRevision:5,rendering:lockedConfig.rendering})
    const unlocked=await call('patch_diagram',{id:data.diagramId,expectedRevision:6,operations:[{op:'update_node',id:'request',changes:{label:'解锁后 AI 修改'}}]})
    assert.equal((unlocked.structuredContent as any).revision,7)
    const isolated=new DiagramStore(root);await isolated.delete(data.diagramId,7)
    const trash=((await call('list_deleted_diagrams',{})).structuredContent as any).diagrams.find((d:any)=>d.id===data.diagramId)
    const restored=await call('restore_diagram',{id:trash.id,expectedRevision:trash.revision,deletedAt:trash.deletedAt});assert.equal((restored.structuredContent as any).revision,8);assert.ok((restored.content as any[]).some(c=>c.type==='image'))
    await isolated.delete(data.diagramId,8);const deleted=((await call('list_deleted_diagrams',{})).structuredContent as any).diagrams.find((d:any)=>d.id===data.diagramId)
    await call('permanently_delete_diagram',{id:deleted.id,expectedRevision:deleted.revision,deletedAt:deleted.deletedAt});assert.ok(!((await call('list_deleted_diagrams',{})).structuredContent as any).diagrams.some((d:any)=>d.id===data.diagramId))
    assert.ok((await client.readResource({uri:'flymind://guide'})).contents.length)
  } finally {await client.close();await rm(root,{recursive:true,force:true})}
})
