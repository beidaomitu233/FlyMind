import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer,type Server} from 'node:http'
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import express from 'express'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {createCloudHTTP} from '../server/cloud/http'
import {CloudControlPlane,type CloudPrincipal} from '../server/cloud/identity'
import {createCloudMcpSession} from '../server/cloud/mcp'
import {createCloudMcpConnection} from '../server/cloud/mcp-connection'
import {NativeDrawioRenderer} from '../server/rendering/renderer'
import {runtimeCapabilities} from '../server/runtime-instance/config'
import {VERSION} from '../server/version'
import {businessContent} from './fixtures/native-business'

const token='cloud_mcp_test_session_abcdefghijklmnopqrstuvwxyz_0123456789'
const principal=():CloudPrincipal=>({user:{id:'alice',name:'Alice'},session:{id:'session-a',expiresAt:Date.now()+600000},team:{id:'team-a',name:'A',role:'editor'}})
async function listen(server:Server){await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+(server.address() as any).port}
async function stop(server:Server){const done=new Promise<void>(r=>server.close(()=>r()));server.closeAllConnections();await done}

test('fixed cloud connection rejects cross-team paths, credential overrides, principal/root rebinding and redirects',async()=>{
 let current=principal(),root='root-a',calls=0
 const adapter=await createCloudMcpConnection({cloudOrigin:'https://cloud.example',teamId:'team-a',token,identity:{authorize:async()=>current},fetch:async(input,init)=>{
  calls++;assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer '+token)
  assert.equal(String(input),'https://cloud.example/cloud-api/teams/team-a/studio-api/health')
  return Response.json({name:'flymind',version:VERSION,storage:'sqlite',dataRootId:root,capabilities:runtimeCapabilities()})
 }})
 assert.ok(!JSON.stringify(adapter.binding).includes(token));assert.ok(!JSON.stringify(adapter.connection).includes(token))
 for(const path of ['https://attacker.invalid/','//attacker.invalid/','/cloud-api/teams/team-b/studio-api/native/records','/studio-api/native/../../health','/studio-api/native/%2e%2e/health'])await assert.rejects(adapter.connection.authenticatedFetch(path))
 for(const name of ['Authorization','X-FlyMind-DataRoot-Id','Cookie','Host'])await assert.rejects(adapter.connection.authenticatedFetch('/studio-api/health',{headers:{[name]:'override'}}))
 assert.equal(calls,1)
 current={...principal(),user:{id:'bob',name:'Bob'}};await assert.rejects(adapter.checkHealth(),/不能改绑/)
 current={...principal(),session:{id:'new-session',expiresAt:Date.now()+600000}};await assert.rejects(adapter.checkHealth(),/不能改绑/)
 current={...principal(),team:{id:'team-b',name:'B',role:'editor'}};await assert.rejects(adapter.checkHealth(),/不能改绑/)
 current=principal();root='root-b';await assert.rejects(adapter.checkHealth(),/不能改绑/)
 await adapter.close();await assert.rejects(adapter.checkHealth(),/已关闭/)
})

