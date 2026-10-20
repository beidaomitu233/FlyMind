import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer,type Server} from 'node:http'
import {randomBytes,createHash} from 'node:crypto'
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {auth,type OAuthClientProvider} from '@modelcontextprotocol/sdk/client/auth.js'
import {createCloudHTTP} from '../server/cloud/http'
import {NativeDrawioRenderer} from '../server/rendering/renderer'
import {businessContent} from './fixtures/native-business'

const appToken='app_session_abcdefghijklmnopqrstuvwxyz0123456789',gateway='test_gateway_key_abcdefghijklmnopqrstuvwxyz0123456789'
const random=()=>randomBytes(32).toString('base64url')
async function listen(server:Server){await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+(server.address() as any).port}
async function stop(server:Server){const p=new Promise<void>(r=>server.close(()=>r()));server.closeAllConnections();await p}

/** Contract authority substitute, not a development authentication route in the product. */
async function setup(options:{maxSessions?:number;idleMs?:number}={}){
 const root=await mkdtemp(join(tmpdir(),'flymind-oauth-')),clients=new Map<string,any>(),requests=new Map<string,any>(),codes=new Map<string,any>(),access=new Map<string,any>(),refresh=new Map<string,any>()
 let base='',grantCounter=0,member=true,gatewayCalls=0
 const authority=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const b=raw?JSON.parse(raw):{}
  const success=(data:any)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:200,message:'ok',data}))}
  const fail=(error='invalid_grant',status=400)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:status,data:{error},message:'internal path must not leak'}))}
  if(req.url==='/app/flymind/auth/login')return success({sessionToken:appToken,expiresAt:Date.now()+600000,user:{id:'alice',name:'Alice'}})
  if(req.url==='/app/flymind/auth/me')return req.headers.authorization==='Bearer '+appToken?success({user:{id:'alice',name:'Alice'},expiresAt:Date.now()+600000,teams:[{id:'team-a',name:'A',role:'editor'}]}):fail('access_denied',401)
  if(req.url?.startsWith('/app/flymind/oauth/')){if(req.headers['x-flymind-gateway-key']!==gateway)return fail('access_denied',403);gatewayCalls++}
  const path=req.url?.replace('/app/flymind/oauth','')
  if(path?.startsWith('/clients/')&&req.method==='GET'){const c=clients.get(path.slice(9));return c?success(c):fail('invalid_client',404)}
  if(path==='/clients'){clients.set(b.client_id,b);return success(b)}
  if(path==='/requests'){const id=random();requests.set(id,b);return success({requestId:id,expiresAt:Date.now()+300000})}
  if(path==='/requests/inspect'||path==='/requests/approve'){
   if(req.headers.authorization!=='Bearer '+appToken)return fail('access_denied',401)
   const r=requests.get(b.requestId);if(!r)return fail()
   if(path.endsWith('/inspect'))return success({client:{id:r.clientId,name:'SDK client'},scopes:r.scopes,teams:[{id:'team-a',name:'A',role:'editor'}],expiresAt:Date.now()+300000})
   requests.delete(b.requestId);const redirect=new URL(r.redirectUri);if(r.state)redirect.searchParams.set('state',r.state)
   if(b.approved){const code=random();codes.set(code,{...r,team:b.teamId});redirect.searchParams.set('code',code)}else redirect.searchParams.set('error','access_denied')
   return success({redirectUri:redirect.href})
  }
  const issue=(g:any)=>{const a='fm_mcp_'+random(),r='fm_refresh_'+random();access.set(a,g);refresh.set(r,{g,used:false});return {access_token:a,token_type:'Bearer',expires_in:600,refresh_token:r,scope:g.scopes.join(' ')}}
  if(path==='/code'){
   const c=codes.get(b.code);if(!c||c.clientId!==b.clientId||c.redirectUri!==b.redirectUri||c.resource!==b.resource||createHash('sha256').update(b.codeVerifier).digest('base64url')!==c.codeChallenge)return fail()
   codes.delete(b.code);return success(issue({id:'grant-'+(++grantCounter),user:'alice',team:c.team,clientId:c.clientId,scopes:c.scopes,active:true}))
  }
  if(path==='/refresh'){
   const r=refresh.get(b.refreshToken);if(!r)return fail();if(r.used){r.g.active=false;return fail()}
   if(!r.g.active||r.g.clientId!==b.clientId||b.resource!==base+'/mcp'||b.scopes?.some((s:string)=>!r.g.scopes.includes(s)))return fail()
   r.used=true;return success(issue(r.g))
  }
  if(path==='/revoke'){const g=access.get(b.token)??refresh.get(b.token)?.g;if(g&&g.clientId===b.clientId)g.active=false;return success({success:true})}
  if(path==='/introspect'){
   const g=access.get(req.headers.authorization?.slice(7)??'');if(!g?.active||!member||b.resource!==base+'/mcp'||b.teamId&&b.teamId!==g.team)return fail('invalid_token',401)
   return success({user:{id:g.user,name:g.user},session:{id:g.id,expiresAt:Date.now()+600000},team:{id:g.team,name:g.team,role:'editor'},authorization:{purpose:'mcp',resource:base+'/mcp',scopes:g.scopes,clientId:g.clientId}})
  }
  return fail('invalid_request',404)
 })
 const authorityURL=await listen(authority),http=createServer();base=await listen(http)
 const cloud=createCloudHTTP({controlPlaneURL:authorityURL,publicOrigin:base,cloudDataRoot:join(root,'data'),gatewayKey:gateway,allowInsecureLoopback:true,renderer:new NativeDrawioRenderer(),serveAssets:false,maxMcpSessions:options.maxSessions??2,mcpSessionIdleMs:options.idleMs??60000})
 http.on('request',cloud.app)
 const post=(path:string,body:any,headers:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...(headers.Cookie?{'X-FlyMind-User-Id':'alice'}:{}),...headers},body:JSON.stringify(body),redirect:'manual'})
 const form=(path:string,body:Record<string,string>)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),redirect:'manual'})
 const login=await post('/cloud-api/auth/login',{phone:'test-account',password:'test-password'});assert.equal(login.status,200,await login.clone().text());const cookie=login.headers.get('set-cookie')!.split(';')[0]
 async function oauthClient(scope='flymind:read flymind:write'){
  let info:any,tokens:any,verifier='',authorizationURL:URL|undefined
  const provider:OAuthClientProvider={redirectUrl:'http://127.0.0.1:12345/callback',clientMetadata:{redirect_uris:['http://127.0.0.1:12345/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],client_name:'Contract SDK client'},clientInformation:()=>info,saveClientInformation:v=>{info=v},tokens:()=>tokens,saveTokens:v=>{tokens=v},redirectToAuthorization:u=>{authorizationURL=u},saveCodeVerifier:v=>{verifier=v},codeVerifier:()=>verifier}
  assert.equal(await auth(provider,{serverUrl:new URL(base+'/mcp'),scope}),'REDIRECT')
  const authorize=await fetch(authorizationURL!,{redirect:'manual',headers:{'Sec-Fetch-Site':'cross-site'}});assert.equal(authorize.status,302,'top-level cross-site authorize navigation must work')
  const location=new URL(authorize.headers.get('location')!),requestId=new URLSearchParams(location.hash.split('?')[1]).get('authorize')!
  const inspected=await post('/cloud-api/oauth/requests/inspect',{requestId},{Cookie:cookie});assert.equal(inspected.status,200)
  const approved=await post('/cloud-api/oauth/requests/approve',{requestId,teamId:'team-a',approved:true},{Cookie:cookie});assert.equal(approved.status,200)
  const redirect=new URL((await approved.json() as any).data.redirectUri),code=redirect.searchParams.get('code')!
  return {provider,get info(){return info},get tokens(){return tokens},get verifier(){return verifier},code,authorizeURL:authorizationURL!,async finish(){assert.equal(await auth(provider,{serverUrl:new URL(base+'/mcp'),authorizationCode:code}),'AUTHORIZED')},setTokens:v=>{tokens=v}}
 }
 return {base,cloud,post,form,cookie,oauthClient,access,refresh,get gatewayCalls(){return gatewayCalls},revokeMember(){member=false},async close(){await cloud.close();await stop(http);await stop(authority);await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}}
}

test('OAuth SDK discovery/DCR/PKCE/refresh and public MCP bind a revocable grant, with native PNG and scope isolation',{timeout:120000},async()=>{
 const s=await setup(),clients:Client[]=[]
 try{
  let r=await fetch(s.base+'/mcp');assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate')!,/oauth-protected-resource\/mcp/)
  const metadata=await (await fetch(s.base+'/.well-known/oauth-authorization-server')).json() as any;assert.deepEqual(metadata.token_endpoint_auth_methods_supported,['none'])
  const prm=await (await fetch(s.base+'/.well-known/oauth-protected-resource/mcp')).json() as any;assert.equal(prm.resource,s.base+'/mcp')
  r=await s.post('/register',{redirect_uris:['http://evil.example/cb'],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']});assert.equal(r.status,400)
  r=await s.post('/register',{redirect_uris:['http://127.0.0.1:12345/cb'],token_endpoint_auth_method:'none'});assert.equal(r.status,201);assert.deepEqual((await r.json() as any).grant_types,['authorization_code'])
  const a=await s.oauthClient()
  const common={grant_type:'authorization_code',client_id:a.info.client_id,code:a.code,code_verifier:a.verifier,redirect_uri:String(a.provider.redirectUrl),resource:s.base+'/mcp'}
  r=await s.form('/token',{...common,code_verifier:'x'.repeat(43)});assert.equal(r.status,400)
  r=await s.form('/token',{...common,redirect_uri:'http://127.0.0.1:12346/callback'});assert.equal(r.status,400)
  r=await s.form('/token',{...common,resource:'https://wrong.example/mcp'});assert.equal(r.status,400)
  await a.finish();r=await s.form('/token',common);assert.equal(r.status,400,'code is one use')
  const client=new Client({name:'cloud-oauth-sdk',version:'1'}),transport=new StreamableHTTPClientTransport(new URL(s.base+'/mcp'),{authProvider:a.provider});clients.push(client);await client.connect(transport)
  assert.ok(!(await client.callTool({name:'get_drawing_guide',arguments:{kind:'flowchart'}})).isError)
  const created=await client.callTool({name:'create_diagram',arguments:{content:businessContent('flowchart','oauth-sdk-native'),requestId:'oauth-create'}});assert.ok(!created.isError,JSON.stringify(created));const data=created.structuredContent as any;assert.equal(data.exportStatus,'succeeded');assert.ok(created.content.some((c:any)=>c.type==='image'))
  assert.equal(data.editorUrl,s.base+'/#/cloud?team=team-a&diagram=oauth-sdk-native')
  const old=a.tokens,refreshBody={grant_type:'refresh_token',client_id:a.info.client_id,refresh_token:old.refresh_token,resource:s.base+'/mcp'}
  r=await s.form('/token',refreshBody);assert.equal(r.status,200);a.setTokens(await r.json())
  assert.ok(!(await client.callTool({name:'get_diagram',arguments:{id:data.diagramId}})).isError,'same MCP session accepts refreshed access from same grant')
  const read=await s.oauthClient('flymind:read');await read.finish();const readClient=new Client({name:'read-only',version:'1'}),readTransport=new StreamableHTTPClientTransport(new URL(s.base+'/mcp'),{authProvider:read.provider});clients.push(readClient);await readClient.connect(readTransport)
  const denied=await readClient.callTool({name:'create_diagram',arguments:{content:businessContent('flowchart','denied'),requestId:'read-create'}});assert.equal(denied.isError,true);assert.match(JSON.stringify(denied),/INSUFFICIENT_SCOPE/)
  const readExport=await readClient.callTool({name:'get_diagram',arguments:{id:data.diagramId,preview:true}});assert.ok(!readExport.isError,JSON.stringify(readExport));assert.equal((readExport.structuredContent as any).exportStatus,'succeeded','read scope may request real snapshot exports')
  const concurrent=await Promise.all([client.callTool({name:'get_diagram',arguments:{id:data.diagramId}}),readClient.callTool({name:'get_diagram',arguments:{id:data.diagramId}})]);assert.ok(concurrent.every(result=>!result.isError),'concurrent grants retain their own AsyncLocalStorage credentials')
  r=await s.post('/mcp',{jsonrpc:'2.0',id:900,method:'tools/list'},{Authorization:'Bearer '+read.tokens.access_token,'Mcp-Session-Id':transport.sessionId!});assert.equal(r.status,403,'valid token cannot use another grant session')
  const grant=s.access.get(a.tokens.access_token),originalUser=grant.user;grant.user='other-user'
  r=await s.post('/mcp',{jsonrpc:'2.0',id:903,method:'tools/list'},{Authorization:'Bearer '+a.tokens.access_token,'Mcp-Session-Id':transport.sessionId!});assert.equal(r.status,403);grant.user=originalUser
  const originalTeam=grant.team;grant.team='team-b';r=await s.post('/mcp',{jsonrpc:'2.0',id:904,method:'tools/list'},{Authorization:'Bearer '+a.tokens.access_token,'Mcp-Session-Id':transport.sessionId!});assert.equal(r.status,403);grant.team=originalTeam
  r=await fetch(s.base+'/cloud-api/auth/me',{headers:{Authorization:'Bearer '+a.tokens.access_token}});assert.equal(r.status,403)
  r=await s.post('/cloud-api/oauth/requests/inspect',{requestId:random()},{Authorization:'Bearer '+a.tokens.access_token});assert.equal(r.status,401)
  const snapshot=await client.readResource({uri:data.resources.png});assert.equal(Buffer.from((snapshot.contents[0] as any).blob,'base64').subarray(1,4).toString(),'PNG')
  r=await s.form('/token',refreshBody);assert.equal(r.status,400,'refresh replay revokes entire grant')
  r=await s.post('/mcp',{jsonrpc:'2.0',id:901,method:'tools/list'},{Authorization:'Bearer '+a.tokens.access_token,'Mcp-Session-Id':transport.sessionId!});assert.equal(r.status,401)
  s.revokeMember();r=await s.post('/mcp',{jsonrpc:'2.0',id:902,method:'tools/list'},{Authorization:'Bearer '+read.tokens.access_token,'Mcp-Session-Id':readTransport.sessionId!});assert.equal(r.status,401)
  r=await s.form('/revoke',{client_id:read.info.client_id,token:read.tokens.access_token,token_type_hint:'access_token'});assert.equal(r.status,200)
  await mkdir('output/playwright/cloud-oauth',{recursive:true});await writeFile('output/playwright/cloud-oauth/report.json',JSON.stringify({status:'ok',sdk:'1.32.1',nativePNG:true,diagramRevision:data.revision,refreshSameSession:true,scopeDenied:true,sessionMisbind:403,replayedRefreshRejected:400,revokedMembership:401,gatewayCalls:s.gatewayCalls},null,2))
 }finally{for(const c of clients)await c.close().catch(()=>{});await s.close()}
})

test('OAuth MCP registry capacity/DELETE/idle TTL are bounded; consent CSRF and application-token separation hold',{timeout:30000},async()=>{
 const s=await setup({maxSessions:1,idleMs:800}),clients:Client[]=[]
 try{
  const a=await s.oauthClient();await a.finish()
  let r=await fetch(s.base+'/cloud-api/oauth/requests/inspect',{method:'POST',headers:{Cookie:s.cookie,'Content-Type':'application/json'},body:JSON.stringify({requestId:random()})});assert.equal(r.status,403)
  r=await s.post('/cloud-api/oauth/requests/inspect',{requestId:random()},{Cookie:s.cookie,Origin:'https://wrong.example'});assert.equal(r.status,403)
  r=await s.post('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},{Authorization:'Bearer '+appToken});assert.equal(r.status,401)
  const c=new Client({name:'registry',version:'1'}),t=new StreamableHTTPClientTransport(new URL(s.base+'/mcp'),{authProvider:a.provider});clients.push(c);await c.connect(t)
  const init={jsonrpc:'2.0',id:42,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'other',version:'1'}}}
  r=await s.post('/mcp',init,{Authorization:'Bearer '+a.tokens.access_token,Accept:'application/json, text/event-stream'});assert.equal(r.status,503)
  const id=t.sessionId!;r=await fetch(s.base+'/mcp',{method:'DELETE',headers:{Authorization:'Bearer '+a.tokens.access_token,'Mcp-Session-Id':id}});assert.equal(r.status,200)
  r=await s.post('/mcp',{jsonrpc:'2.0',id:43,method:'tools/list'},{Authorization:'Bearer '+a.tokens.access_token,'Mcp-Session-Id':id});assert.equal(r.status,404)
  const c2=new Client({name:'registry-new',version:'1'}),t2=new StreamableHTTPClientTransport(new URL(s.base+'/mcp'),{authProvider:a.provider});clients.push(c2);await c2.connect(t2)
  await new Promise(r=>setTimeout(r,1000))
  r=await s.post('/mcp',{jsonrpc:'2.0',id:44,method:'tools/list'},{Authorization:'Bearer '+a.tokens.access_token,'Mcp-Session-Id':t2.sessionId!});assert.equal(r.status,404)
  const spa=await fetch(s.base+'/#/cloud');assert.equal(spa.status,200);assert.match(await spa.text(),/<div id="app"><\/div>/)
 }finally{for(const c of clients)await c.close().catch(()=>{});await s.close()}
})
