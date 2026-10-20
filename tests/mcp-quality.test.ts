import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {extractContent} from '../src/drawing/core/layers'
import {sampleFor} from '../src/drawing/core/samples'

test('legacy real STDIO validates 1.1 and create/patch/update reject quality issues without changing temporary records',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-quality-legacy-'))
 const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','server/mcp-legacy.ts'],cwd:process.cwd(),env:{...Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),FLYMIND_DATA_DIR:root,FLYMIND_NATIVE_PILOT:'0',FLYMIND_AUTO_WEB:'0'},stderr:'pipe'})
 const client=new Client({name:'quality-legacy-test',version:'1'})
 try{
  await client.connect(transport)
  const guide=await client.callTool({name:'get_drawing_guide',arguments:{}});assert.equal((guide.structuredContent as any).standardVersion,'1.1');assert.match((guide.structuredContent as any).guide,/架构.*依赖/)
  const content=extractContent(sampleFor('flowchart'));content.id='bad-component';content.nodes.find(n=>n.kind==='task')!.label='Redis'
  const validation=await client.callTool({name:'validate_diagram',arguments:{content}});assert.equal((validation.structuredContent as any).valid,false);assert.equal(Object.hasOwn(validation.structuredContent!,'width'),false);assert.ok((validation.structuredContent as any).quality.issues.some((i:any)=>i.code==='component_as_task'))
  const before=await client.callTool({name:'list_diagrams',arguments:{}})
  const created=await client.callTool({name:'create_diagram',arguments:{content}});assert.equal(created.isError,true);assert.match(JSON.stringify(created),/QUALITY_FAILED/)
  const base=extractContent(sampleFor('flowchart'));base.nodes.find(n=>n.kind==='task')!.items=['说明塞入条目']
  const updated=await client.callTool({name:'update_diagram',arguments:{id:'sample-flowchart',expectedRevision:1,content:base}});assert.equal(updated.isError,true)
  const patched=await client.callTool({name:'patch_diagram',arguments:{id:'sample-flowchart',expectedRevision:1,operations:[{op:'add_node',node:{id:'note-bypass',kind:'note',label:'这里应该有额外处理'}},{op:'update_edge',id:'fe0',changes:{label:'继续处理'}}]}});assert.equal(patched.isError,true);assert.match(JSON.stringify(patched),/annotation_only_change/)
  const after=await client.callTool({name:'list_diagrams',arguments:{}});assert.deepEqual(after.structuredContent,before.structuredContent)
 }finally{await client.close();await transport.close();await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100})}
})
