import express,{type Request,type Response,type RequestHandler} from 'express'
import {withActivityActor} from '../activity/context'
import {CloudControlPlane,CloudAccessError,type CloudIdentityProvider,type CloudPermission} from './identity'
import {CloudTeamWorkspaces,cloudRequestId} from './team-workspaces'
import {CloudExportPool} from './export-pool'
import {nativeRouter,nativeError} from '../native-routes'
import {NativeDrawioRenderer} from '../rendering/renderer'
import {runtimeAssetsRouter} from '../rendering/assets'
import type {NativeExportRenderer} from '../exports/types'
import {runtimeCapabilities} from '../runtime-instance/config'
import {VERSION} from '../version'
import {mcpAuthRouter,createOAuthMetadata} from '@modelcontextprotocol/sdk/server/auth/router.js'
import {CloudOAuthProvider,MCP_SCOPES} from './oauth-provider'
import {CloudOAuthMcpHost} from './oauth-mcp'
import {join} from 'node:path'
import {PACKAGE_ROOT} from '../package-paths'
import {CloudCollaborationRooms} from './collaboration'
import {cloudMcpHandshake,cloudReleaseSchema,type CloudReleaseManifest} from './mcp-compat'
import {inspectDrawing} from '../../src/drawing/core/drawing-quality'
import {CloudMaintenanceGate,type DrainOptions} from './maintenance'
import {wirePositiveInteger} from './wire'

