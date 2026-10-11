import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import sharp from 'sharp'
import { DiagramStore, PROJECT_ROOT } from '../server/store'
import { sampleFor } from '../src/drawing/core/samples'

test('共享文件存储：并发修改仅成功一次，非法增量修改不改变文件', async()=>{
  const root=await mkdtemp(join(tmpdir(),'flymind-store-'))
  try {
    const store=new DiagramStore(root);await store.init()
    const d=sampleFor('swimlane');d.id='test-version'
    await store.create(d)
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
    assert.equal((await client.listTools()).tools.length,8)
    const guide=await call('get_drawing_guide',{kind:'swimlane'})
    assert.ok((guide.content as any[]).some(c=>c.type==='text'&&c.text.includes('expectedRevision')))
    for(const kind of ['swimlane','flowchart','architecture','mindmap','dataflow'] as const){
      const document=sampleFor(kind);document.id='integration-'+kind
      const result=await call('create_diagram',{document}),data=result.structuredContent as any
      assert.equal(data.revision,1)
      const png=(result.content as any[]).find(c=>c.type==='image')
      assert.ok(png&&png.mimeType==='image/png')
      const info=await sharp(Buffer.from(png.data,'base64')).metadata()
      assert.ok(info.width!>100&&info.height!>100&&info.width!<=4096&&info.height!<=4096)
      assert.ok((await readFile(data.files.svg,'utf8')).includes('data-node-id'))
      assert.ok((await readFile(data.files.drawio,'utf8')).includes('<mxfile'))
      assert.equal(JSON.parse(await readFile(data.files.json,'utf8')).id,document.id)
      assert.ok(data.editorUrl.includes('diagram='+document.id))
    }
    const latest=await call('get_diagram',{id:'integration-swimlane'})
    const data=latest.structuredContent as any
    const changed=await call('patch_diagram',{id:data.diagramId,expectedRevision:data.revision,operations:[{op:'update_node',id:'request',changes:{label:'AI 再次修改'}}]})
    assert.equal((changed.structuredContent as any).revision,2)
    const conflict=await client.callTool({name:'patch_diagram',arguments:{id:data.diagramId,expectedRevision:1,operations:[{op:'set_title',title:'过期覆盖'}]}})
    assert.equal(conflict.isError,true)
    const after=(await call('get_diagram',{id:data.diagramId})).structuredContent as any
    assert.equal(after.document.nodes.find((n:any)=>n.id==='request').label,'AI 再次修改')
    assert.equal(after.document.title,data.title)
    assert.ok((await client.readResource({uri:'flymind://guide'})).contents.length)
  } finally {await client.close();await rm(root,{recursive:true,force:true})}
})
