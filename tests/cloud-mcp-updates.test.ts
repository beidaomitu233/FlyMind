import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer,type Server} from 'node:http'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import express from 'express'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {createCloudHTTP} from '../server/cloud/http'
import {createCloudMcpGateway} from '../server/cloud/mcp-gateway'
import {createCloudMcpConnection} from '../server/cloud/mcp-connection'
import {fixedApplicationFetch} from '../server/cloud/mcp-upstream'
import {createCloudReleaseManifest,assertExecutionReleaseAvailable,type CloudReleaseManifest} from '../server/cloud/mcp-compat'
import {runtimeCapabilities} from '../server/runtime-instance/config'
import {NativeDrawioRenderer} from '../server/rendering/renderer'
import {businessContent} from './fixtures/native-business'

const token='fm_mcp_'+'x'.repeat(43),key='qa_gateway_key_'+'z'.repeat(40)
const manifest=(releaseId:string,version:string):CloudReleaseManifest=>({releaseId,appVersion:version,policyBundleHash:'a'.repeat(64),standardVersion:'1.1',engineResourceKey:'b'.repeat(64),adapterVersion:'1',migrationLevel:1})
async function listen(server:Server,port=0){await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>{server.off('error',no);yes()})});return 'http://127.0.0.1:'+(server.address() as {port:number}).port}
async function stop(server:Server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}

test('cloud contract tolerates app releases/capability additions but rejects actual API/root incompatibility',async()=>{
 let health:any={name:'flymind',storage:'sqlite',version:'app-a',dataRootId:'root-a',capabilities:runtimeCapabilities(),mcp:{contractVersions:[1],release:manifest('a','app-a')}}
 const adapter=await createCloudMcpConnection({cloudOrigin:'https://public.example',applicationOrigin:'https://private-app.example',teamId:'team-a',token,identity:{authorize:async()=>({user:{id:'u',name:'u'},session:{id:'grant',expiresAt:Date.now()+60000},team:{id:'team-a',name:'A',role:'editor'}})},fetch:async(url,init)=>{assert.equal(new URL(String(url)).origin,'https://private-app.example');assert.equal(new Headers(init?.headers).get('Host'),'public.example');assert.equal(init?.redirect,'error');return Response.json(health)}})
 try{
  for(const name of ['b','c']){health={...health,version:'app-'+name,capabilities:{...health.capabilities,futureOptionalCapability:true},mcp:{contractVersions:[1,2],release:manifest(name,'app-'+name)}};await adapter.checkHealth();assert.equal(adapter.currentRelease()?.releaseId,name)}
  assert.equal(adapter.resourceURL('/studio-api/native/exports/export-a/files/png'),'https://public.example/cloud-api/teams/team-a/studio-api/native/exports/export-a/files/png')
  assert.throws(()=>adapter.resourceURL('https://private-app.example/secret'))
  health.mcp.contractVersions=[2];await assert.rejects(adapter.checkHealth(),{code:'MCP_CONTRACT_UNSUPPORTED'});health.mcp.contractVersions=[1]
  health.capabilities.apiVersion=2;await assert.rejects(adapter.checkHealth(),{code:'MCP_CAPABILITY_MISMATCH'});health.capabilities.apiVersion=1
  health.dataRootId='other-root';await assert.rejects(adapter.checkHealth(),{code:'WORKSPACE_MISMATCH'})
 }finally{await adapter.close()}
})
test('frozen export metadata permits policy release changes only with matching retained engine/adapter supply',()=>{
 const prior=manifest('a','app-a'),next={...manifest('b','app-b'),policyBundleHash:'c'.repeat(64)}
 assert.doesNotThrow(()=>assertExecutionReleaseAvailable(prior,next))
 assert.throws(()=>assertExecutionReleaseAvailable(prior,{...next,engineResourceKey:'d'.repeat(64)}),{code:'EXPORT_SUPPLY_UNAVAILABLE'})
 assert.throws(()=>assertExecutionReleaseAvailable(prior,{...next,adapterVersion:'2'}),{code:'EXPORT_SUPPLY_UNAVAILABLE'})
})
test('fixed internal HTTP hop preserves the public virtual host, rejects redirects/body overflow and aborts owned request',async()=>{
 let calls=0
 const server=createServer((req,res)=>{calls++;assert.equal(req.headers.host,'public.example');if(req.url==='/redirect'){res.writeHead(302,{Location:'https://untrusted.invalid/'}).end();return}if(req.url==='/wait')return;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}))})
 const base=await listen(server)
 try{
  const response=await fixedApplicationFetch(new URL('/ok',base),{headers:{Host:'public.example'},signal:AbortSignal.timeout(5000)});assert.deepEqual(await response.json(),{ok:true})
  await assert.rejects(fixedApplicationFetch(new URL('/redirect',base),{headers:{Host:'public.example'}}),/redirect refused/)
  const before=calls;await assert.rejects(fixedApplicationFetch(new URL('/ok',base),{body:'x'.repeat(4_500_001)}),/budget/);assert.equal(calls,before)
  await assert.rejects(fixedApplicationFetch(new URL('/wait',base),{headers:{Host:'public.example'},signal:AbortSignal.timeout(15)}),(error:any)=>error.name==='AbortError')
 }finally{await stop(server)}
})