export interface CloudHTTPOptions {
 maintenance?:CloudMaintenanceGate
 release?:CloudReleaseManifest
 controlPlaneURL:string;cloudDataRoot:string;publicOrigin:string
 identity?:CloudIdentityProvider;fetch?:typeof fetch;allowInsecureLoopback?:boolean
 renderer?:NativeExportRenderer;maxOpenTeams?:number;maxQueuedTeams?:number;serveAssets?:boolean
 recoveryIntervalMs?:number;recoveryBatchSize?:number
 gatewayKey?:string;maxMcpSessions?:number;mcpSessionIdleMs?:number;serveSPA?:boolean;spaRoot?:string
 collaborationIntervalMs?:number
}
const tokenPattern=/^[a-zA-Z0-9_-]{32,512}$/
const safeId=/^[a-zA-Z0-9_-]{1,100}$/
function errorResponse(res:Response,error:unknown){const e=nativeError(error);if((error as {retryAfter?:number})?.retryAfter===2)res.set('Retry-After','2');res.status(e.status).json(e.body)}
function publicJSON(body:any,status:number):{body:any;status:number}{
 if(!body||typeof body!=='object'||typeof body.error!=='string')return {body,status}
 const fsCode=/^(?:ENOENT|EACCES|EPERM|ENOTDIR|EISDIR|EIO|EBUSY|EROFS|ENOSPC|EMFILE|ENFILE|SQLITE_)/.test(String(body.code??''))
 const privatePath=/(?:[a-z]:[\\/]|\\\\[^\\]+\\|(?:^|\s)\/(?:home|tmp|var|srv|opt|Users)\/)/i.test(body.error)
 if(fsCode||privatePath)return {status:503,body:{code:'CLOUD_STORAGE_ERROR',error:'云端存储暂时不可用，请稍后重试'}}
 if(status>=500)return {status,body:{code:/^[A-Z][A-Z0-9_]{0,63}$/.test(String(body.code))?body.code:'CLOUD_INTERNAL_ERROR',error:'云端服务暂时不可用，请稍后重试'}}
 return {body,status}
}
function permission(req:Request):CloudPermission{
 if(req.method==='GET')return 'diagram:read'
 if(req.method==='POST'&&(/^\/diagrams\/[^/]+\/exports(?:\/snapshot)?$/.test(req.path)||/^\/exports\/[^/]+\/retry$/.test(req.path)))return 'export:create'
 return 'diagram:write'
}
function rewriteURLs(input:unknown,prefix:string):unknown{
 if(Array.isArray(input))return input.map(value=>rewriteURLs(value,prefix))
 if(!input||typeof input!=='object')return input
 return Object.fromEntries(Object.entries(input).map(([key,value])=>[key,key==='url'&&typeof value==='string'&&value.startsWith('/studio-api/native/')?prefix+value:rewriteURLs(value,prefix)]))
}
async function boundedJSON(response:globalThis.Response){
 const reader=response.body?.getReader();if(!reader)throw new CloudAccessError(503,'IDENTITY_INVALID_RESPONSE','授权服务响应无效')
 const chunks:Uint8Array[]=[];let length=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>262144){await reader.cancel();throw new Error('budget')}chunks.push(value)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
 catch{throw new CloudAccessError(503,'IDENTITY_INVALID_RESPONSE','授权服务响应无效')}finally{reader.releaseLock()}
}
/** Separate source-only cloud composition. Local Runtime/session behavior is unchanged. */
export function createCloudHTTP(options:CloudHTTPOptions){
 const maintenance=options.maintenance??new CloudMaintenanceGate()
 async function tracked<T>(req:Request,operation:()=>Promise<T>){const release=maintenance.enter(req.method,req.path);try{return await operation()}finally{release()}}
 const releaseManifest=options.release?Promise.resolve(cloudReleaseSchema.parse(options.release)):cloudMcpHandshake().then(value=>value.release)
 const publicURL=new URL(options.publicOrigin)
 if(publicURL.origin!==options.publicOrigin||publicURL.username||publicURL.password||publicURL.protocol!=='https:'&&!(options.allowInsecureLoopback&&publicURL.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(publicURL.hostname)))throw Error('Cloud publicOrigin must be an HTTPS origin')
 // This constructor also validates the fixed upstream origin, even with a test identity provider.
 const control=new CloudControlPlane(options.controlPlaneURL,{fetch:options.fetch,allowInsecureLoopback:options.allowInsecureLoopback,gatewayKey:options.gatewayKey,mcpResource:options.publicOrigin+'/mcp'})
 const oauth=options.gatewayKey?new CloudOAuthProvider({controlPlaneURL:options.controlPlaneURL,publicOrigin:options.publicOrigin,gatewayKey:options.gatewayKey,fetch:options.fetch,allowInsecureLoopback:options.allowInsecureLoopback}):undefined
 const mcp=oauth?new CloudOAuthMcpHost(oauth,{maxSessions:options.maxMcpSessions,idleMs:options.mcpSessionIdleMs}):undefined
 const workspaces=new CloudTeamWorkspaces(options.cloudDataRoot,options.identity??control,{maxOpenTeams:options.maxOpenTeams,release:releaseManifest})
 const rooms=new CloudCollaborationRooms(workspaces,{intervalMs:options.collaborationIntervalMs})
 const pool=new CloudExportPool(options.renderer??new NativeDrawioRenderer(),options.maxQueuedTeams??32,{root:options.cloudDataRoot,intervalMs:options.recoveryIntervalMs,batchSize:options.recoveryBatchSize,release:releaseManifest})
 const app=express(),secure=publicURL.protocol==='https:',cookieName=secure?'__Host-fm_cloud_session':'fm_cloud_session'
 app.disable('x-powered-by')
 app.use((req,res,next)=>{
  const originalJSON=res.json.bind(res);res.json=body=>{const quality=(record:any)=>record?.format===3&&record.document?.content?{...record,quality:inspectDrawing(record.document.content)}:record;const enriched=body?.record?{...body,record:quality(body.record)}:quality(body);const value=publicJSON(enriched,res.statusCode);res.status(value.status);return originalJSON(value.body)}
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff')
  if(req.get('Host')!==publicURL.host){errorResponse(res,new CloudAccessError(403,'HOST_FORBIDDEN','请求主机不允许'));return}
  const publicOAuth=!!oauth&&(/^\/\.well-known\//.test(req.path)||['/register','/token','/revoke'].includes(req.path)||req.path==='/authorize'&&req.method==='GET')
  const origin=req.get('Origin');if(!publicOAuth&&(origin&&origin!==publicURL.origin||req.get('Sec-Fetch-Site')==='cross-site')){errorResponse(res,new CloudAccessError(403,'ORIGIN_FORBIDDEN','来源不允许'));return}
  const bearer=req.get('Authorization')?.startsWith('Bearer ')
  const hasCookie=(req.get('Cookie')??'').split(';').some(s=>s.trim().startsWith(cookieName+'='))
  if(!publicOAuth&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!origin&&(!bearer||hasCookie||req.path==='/cloud-api/auth/login')){errorResponse(res,new CloudAccessError(403,'ORIGIN_REQUIRED','浏览器写入需要同源Origin'));return}
  next()
 })
 app.use(express.json({limit:'4mb'}))
 app.get('/healthz',(_req,res)=>res.json({status:'running'}))
 app.get('/readyz',async(_req,res)=>{const release=await releaseManifest,state=maintenance.snapshot();res.status(state.ready?200:503).json({...state,releaseId:release.releaseId,engineResourceKey:release.engineResourceKey})})
 if(oauth&&mcp){
  // SDK defaults advertise confidential clients too; this provider supports public PKCE only.
  const metadata=createOAuthMetadata({provider:oauth,issuerUrl:publicURL,scopesSupported:MCP_SCOPES})
  app.get('/.well-known/oauth-authorization-server',(_req,res)=>res.set('Access-Control-Allow-Origin','*').json({...metadata,token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none']}))
  app.use(mcpAuthRouter({provider:oauth,issuerUrl:publicURL,resourceServerUrl:new URL('/mcp',publicURL),scopesSupported:MCP_SCOPES,resourceName:'FlyMind'}))
  app.all('/mcp',(req,res)=>mcp.handle(req,res))
 }
 function token(req:Request){
  const header=req.get('Authorization'),bearer=header?.startsWith('Bearer ')?header.slice(7):undefined
  const cookies=(req.get('Cookie')??'').split(';').map(s=>s.trim()),matches=cookies.filter(s=>s.startsWith(cookieName+'='))
  if(matches.length>1)throw new CloudAccessError(401,'LOGIN_REQUIRED','登录会话无效')
  const cookie=matches[0]?.slice(cookieName.length+1)
  if(header&&!bearer||bearer&&cookie&&bearer!==cookie)throw new CloudAccessError(401,'LOGIN_REQUIRED','登录会话无效')
  const value=bearer??cookie;if(!value||!tokenPattern.test(value))throw new CloudAccessError(401,'LOGIN_REQUIRED','请先登录 FlyMind');return value
 }
 function expectedUser(req:Request,userId:string){
  const expected=req.get('X-FlyMind-User-Id'),cookie=(req.get('Cookie')??'').split(';').some(s=>s.trim().startsWith(cookieName+'='))
  if(expected&&!safeId.test(expected)||cookie&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!expected)throw new CloudAccessError(409,'USER_IDENTITY_REQUIRED','请重新确认当前登录账号')
  if(expected&&expected!==userId)throw new CloudAccessError(409,'USER_IDENTITY_MISMATCH','登录账号已改变，请保留草稿并重新打开')
 }
 async function checkManagementUser(req:Request,credential:string){
  const response=await (options.fetch??fetch)(new URL('/app/flymind/auth/me',options.controlPlaneURL),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+credential}})
  const body=await boundedJSON(response)
  if(!response.ok||body?.code!==200||typeof body?.data?.user?.id!=='string')throw new CloudAccessError(401,'LOGIN_REQUIRED','请先登录 FlyMind')
  expectedUser(req,body.data.user.id)
 }
 async function proxy(req:Request,res:Response,path:string,login=false){return tracked(req,()=>proxyRequest(req,res,path,login))}
 async function proxyRequest(req:Request,res:Response,path:string,login=false){
  const credential=login?undefined:token(req)
  if(credential?.startsWith('fm_mcp_'))throw new CloudAccessError(403,'MCP_SCOPE_FORBIDDEN','MCP令牌不能访问账号或团队管理')
  if(credential&&!['GET','HEAD'].includes(req.method))await checkManagementUser(req,credential)
  let response:globalThis.Response
  try{response=await (options.fetch??fetch)(new URL(path,options.controlPlaneURL),{method:req.method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json',...(credential?{Authorization:'Bearer '+credential}:{})},...(!['GET','HEAD'].includes(req.method)?{body:JSON.stringify(req.body??{})}:{})})}
  catch(error){if(error instanceof CloudAccessError)throw error;throw new CloudAccessError(503,'IDENTITY_UNAVAILABLE','授权服务暂时不可用')}
  const value=await boundedJSON(response)
  if(!response.ok||value?.code!==200){const status=[400,401,403,404,409,429,503].includes(response.status)?response.status:503;throw new CloudAccessError(status,typeof value?.errorCode==='string'?value.errorCode:'IDENTITY_UNAVAILABLE',typeof value?.message==='string'?value.message:'授权服务暂时不可用')}
  if(login||path==='/app/flymind/auth/me'){try{value.data.expiresAt=wirePositiveInteger(value.data?.expiresAt)}catch{throw new CloudAccessError(503,'IDENTITY_INVALID_RESPONSE','授权服务响应无效')}}
  if(login){const data=value.data;if(!data||!tokenPattern.test(data.sessionToken)||data.expiresAt<=Date.now()||!data.user?.id||typeof data.user.name!=='string')throw new CloudAccessError(503,'IDENTITY_INVALID_RESPONSE','授权服务响应无效');res.cookie(cookieName,data.sessionToken,{httpOnly:true,secure,sameSite:'strict',path:'/',maxAge:data.expiresAt-Date.now()});res.json({code:200,message:value.message??'ok',data:{user:data.user,expiresAt:data.expiresAt}});return}
  if(path==='/app/flymind/auth/logout'||path==='/app/flymind/auth/password')res.clearCookie(cookieName,{httpOnly:true,secure,sameSite:'strict',path:'/'})
  res.json(value)
 }
 app.post('/cloud-api/auth/login',async(req,res)=>{const b=req.body;if(!b||Object.keys(b).some(k=>!['phone','password'].includes(k))||typeof b.phone!=='string'||b.phone.length>32||!b.phone.length||typeof b.password!=='string'||!b.password.length||b.password.length>200)throw new CloudAccessError(400,'INVALID_LOGIN','手机号或密码格式无效');await proxy(req,res,'/app/flymind/auth/login',true)})
 app.get('/cloud-api/auth/me',(req,res)=>proxy(req,res,'/app/flymind/auth/me'))
 app.post('/cloud-api/auth/logout',(req,res)=>proxy(req,res,'/app/flymind/auth/logout'))
 app.post('/cloud-api/auth/password',async(req,res)=>{const b=req.body;if(!b||Array.isArray(b)||Object.keys(b).length!==1||typeof b.newPassword!=='string'||Array.from(b.newPassword).length<6||!b.newPassword.trim()||Buffer.byteLength(b.newPassword,'utf8')>72)throw new CloudAccessError(400,'INVALID_INPUT','新密码至少6位，最多72字节，无需混合大小写或符号');await proxy(req,res,'/app/flymind/auth/password')})
 app.get('/cloud-api/teams',(req,res)=>proxy(req,res,'/app/flymind/teams'))
 app.post('/cloud-api/teams',(req,res)=>proxy(req,res,'/app/flymind/teams'))
 const teamProxy:[string,'get'|'post'|'patch'|'delete'][]=[['/:teamId','patch'],['/:teamId/members','get'],['/:teamId/invites','post'],['/:teamId/members/:userId','patch'],['/:teamId/members/:userId','delete'],['/:teamId/transfer','post'],['/:teamId/leave','post']]
 for(const [path,method] of teamProxy)app[method]('/cloud-api/teams'+path,async(req,res)=>{if(!safeId.test(String(req.params.teamId))||req.params.userId&&!safeId.test(String(req.params.userId)))throw new CloudAccessError(400,'INVALID_TEAM','团队或成员标识无效');await proxy(req,res,'/app/flymind/teams'+req.path.slice('/cloud-api/teams'.length))})
 app.get('/cloud-api/invites',(req,res)=>proxy(req,res,'/app/flymind/invites'))
 for(const action of ['accept','decline'])app.post('/cloud-api/invites/:id/'+action,(req,res)=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(String(req.params.id)))throw new CloudAccessError(400,'INVALID_INPUT','邀请标识无效');return proxy(req,res,'/app/flymind/invites/'+req.params.id+'/'+action)})
 app.post('/cloud-api/invites/accept',(req,res)=>proxy(req,res,'/app/flymind/invites/accept'))
 if(oauth)for(const action of ['inspect','approve'] as const)app.post('/cloud-api/oauth/requests/'+action,async(req,res)=>{
  return tracked(req,async()=>{
  const cookies=(req.get('Cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(cookieName+'='))
  if(cookies.length!==1||req.get('Authorization'))throw new CloudAccessError(401,'LOGIN_REQUIRED','授权确认需要浏览器登录会话')
  const sessionToken=token(req);if(sessionToken.startsWith('fm_mcp_'))throw new CloudAccessError(403,'MCP_SCOPE_FORBIDDEN','授权确认需要应用会话')
  await checkManagementUser(req,sessionToken)
  const body=req.body;if(!body||typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{20,512}$/.test(body.requestId)||Object.keys(body).some(k=>!(action==='approve'?['requestId','teamId','approved']:['requestId']).includes(k))||action==='approve'&&(typeof body.approved!=='boolean'||body.approved&&!safeId.test(body.teamId)||body.teamId!==undefined&&!safeId.test(body.teamId)))throw new CloudAccessError(400,'INVALID_CONSENT','授权请求参数无效')
  const data=await oauth.internal('/requests/'+action,body,sessionToken)
  if(action==='approve'){
   let redirect:URL;try{redirect=new URL(data?.redirectUri)}catch{throw new CloudAccessError(503,'IDENTITY_INVALID_RESPONSE','授权服务响应无效')}
   if(redirect.username||redirect.password||redirect.hash||redirect.protocol!=='https:'&&!(redirect.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(redirect.hostname)))throw new CloudAccessError(503,'IDENTITY_INVALID_RESPONSE','授权服务响应无效')
  }
  res.json({code:200,message:'ok',data})
  })
 })
 app.get('/cloud-api/teams/:teamId/studio-api/health',async(req,res)=>{
  await workspaces.run(token(req),String(req.params.teamId),'workspace:read',async (workspace,principal)=>{expectedUser(req,principal.user.id);const expected=req.get('X-FlyMind-DataRoot-Id');if(expected&&expected!==workspace.dataRootId)throw new CloudAccessError(409,'WORKSPACE_MISMATCH','工作区身份不匹配');const manifest=await releaseManifest;res.json({name:'flymind',version:manifest.appVersion,storage:'sqlite',dataRootId:workspace.dataRootId,capabilities:runtimeCapabilities(),mcp:{contractVersions:[1],release:manifest}})})
 })
 const collaborationPath='/cloud-api/teams/:teamId/studio-api/native/collaboration/:id'
 app.get(collaborationPath+'/events',async(req,res)=>{
  const credential=token(req),team=String(req.params.teamId),id=String(req.params.id),root=req.get('X-FlyMind-DataRoot-Id')
  const cursor=req.query.since??req.get('Last-Event-ID')
  if(!root||!safeId.test(id)||cursor!==undefined&&(typeof cursor!=='string'||!/^\d{1,10}$/.test(cursor)||Number(cursor)<1))throw new CloudAccessError(400,'INVALID_COLLABORATION_REQUEST','协同标识或修订无效')
  await workspaces.run(credential,team,'diagram:read',async(workspace,principal)=>{
   expectedUser(req,principal.user.id)
   if(root!==workspace.dataRootId)throw new CloudAccessError(409,'WORKSPACE_MISMATCH','工作区身份不匹配')
   await rooms.connect({team,id,root,token:credential,principal,workspace,response:res,since:cursor===undefined?undefined:Number(cursor)})
  })
 })
 app.post(collaborationPath+'/commit',async(req,res)=>{
  return tracked(req,async()=>{
  await workspaces.run(token(req),String(req.params.teamId),'diagram:write',async(workspace,principal)=>{
   expectedUser(req,principal.user.id)
   const requestId=req.body?.requestId,record=await withActivityActor({userId:principal.user.id,userDisplayName:principal.user.name,teamId:principal.team.id,channel:principal.authorization?'mcp':'web',...(principal.authorization?.clientId?{clientId:principal.authorization.clientId}:{}),dataRootId:workspace.dataRootId},()=>workspace.diagrams.saveCollaborativeEditor(String(req.params.id),{...req.body,requestId:cloudRequestId(principal,requestId)},req.get('X-FlyMind-DataRoot-Id')))
   res.json({requestId,record});rooms.kick()
  })
  })
 })
 app.use('/cloud-api/teams/:teamId/studio-api/native',async(req,res,next)=>{
  try{
   const teamId=String(req.params.teamId),access=permission(req)
   await tracked(req,()=>workspaces.run(token(req),teamId,access,async(workspace,principal)=>{
    expectedUser(req,principal.user.id)
    const expected=req.get('X-FlyMind-DataRoot-Id');if(expected&&expected!==workspace.dataRootId)throw new CloudAccessError(409,'WORKSPACE_MISMATCH','工作区身份不匹配')
    if(req.body&&typeof req.body==='object'&&Object.hasOwn(req.body,'requestId'))req.body={...req.body,requestId:cloudRequestId(principal,req.body.requestId)}
    const manifest=await releaseManifest
    const release=access==='export:create'?pool.reserve(workspace):()=>{}
    try{await withActivityActor({userId:principal.user.id,userDisplayName:principal.user.name,teamId:principal.team.id,channel:principal.authorization?'mcp':'web',...(principal.authorization?.clientId?{clientId:principal.authorization.clientId}:{}),dataRootId:workspace.dataRootId},()=>new Promise<void>((yes,no)=>{
     let settled=false,inJSON=false
     const json=res.json.bind(res),send=res.send.bind(res)
     const finished=()=>{if(settled)return;settled=true;res.off('finish',finished);yes()}
     // close is only a transport event: async service work may still commit.
     // Native routes settle through json/send/next even after a client aborts.
     res.json=body=>{inJSON=true;try{return json(rewriteURLs(body,'/cloud-api/teams/'+teamId))}finally{inJSON=false;finished();if(req.method!=='GET')rooms.kick()}}
     res.send=body=>{try{return send(body)}finally{if(!inJSON)finished()}}
     res.once('finish',finished)
     nativeRouter(workspace.diagrams,workspace.exports,{release:manifest})(req,res,error=>{res.off('finish',finished);if(settled)return;settled=true;if(error)no(error);else{next();yes()}})
    }))}finally{release()}
   }))
  }catch(error){next(error)}
 })
 if(options.serveAssets!==false)app.use(runtimeAssetsRouter())
 if(options.serveSPA!==false)app.use(express.static(options.spaRoot??join(PACKAGE_ROOT,'dist'),{index:'index.html',redirect:false}))
 app.use((_req,res)=>res.status(404).json({error:'接口不存在',code:'NOT_FOUND'}))
 app.use((error:unknown,_req:Request,res:Response,_next:unknown)=>{if(!res.headersSent)errorResponse(res,error)})
 return {app,workspaces,maintenance,async quiesce(budget:DrainOptions={}){maintenance.stopAccepting();await maintenance.drain(budget);await pool.quiesce(budget);rooms.quiesce()},async close(){rooms.close();try{await mcp?.close();await pool.close()}finally{workspaces.close()}}}
}
