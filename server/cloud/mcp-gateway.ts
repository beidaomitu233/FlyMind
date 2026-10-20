import express from 'express'
import {mcpAuthRouter,createOAuthMetadata} from '@modelcontextprotocol/sdk/server/auth/router.js'
import {CloudOAuthProvider,MCP_SCOPES} from './oauth-provider'
import {CloudOAuthMcpHost} from './oauth-mcp'
import {CloudAccessError} from './identity'
import {CloudMaintenanceGate,CloudUpdatingError,type DrainOptions} from './maintenance'

export interface CloudMcpGatewayOptions {
 publicOrigin:string;applicationOrigin:string;controlPlaneURL:string;gatewayKey:string
 allowInsecureLoopback?:boolean;fetch?:typeof fetch;maxSessions?:number;idleMs?:number
}
function fixedOrigin(value:string,dev=false){const u=new URL(value);if(u.origin!==value||u.username||u.password||u.protocol!=='https:'&&!(dev&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('Gateway origins must be fixed HTTPS origins');return u}
/** Independent ingress composition. No store/worker/renderer is constructed.
 * A reverse proxy routes only /mcp + OAuth discovery here; app/UI remain separate.
 * App single-writer maintenance does not destroy these in-memory MCP sessions. */
export function createCloudMcpGateway(options:CloudMcpGatewayOptions){
 const publicURL=fixedOrigin(options.publicOrigin,options.allowInsecureLoopback)
 fixedOrigin(options.applicationOrigin,options.allowInsecureLoopback)
 const provider=new CloudOAuthProvider(options),host=new CloudOAuthMcpHost(provider,{maxSessions:options.maxSessions,idleMs:options.idleMs,applicationOrigin:options.applicationOrigin})
 const maintenance=new CloudMaintenanceGate()
 const app=express();app.disable('x-powered-by')
 app.use((req,res,next)=>{
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
  if(req.get('Host')!==publicURL.host)return next(new CloudAccessError(403,'HOST_FORBIDDEN','请求主机不允许'))
  const publicOAuth=/^\/\.well-known\//.test(req.path)||['/register','/token','/revoke'].includes(req.path)||req.path==='/authorize'&&req.method==='GET'
  if(!publicOAuth&&(req.get('Origin')&&req.get('Origin')!==publicURL.origin||req.get('Sec-Fetch-Site')==='cross-site'))return next(new CloudAccessError(403,'ORIGIN_FORBIDDEN','来源不允许'))
  next()
 })
 app.use((_req,_res,next)=>maintenance.snapshot().ready?next():next(new CloudUpdatingError()))
 app.use(express.json({limit:'4mb'}))
 const metadata=createOAuthMetadata({provider,issuerUrl:publicURL,scopesSupported:MCP_SCOPES})
 app.get('/.well-known/oauth-authorization-server',(_req,res)=>res.set('Access-Control-Allow-Origin','*').json({...metadata,token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none']}))
 app.use(mcpAuthRouter({provider,issuerUrl:publicURL,resourceServerUrl:new URL('/mcp',publicURL),scopesSupported:MCP_SCOPES,resourceName:'FlyMind'}))
 app.all('/mcp',async(req,res)=>{let release:(()=>void)|undefined;try{release=maintenance.enter(req.method,req.path);await host.handle(req,res)}catch{if(!res.headersSent)res.status(503).set('Retry-After','2').json({code:'CLOUD_UPDATING',error:'接入服务正在更新'})}finally{release?.()}})
 app.use((_req,res)=>res.status(404).json({code:'NOT_FOUND',error:'接口不存在'}))
 app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(res.headersSent){res.end();return}const e=error instanceof CloudAccessError?error:new CloudAccessError(503,'GATEWAY_UNAVAILABLE','接入服务暂时不可用');if(e.code==='CLOUD_UPDATING')res.set('Retry-After','2');res.status(e.status).json({code:e.code,error:e.message})})
 return {app,maintenance,quiesce:(budget:DrainOptions={})=>maintenance.drain(budget),close:()=>host.close()}
}