test('real Streamable HTTP SDK uses Java authorization and team native HTTP for guide, PNG creation, patch and resources', {timeout:120000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-cloud-mcp-'))
 const started=Date.now()
 let revoked=false,introspections=0
 const authority=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk
  res.setHeader('Content-Type','application/json')
  if(req.url!=='/app/flymind/session/introspect'||req.headers.authorization!=='Bearer '+token||revoked){res.statusCode=401;res.end(JSON.stringify({code:401,errorCode:'LOGIN_REQUIRED',message:'已撤权'}));return}
  introspections++;const team=JSON.parse(raw).teamId
  res.end(JSON.stringify({code:200,data:{...principal(),team:{id:team,name:team,role:'editor'}}}))
 })
 const control=await listen(authority),identity=new CloudControlPlane(control,{allowInsecureLoopback:true})
 const app=express(),http=createServer(app),base=await listen(http)
 const cloud=createCloudHTTP({controlPlaneURL:control,cloudDataRoot:join(root,'teams-data'),publicOrigin:base,allowInsecureLoopback:true,renderer:new NativeDrawioRenderer(),serveAssets:false})
 let session:Awaited<ReturnType<typeof createCloudMcpSession>>|undefined
 // Test host only. The production cloud HTTP entry has no /mcp route.
 app.use('/mcp',express.json({limit:'4mb'}),(req,res)=>{void session!.handleRequest(req,res,req.body)})
 app.use(cloud.app)
 const client=new Client({name:'cloud-sdk-test',version:'1'})
 const clientTransport=new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}})
 try{
  const unopened=await fetch(base+'/mcp-unmounted',{headers:{Authorization:'Bearer '+token}});assert.equal(unopened.status,404)
  session=await createCloudMcpSession({cloudOrigin:base,teamId:'team-a',token,identity,allowInsecureLoopback:true,waitMs:60000,pollMs:100})
  assert.deepEqual(Object.keys(session.binding).sort(),['dataRootId','sessionId','teamId','userId'])
  await client.connect(clientTransport)
  const before=introspections,guide=await client.callTool({name:'get_drawing_guide',arguments:{kind:'flowchart'}})
  assert.ok(!guide.isError);assert.ok(introspections>=before+2,'even local guide must traverse authority and cloud HTTP')
  const created=await client.callTool({name:'create_diagram',arguments:{taskName:'云端契约回归任务',content:businessContent('flowchart','cloud-mcp-diagram'),requestId:'sdk-create'}})
  assert.ok(!created.isError,JSON.stringify(created));const data=created.structuredContent as any
  assert.ok(data.workspaceGroupId,'real SDK creation must return its task group')
  const taskGroups=await client.callTool({name:'list_workspace_groups',arguments:{}})
  assert.ok(!taskGroups.isError)
  assert.ok((taskGroups.structuredContent as any).groups.some((group:any)=>group.id===data.workspaceGroupId&&group.name==='云端契约回归任务'))
  assert.equal(data.revision,1);assert.equal(data.exportStatus,'succeeded',JSON.stringify(data));assert.ok(created.content.some((c:any)=>c.type==='image'&&Buffer.from(c.data,'base64').subarray(1,4).toString()==='PNG'))
  assert.equal(data.editorUrl,base+'/#/cloud?team=team-a&diagram=cloud-mcp-diagram');assert.ok(!JSON.stringify(created).includes(token))
  const got=await client.callTool({name:'get_diagram',arguments:{id:data.diagramId}});assert.equal((got.structuredContent as any).revision,1)
  const changed=await client.callTool({name:'patch_diagram',arguments:{id:data.diagramId,expectedRevision:1,requestId:'sdk-patch',editIntent:'wording',operations:[{op:'update_node',id:'task',changes:{label:'复核申请资料'}}]}})
  assert.ok(!changed.isError,JSON.stringify(changed));const updated=changed.structuredContent as any
  assert.equal(updated.revision,2);assert.equal(updated.exportStatus,'succeeded');assert.equal(updated.content.nodes.find((n:any)=>n.id==='task').label,'复核申请资料')
  const artifact=await client.readResource({uri:updated.resources.png});assert.equal(Buffer.from((artifact.contents[0] as any).blob,'base64').subarray(1,4).toString(),'PNG')
  assert.ok(Object.values(updated.urls).every(url=>String(url).startsWith(base+'/cloud-api/teams/team-a/')))
  const authHeaders={Authorization:'Bearer '+token}
  const bHealth=await (await fetch(base+'/cloud-api/teams/team-b/studio-api/health',{headers:authHeaders})).json() as any
  const other=await fetch(base+'/cloud-api/teams/team-b/studio-api/native/diagrams',{method:'POST',headers:{...authHeaders,'Content-Type':'application/json','X-FlyMind-DataRoot-Id':bHealth.dataRootId},body:JSON.stringify({requestId:'team-b-create',content:businessContent('flowchart','only-team-b')})});assert.equal(other.status,201)
  const denied=await client.callTool({name:'get_diagram',arguments:{id:'only-team-b'}});assert.equal(denied.isError,true)
  const cross=await fetch(String(updated.urls.png).replace('/team-a/','/team-b/'),{headers:authHeaders});assert.equal(cross.status,404)
  const badCredential=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token+'other','Content-Type':'application/json'},body:'{}'});assert.equal(badCredential.status,401)
  revoked=true
  const revokedHTTP=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});assert.equal(revokedHTTP.status,401)
  await assert.rejects(client.callTool({name:'get_drawing_guide',arguments:{}}),/LOGIN_REQUIRED/)
  await assert.rejects(client.readResource({uri:updated.resources.png}),/LOGIN_REQUIRED/)
  const png=Buffer.from((artifact.contents[0] as any).blob,'base64'),out=process.env.FLYMIND_PROBE_OUTPUT??'output/playwright/cloud-mcp'
  await mkdir(out,{recursive:true});await writeFile(join(out,'report.json'),JSON.stringify({status:'ok',transport:'SDK 1.32.1 StreamableHTTP',binding:session.binding,revisions:[data.revision,updated.revision],png:{bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')},editorURLPattern:'/#/cloud?team=<id>&diagram=<id>',crossTeamStatus:cross.status,wrongCredentialStatus:badCredential.status,revokedStatus:revokedHTTP.status,introspections,elapsedMs:Date.now()-started,productionMcpMounted:false},null,2))
 }finally{
  await client.close().catch(()=>{});await session?.close();await stop(http);await cloud.close();await stop(authority)
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})
 }
})
