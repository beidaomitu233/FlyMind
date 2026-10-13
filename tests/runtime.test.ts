import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import sharp from 'sharp'
import { DiagramStore, PROJECT_ROOT } from '../server/store'
import { extractContent } from '../src/drawing/core/layers'
import { sampleFor } from '../src/drawing/core/samples'
import {copy} from '../src/drawing/core/model'

test('共享文件存储：并发修改仅成功一次，非法增量修改不改变文件', async()=>{
  const root=await mkdtemp(join(tmpdir(),'flymind-store-'))
  try {
    const store=new DiagramStore(root);await store.init()
    const d=sampleFor('swimlane');d.id='test-version'
    await store.create(d)
    const saved=JSON.parse(await readFile(store.path(d.id),'utf8'));assert.equal(saved.document.schemaVersion,2);assert.ok(saved.document.content);assert.ok(saved.document.rendering);assert.ok(!Object.hasOwn(saved.document.content,'presentation'))
    const results=await Promise.allSettled([
      store.patch(d.id,1,[{op:'set_title',title:'版本 A'}]),
      new DiagramStore(root).patch(d.id,1,[{op:'set_title',title:'版本 B'}])
    ])
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
    assert.equal((await store.get(d.id)).revision,2)
    const before=await readFile(store.path(d.id),'utf8')
    await assert.rejects(store.patch(d.id,2,[{op:'set_title',title:'不应保存'},{op:'remove_container',collection:'lanes',id:'customer'}]),/moveTo/)
    assert.equal(await readFile(store.path(d.id),'utf8'),before)
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
  const transport=new StdioClientTransport({command:process.execPath,args:[join(PROJECT_ROOT,'server/start.mjs')],cwd:PROJECT_ROOT,env:{...env,FLYMIND_DATA_DIR:root,FLYMIND_AUTO_WEB:'0'},stderr:'pipe'})
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
    assert.equal(tools.length,10)
    for(const tool of tools){assert.ok(tool.title);assert.ok(tool.outputSchema);assert.equal(tool.annotations?.openWorldHint,false);assert.equal(typeof tool.annotations?.readOnlyHint,'boolean');assert.equal(typeof tool.annotations?.idempotentHint,'boolean')}
    const create=tools.find(t=>t.name==='create_diagram')!
    const schema=(create.inputSchema.properties as any).content
    assert.equal(schema.additionalProperties,false);assert.ok(schema.properties.nodes.items.properties.label);assert.ok(!schema.properties.nodes.items.properties.x)
    const patch=(tools.find(t=>t.name==='patch_diagram')!.inputSchema.properties as any).operations
    assert.equal(patch.items.oneOf?.length||patch.items.anyOf?.length,11)
    const guide=await call('get_drawing_guide',{kind:'swimlane'})
    assert.ok((guide.content as any[]).some(c=>c.type==='text'&&c.text.includes('expectedRevision')))
    for(const kind of ['swimlane','flowchart','architecture','mindmap','dataflow'] as const){
      const document=sampleFor(kind);document.id='integration-'+kind
      const result=await call('create_diagram',{content:extractContent(document)}),data=result.structuredContent as any
      assert.equal(data.revision,1)
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
    assert.ok((await client.readResource({uri:'flymind://guide'})).contents.length)
  } finally {await client.close();await rm(root,{recursive:true,force:true})}
})
