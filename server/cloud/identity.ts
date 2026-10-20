import {z} from 'zod'
import {wirePositiveInteger} from './wire'

const identifier=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/)
export const teamIdSchema=identifier
const contextSchema=z.strictObject({
  user:z.strictObject({id:identifier,name:z.string().min(1).max(200)}),
  session:z.strictObject({id:identifier,expiresAt:z.preprocess(value=>{try{return wirePositiveInteger(value)}catch{return null}},z.number().int().positive())}),
  team:z.strictObject({id:identifier,name:z.string().min(1).max(200),role:z.enum(['owner','admin','editor','viewer'])}),
  authorization:z.strictObject({purpose:z.literal('mcp'),resource:z.string().url(),scopes:z.array(z.enum(['flymind:read','flymind:write'])).min(1).max(2).refine(s=>new Set(s).size===s.length&&s.includes('flymind:read')),clientId:identifier}).optional()
})
export type CloudPrincipal=z.infer<typeof contextSchema>
export type CloudPermission='workspace:read'|'workspace:write'|'diagram:read'|'diagram:write'|'export:read'|'export:create'|'team:manage'|'team:ownership'
export interface CloudIdentityProvider {
  authorize(token:string,teamId:string,permission:CloudPermission):Promise<CloudPrincipal>
}
export class CloudAccessError extends Error {
  constructor(readonly status:number,readonly code:string,message:string){super(message);this.name='CloudAccessError'}
}
export function assertCloudPermission(principal:CloudPrincipal,permission:CloudPermission){
  if(principal.authorization){
    if(permission==='team:manage'||permission==='team:ownership')throw new CloudAccessError(403,'MCP_SCOPE_FORBIDDEN','MCP授权不能管理团队')
    if((permission==='diagram:write'||permission==='workspace:write')&&!principal.authorization.scopes.includes('flymind:write'))throw new CloudAccessError(403,'INSUFFICIENT_SCOPE','需要flymind:write授权')
  }
  const role=principal.team.role
  const allowed=permission==='team:ownership'?role==='owner'
    :permission==='team:manage'?role==='owner'||role==='admin'
    :permission==='diagram:write'||permission==='workspace:write'?role!=='viewer'
    :['workspace:read','diagram:read','export:read','export:create'].includes(permission)
  if(!allowed)throw new CloudAccessError(403,'PERMISSION_DENIED','当前团队角色无权执行此操作')
}

/** The control plane is the authority. No membership cache survives revocation. */
export class CloudControlPlane implements CloudIdentityProvider {
  private readonly endpoint:URL
  constructor(baseURL:string,private readonly options:{fetch?:typeof fetch;timeoutMs?:number;allowInsecureLoopback?:boolean;now?:()=>number;gatewayKey?:string;mcpResource?:string}={}){
    const base=new URL(baseURL)
    const loopback=['localhost','127.0.0.1','[::1]'].includes(base.hostname)
    if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||
      base.protocol!=='https:'&&!(options.allowInsecureLoopback&&loopback&&base.protocol==='http:')){
      throw new Error('控制面必须是固定 HTTPS origin；仅显式开发模式允许回环 HTTP')
    }
    this.endpoint=new URL('/app/flymind/session/introspect',base)
  }
  async authorize(token:string,teamId:string,permission:CloudPermission):Promise<CloudPrincipal>{
    return this.inspect(token,teamId,permission)
  }
  async introspectMcp(token:string,teamId?:string):Promise<CloudPrincipal>{
    if(!token.startsWith('fm_mcp_'))throw new CloudAccessError(401,'INVALID_TOKEN','需要MCP访问令牌')
    return this.inspect(token,teamId,'workspace:read')
  }
  private async inspect(token:string,teamId:string|undefined,permission:CloudPermission):Promise<CloudPrincipal>{
    if(!/^[a-zA-Z0-9_-]{32,512}$/.test(token))throw new CloudAccessError(401,'LOGIN_REQUIRED','请先登录 FlyMind')
    const mcp=token.startsWith('fm_mcp_')
    if((teamId!==undefined&&!teamIdSchema.safeParse(teamId).success)||!mcp&&teamId===undefined)throw new CloudAccessError(400,'INVALID_TEAM','团队标识无效')
    if(mcp&&(!this.options.gatewayKey||Buffer.byteLength(this.options.gatewayKey)<32||!this.options.mcpResource))throw new CloudAccessError(401,'INVALID_TOKEN','MCP授权未配置')
    let response:Response
    try{
      response=await (this.options.fetch??fetch)(mcp?new URL('/app/flymind/oauth/introspect',this.endpoint):this.endpoint,{method:'POST',redirect:'error',cache:'no-store',
        signal:AbortSignal.timeout(this.options.timeoutMs??8000),
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(mcp?{'X-FlyMind-Gateway-Key':this.options.gatewayKey!}:{})},body:JSON.stringify({...(teamId?{teamId}:{}),...(mcp?{resource:this.options.mcpResource}:{})})})
    }catch{throw new CloudAccessError(503,'IDENTITY_UNAVAILABLE','授权服务暂时不可用，请稍后重试')}
    if(response.status===401)throw new CloudAccessError(401,'LOGIN_REQUIRED','登录已失效，请重新登录')
    if(response.status===403||response.status===404)throw new CloudAccessError(403,'TEAM_ACCESS_DENIED','无权访问此团队')
    if(response.status===429)throw new CloudAccessError(429,'AUTH_RATE_LIMITED','授权请求过于频繁，请稍后重试')
    if(!response.ok)throw new CloudAccessError(503,'IDENTITY_UNAVAILABLE','授权服务暂时不可用，请稍后重试')
    let payload:unknown
    try{payload=await response.json()}catch{throw new CloudAccessError(503,'IDENTITY_INVALID_RESPONSE','授权服务响应无效')}
    const envelope=z.object({code:z.literal(200),data:contextSchema}).safeParse(payload)
    if(!envelope.success)throw new CloudAccessError(503,'IDENTITY_INVALID_RESPONSE','授权服务响应无效')
    const principal=envelope.data.data
    if(teamId!==undefined&&principal.team.id!==teamId)throw new CloudAccessError(403,'TEAM_ACCESS_DENIED','授权团队不匹配')
    if(mcp?principal.authorization?.resource!==this.options.mcpResource:principal.authorization!==undefined)throw new CloudAccessError(401,'INVALID_TOKEN','授权目的或资源不匹配')
    if(principal.session.expiresAt<=(this.options.now??Date.now)())throw new CloudAccessError(401,'LOGIN_REQUIRED','登录已失效，请重新登录')
    assertCloudPermission(principal,permission)
    return principal
  }
}
