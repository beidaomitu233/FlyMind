import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {EXPORT_FORMATS as lightweight} from '../server/exports/formats'
import {EXPORT_FORMATS as original} from '../server/exports/types'
import {drawingStandard} from '../server/drawing-guide'
import {createNativeMcpServer} from '../server/mcp-native/server'

test('SDK guide, ordered export formats, resource access and authorization remain compatible',async()=>{
 assert.strictEqual(original,lightweight)
 assert.deepEqual(lightweight,['png','svg','drawio','json','project.json'])
 let denied=false
 const files=Object.fromEntries(lightweight.map(format=>[format,{bytes:3,url:'/file/'+format,filename:'file.'+format,sha256:'0'.repeat(64),mediaType:'application/octet-stream'}]))
 const server=await createNativeMcpServer(async()=>({
  baseURL:'http://127.0.0.1:5179',dataRootId:'root',instanceId:'instance',sessionToken:'test-only',capabilities:{} as never,headers:()=>({}),
  authenticatedFetch:async(path:string)=>denied?Response.json({code:'LOCAL_LOGIN_REQUIRED'}, {status:401}):path==='/studio-api/native/exports/job'?Response.json({id:'job',diagramId:'diagram',revision:1,dataRootId:'root',status:'succeeded',files}):new Response('abc'),
  close:async()=>{},
 }),{})
 const [a,b]=InMemoryTransport.createLinkedPair(),client=new Client({name:'fixed-sdk-test',version:'1'})
 try{
  await server.server.connect(a);await client.connect(b)
  assert.ok(client.getInstructions()!.includes(await drawingStandard()))
  const guide=await client.callTool({name:'get_drawing_guide',arguments:{kind:'flowchart'}})
  assert.equal(guide.isError,undefined);assert.equal((guide.structuredContent as any).standardVersion,'1.1')
  for(const format of lightweight){
   const resource=await client.readResource({uri:`flymind://exports/diagram/1/job/${format}`})
   assert.equal(resource.contents.length,1)
   assert.equal(format==='png'?Buffer.from(String((resource.contents[0] as any).blob),'base64').toString():(resource.contents[0] as any).text,'abc')
  }
  await assert.rejects(client.readResource({uri:'flymind://exports/diagram/1/job/unknown'}))
  denied=true
  await assert.rejects(client.readResource({uri:'flymind://exports/diagram/1/job/svg'}),/LOCAL_LOGIN_REQUIRED|flymind login/)
 }finally{await client.close();await server.close()}
})
