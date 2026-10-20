import {AsyncLocalStorage} from 'node:async_hooks'
import type {Request,Response} from 'express'
import {isInitializeRequest} from '@modelcontextprotocol/sdk/types.js'
import {CloudOAuthProvider} from './oauth-provider'
import {createCloudMcpSession} from './mcp'
import {CloudAccessError,type CloudPrincipal} from './identity'

type Session=Awaited<ReturnType<typeof createCloudMcpSession>>
type Entry={session:Session;principal:CloudPrincipal;lastUsed:number;active:number}
/** Stateful SDK transports are private to a grant; only request-local access tokens flow onward. */
export class CloudOAuthMcpHost {
 private readonly context=new AsyncLocalStorage<{token:string}>()
 private readonly entries=new Map<string,Entry>()
 private creating=0;private closed=false;private readonly timer:NodeJS.Timeout
 private readonly max:number;private readonly ttl:number
 constructor(private readonly provider:CloudOAuthProvider,private readonly options:{maxSessions?:number;idleMs?:number;applicationOrigin?:string}={}){
  this.max=options.maxSessions??64;this.ttl=options.idleMs??600000
  if(!Number.isInteger(this.max)||this.max<1||this.max>1024||!Number.isInteger(this.ttl)||this.ttl<50||this.ttl>3600000)throw Error('Invalid MCP session budget')
  this.timer=setInterval(()=>{void this.sweep()},Math.min(this.ttl,30000));this.timer.unref()
 }
 private async sweep(){for(const [id,e] of this.entries)if(!e.active&&Date.now()-e.lastUsed>=this.ttl){this.entries.delete(id);await e.session.close().catch(()=>{})}}
 async handle(req:Request,res:Response){
  const challenge=(code:string)=>{res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${this.provider.options.publicOrigin}/.well-known/oauth-protected-resource/mcp", error="${code}"`)}
  try{
   if(this.closed)throw new CloudAccessError(503,'MCP_CLOSED','服务已关闭')
   const token=req.get('Authorization')?.match(/^Bearer (fm_mcp_[a-zA-Z0-9_-]{43})$/)?.[1]
   if(!token){challenge('invalid_token');throw new CloudAccessError(401,'INVALID_TOKEN','需要OAuth MCP访问令牌')}
   let principal:CloudPrincipal
   try{principal=await this.provider.principal(token)}catch{challenge('invalid_token');throw new CloudAccessError(401,'INVALID_TOKEN','访问令牌已失效或授权被撤销')}
   if(!principal.authorization?.scopes.includes('flymind:read')){challenge('insufficient_scope');throw new CloudAccessError(403,'INSUFFICIENT_SCOPE','需要flymind:read授权')}
   const id=req.get('Mcp-Session-Id')
   let entry=id?this.entries.get(id):undefined
   if(entry&&!entry.active&&Date.now()-entry.lastUsed>=this.ttl){this.entries.delete(id!);await entry.session.close();entry=undefined}
   if(id&&!entry)throw new CloudAccessError(404,'MCP_SESSION_NOT_FOUND','会话不存在或已过期，请重新initialize')
   if(entry&&(entry.principal.user.id!==principal.user.id||entry.principal.team.id!==principal.team.id||entry.principal.session.id!==principal.session.id||entry.principal.authorization?.clientId!==principal.authorization.clientId))throw new CloudAccessError(403,'MCP_SESSION_MISMATCH','不能访问其他身份或授权的MCP会话')
   if(!entry&&!(req.method==='POST'&&isInitializeRequest(req.body)))throw new CloudAccessError(400,'MCP_INITIALIZE_REQUIRED','请先initialize')
   let reserved=false
   try{await this.context.run({token},async()=>{
    if(!entry){
     await this.sweep()
     if(this.entries.size+this.creating>=this.max)throw new CloudAccessError(503,'MCP_SESSION_CAPACITY','会话容量已满，请稍后重试')
     this.creating++;reserved=true
      const session=await createCloudMcpSession({cloudOrigin:this.provider.options.publicOrigin,applicationOrigin:this.options.applicationOrigin,teamId:principal.team.id,token,identity:this.provider.identity,fetch:this.provider.options.fetch,allowInsecureLoopback:this.provider.options.allowInsecureLoopback,requestToken:()=>{
       const value=this.context.getStore()?.token;if(!value)throw new CloudAccessError(401,'MCP_REQUEST_CONTEXT_REQUIRED','请求上下文已结束');return value
      }})
      if(this.closed){await session.close();throw new CloudAccessError(503,'MCP_CLOSED','服务已关闭')}
      entry={session,principal,lastUsed:Date.now(),active:0}
    }
    // Idle SSE GET must not pin a session forever. Only in-flight MCP POST work
    // protects against TTL eviction; closing the transport also releases its GET.
    const busy=req.method==='POST'
    if(busy)entry.active++
    entry.lastUsed=Date.now()
    try{
     await entry.session.handleRequest(req,res,req.body)
     if(!id){const newId=res.getHeader('mcp-session-id');if(typeof newId==='string'&&res.statusCode<400)this.entries.set(newId,entry);else await entry.session.close()}
     if(req.method==='DELETE'&&id){this.entries.delete(id);await entry.session.close()}
    }finally{if(busy){entry.active--;entry.lastUsed=Date.now()}}
   })}finally{if(reserved)this.creating--}
  }catch(error){
   if(res.headersSent){res.end();return}
   const e=error instanceof CloudAccessError?error:new CloudAccessError(503,'MCP_UNAVAILABLE','MCP服务暂时不可用')
   res.status(e.status).json({jsonrpc:'2.0',id:null,error:{code:-32000,message:e.message,data:{code:e.code}}})
  }
 }
 async close(){if(this.closed)return;this.closed=true;clearInterval(this.timer);const entries=[...this.entries.values()];this.entries.clear();await Promise.allSettled(entries.map(e=>e.session.close()))}
}