test('one authenticated SDK config survives two real app restarts with fresh guide, stable schemas/revision/PNG; gateway restart requires session reinitialize',{timeout:180000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'fm-mcp-updates-')),publicApp=express(),publicServer=createServer(publicApp),publicOrigin=await listen(publicServer)
 let revoked=false
 const authority=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part
  res.setHeader('Content-Type','application/json')
  if(req.url!=='/app/flymind/oauth/introspect'||req.headers.authorization!=='Bearer '+token||req.headers['x-flymind-gateway-key']!==key||revoked){res.statusCode=401;res.end(JSON.stringify({code:401,errorCode:'INVALID_TOKEN',message:'失效'}));return}
  const input=JSON.parse(raw);assert.ok(input.teamId===undefined||input.teamId==='team-a')
  res.end(JSON.stringify({code:200,data:{user:{id:'alice',name:'Alice'},session:{id:'grant-a',expiresAt:Date.now()+600000},team:{id:'team-a',name:'A',role:'editor'},authorization:{purpose:'mcp',resource:publicOrigin+'/mcp',scopes:['flymind:read','flymind:write'],clientId:'client-a'}}}))
 })
 const controlPlaneURL=await listen(authority),firstServer=createServer(),applicationOrigin=await listen(firstServer),appPort=(firstServer.address() as {port:number}).port
 let applicationServer=firstServer,application:ReturnType<typeof createCloudHTTP>|undefined,gateway:ReturnType<typeof createCloudMcpGateway>|undefined
 let client:Client|undefined,transport:StreamableHTTPClientTransport|undefined
 const report:any={releases:[],maintenance:[],gatewayRestart:{},publicOriginPattern:'fixed /mcp',sourceOnly:true}
 // Test-only reverse-proxy equivalent for protected download paths. Gateway itself
 // never forwards arbitrary paths or owns application data.
 publicApp.use('/cloud-api',async(req,res)=>{try{const response=await fixedApplicationFetch(new URL(applicationOrigin+req.originalUrl),{headers:{Authorization:req.get('Authorization')??'',Host:new URL(publicOrigin).host},redirect:'error',signal:AbortSignal.timeout(30000)});res.status(response.status);res.set('Content-Type',response.headers.get('Content-Type')??'application/octet-stream');res.send(Buffer.from(await response.arrayBuffer()))}catch{res.status(503).end()}})
 publicApp.use((req,res,next)=>gateway?gateway.app(req,res,next):res.status(503).end())
 const baseRelease=await createCloudReleaseManifest()
 async function boot(index:number){
  const release={...baseRelease,releaseId:'qa-app-'+index,appVersion:'qa-version-'+index}
  application=createCloudHTTP({controlPlaneURL,publicOrigin,cloudDataRoot:join(root,'data'),gatewayKey:key,release,allowInsecureLoopback:true,serveAssets:false,serveSPA:false,renderer:new NativeDrawioRenderer()})
  applicationServer.on('request',application.app)
  return release
 }
 async function closeApp(){if(application){await application.close();applicationServer.removeListener('request',application.app);application=undefined}await stop(applicationServer)}
 async function connect(){client=new Client({name:'fixed-update-sdk',version:'1'});transport=new StreamableHTTPClientTransport(new URL(publicOrigin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}});await client.connect(transport)}
 try{
  const releases=[await boot(0)]
  gateway=createCloudMcpGateway({publicOrigin,applicationOrigin,controlPlaneURL,gatewayKey:key,allowInsecureLoopback:true});await connect()
  const sessionId=transport!.sessionId,tools=(await client!.listTools()).tools
  const content=businessContent('flowchart','persistent-update'),created=await client!.callTool({name:'create_diagram',arguments:{taskName:'云端契约回归任务',content,requestId:'create-once'}})
  assert.ok(!created.isError,JSON.stringify(created));let current=created.structuredContent as any
  report.firstExport={status:current.exportStatus,error:current.exportError};assert.equal(current.exportStatus,'succeeded',JSON.stringify(report.firstExport));assert.ok(created.content.some((c:any)=>c.type==='image'))
  const original={jobId:current.jobId,resource:current.resources.png,urls:current.urls,revision:current.revision},image=(await client!.readResource({uri:original.resource})).contents[0] as any,sha=createHash('sha256').update(Buffer.from(image.blob,'base64')).digest('hex')
  for(let index=0;index<3;index++){
   if(index){await closeApp();await assert.rejects(client!.callTool({name:'get_drawing_guide',arguments:{}}));report.maintenance.push({index,status:'explicit retryable failure; no auto write replay'});applicationServer=createServer();await listen(applicationServer,appPort);releases.push(await boot(index))}
   const guide=await client!.callTool({name:'get_drawing_guide',arguments:{kind:'flowchart'}});assert.ok(!guide.isError,JSON.stringify(guide));assert.match((guide.structuredContent as any).guide,new RegExp('qa-app-'+index));assert.ok(!(guide.structuredContent as any).guide.includes(root))
   assert.deepEqual((await client!.listTools()).tools,tools,'cached v1 schemas do not change with app version')
   assert.equal(transport!.sessionId,sessionId,'app upgrades must not destroy the gateway session')
   const read=await client!.callTool({name:'get_diagram',arguments:{id:content.id}});assert.equal((read.structuredContent as any).revision,current.revision)
   if(index){const changed=await client!.callTool({name:'patch_diagram',arguments:{id:content.id,expectedRevision:current.revision,requestId:'patch-'+index,editIntent:'wording',operations:[{op:'update_node',id:'task',changes:{label:'复核材料'+index}}]}});assert.ok(!changed.isError,JSON.stringify(changed));current=changed.structuredContent as any;assert.equal(current.revision,index+1);assert.equal(current.exportStatus,'succeeded')}
   const historical=(await client!.readResource({uri:original.resource})).contents[0] as any;assert.equal(createHash('sha256').update(Buffer.from(historical.blob,'base64')).digest('hex'),sha)
   for(const url of Object.values(current.files))assert.ok(String(url).startsWith(publicOrigin+'/cloud-api/teams/team-a/'))
   assert.ok(!JSON.stringify(current).includes(root));assert.ok(!JSON.stringify(current).includes(token))
   const download=await fetch(current.urls.png,{headers:{Authorization:'Bearer '+token}});assert.equal(download.status,200);assert.equal(Buffer.from(await download.arrayBuffer()).subarray(1,4).toString(),'PNG')
   report.releases.push({release:releases[index].releaseId,appVersion:releases[index].appVersion,revision:current.revision,sameMcpSession:true,oldPngSha256:sha})
  }
  const replay=await client!.callTool({name:'create_diagram',arguments:{taskName:'云端契约回归任务',content,requestId:'create-once'}});assert.ok(!replay.isError);assert.equal((replay.structuredContent as any).revision,1);assert.equal((replay.structuredContent as any).jobId,original.jobId,'original immutable export receipt survives both restarts')
  await gateway.close();gateway=createCloudMcpGateway({publicOrigin,applicationOrigin,controlPlaneURL,gatewayKey:key,allowInsecureLoopback:true})
  await assert.rejects(client!.callTool({name:'get_drawing_guide',arguments:{}}),/404|MCP_SESSION_NOT_FOUND/);report.gatewayRestart.oldSession='404; SDK does not automatically initialize'
  await client!.close();await connect();const restored=await client!.callTool({name:'get_diagram',arguments:{id:content.id}});assert.equal((restored.structuredContent as any).revision,3);report.gatewayRestart.sameURLNewInitialization=true
  revoked=true;await assert.rejects(client!.readResource({uri:original.resource}));report.revocationDenied=true;report.ok=true
 }catch(error){report.failure=(error as Error).message;throw error}finally{
  await client?.close().catch(()=>{});await gateway?.close();if(application)await closeApp();await stop(publicServer);await stop(authority);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});report.cleaned=true;const out=process.env.FLYMIND_PROBE_OUTPUT??'output/playwright/cloud-mcp-updates';await mkdir(out,{recursive:true});await writeFile(join(out,'report.json'),JSON.stringify(report,null,2))
 }
})
