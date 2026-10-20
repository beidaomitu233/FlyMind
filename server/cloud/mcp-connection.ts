import {randomUUID} from 'node:crypto'
import {CloudAccessError,type CloudIdentityProvider,type CloudPrincipal,teamIdSchema} from './identity'
import type {NativeRuntimeConnection} from '../runtime-instance/types'
import {runtimeCapabilities} from '../runtime-instance/config'
import {VERSION} from '../version'

export interface CloudMcpOptions {
 cloudOrigin:string;teamId:string;token:string;identity:CloudIdentityProvider
 fetch?:typeof fetch;allowInsecureLoopback?:boolean;waitMs?:number;pollMs?:number
 /** Only trusted OAuth host supplies a request-local token getter (AsyncLocalStorage). */
 requestToken?:()=>string
}
export interface CloudMcpBinding {teamId:string;userId:string;sessionId:string;dataRootId:string}

/** An authorized application-session adapter, not an OAuth resource server or local launcher. */
export async function createCloudMcpConnection(options:CloudMcpOptions){
 options={...options}
 const origin=new URL(options.cloudOrigin),teamId=teamIdSchema.parse(options.teamId)
 if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||
  origin.protocol!=='https:'&&!(options.allowInsecureLoopback&&origin.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname)))throw new Error('Cloud MCP requires a fixed HTTPS origin')
 if(!/^[a-zA-Z0-9_-]{32,512}$/.test(options.token))throw new CloudAccessError(401,'LOGIN_REQUIRED','登录凭据无效')
 const principal=await options.identity.authorize(options.token,teamId,'workspace:read')
 if(principal.team.id!==teamId)throw new CloudAccessError(403,'TEAM_ACCESS_DENIED','授权团队不匹配')
 const userId=principal.user.id,sessionId=principal.session.id
 const clientId=principal.authorization?.clientId,resource=principal.authorization?.resource
 const accessToken=()=>options.requestToken?.()??options.token
 const prefix='/cloud-api/teams/'+encodeURIComponent(teamId)+'/studio-api',send=options.fetch??fetch
 let root='',closed=false
 async function authorize():Promise<CloudPrincipal>{
  if(closed)throw new CloudAccessError(401,'MCP_SESSION_CLOSED','MCP会话已关闭')
  const current=await options.identity.authorize(accessToken(),teamId,'workspace:read')
  if(current.team.id!==teamId||current.user.id!==userId||current.session.id!==sessionId||current.authorization?.clientId!==clientId||current.authorization?.resource!==resource)throw new CloudAccessError(403,'MCP_IDENTITY_CHANGED','MCP会话不能改绑身份或团队')
  return current
 }
 function headers(){return {Authorization:'Bearer '+accessToken(),...(root?{'X-FlyMind-DataRoot-Id':root}:{})}}
 async function authenticatedFetch(path:string,init:RequestInit={}){
  await authorize()
  if(!path.startsWith('/')||path.startsWith('//')||/[\\#]|%(?:2f|5c|2e)/i.test(path))throw new CloudAccessError(400,'MCP_PATH_REJECTED','仅接受绑定团队的相对资源路径')
  const candidate=new URL(path,origin)
  const local=candidate.pathname==='/studio-api/health'||candidate.pathname==='/studio-api/native'||candidate.pathname.startsWith('/studio-api/native/')
  if(local)candidate.pathname=prefix+candidate.pathname.slice('/studio-api'.length)
  if(candidate.origin!==origin.origin||!(candidate.pathname===prefix+'/health'||candidate.pathname===prefix+'/native'||candidate.pathname.startsWith(prefix+'/native/')))throw new CloudAccessError(403,'MCP_TEAM_PATH_REJECTED','不能访问其他团队或服务')
  const h=new Headers(init.headers)
  for(const name of ['authorization','x-flymind-dataroot-id','cookie','host'])if(h.has(name))throw new CloudAccessError(400,'MCP_BOUND_HEADER','调用方不能覆盖会话身份')
  for(const [name,value] of Object.entries(headers()))h.set(name,value)
  return send(candidate,{...init,headers:h,redirect:'error',cache:'no-store',signal:init.signal??AbortSignal.timeout(30000)})
 }
 async function checkHealth(){
  const response=await authenticatedFetch('/studio-api/health')
  if(!response.ok)throw new CloudAccessError(response.status,'MCP_CLOUD_UNAVAILABLE','团队授权或工作区不可用')
  const health=await response.json() as any
  if(health.name!=='flymind'||health.storage!=='sqlite'||health.version!==VERSION||typeof health.dataRootId!=='string'||!health.dataRootId||JSON.stringify(health.capabilities)!==JSON.stringify(runtimeCapabilities()))throw new CloudAccessError(503,'MCP_CAPABILITY_MISMATCH','云端版本或能力不匹配')
  if(root&&health.dataRootId!==root)throw new CloudAccessError(409,'WORKSPACE_MISMATCH','MCP会话不能改绑工作区')
  root=health.dataRootId
 }
 await checkHealth()
 const binding:Readonly<CloudMcpBinding>=Object.freeze({teamId,userId,sessionId,dataRootId:root})
 const connection:NativeRuntimeConnection={baseURL:origin.origin,dataRootId:root,instanceId:'cloud-'+randomUUID(),sessionToken:options.token,capabilities:runtimeCapabilities(),headers,authenticatedFetch,async close(){/* detach is owned by the facade, never a cloud service shutdown */}}
 Object.defineProperty(connection,'sessionToken',{enumerable:false})
 return {connection,binding,checkHealth,close:async()=>{closed=true},editorURL:(id:string)=>origin.origin+'/#/cloud?team='+encodeURIComponent(teamId)+'&diagram='+encodeURIComponent(id)}
}
