import {randomUUID,timingSafeEqual,createHash} from 'node:crypto'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {createNativeMcpServer} from '../mcp-native/server'
import {CloudAccessError} from './identity'
import {createCloudMcpConnection,type CloudMcpOptions} from './mcp-connection'

/** Factory only: production HTTP deliberately does not mount /mcp before OAuth is complete.
 * The future OAuth host must first validate audience/scopes and bind the trusted team.
 * Today this requires a real, revocable Java application session; no bypass tokens exist.
 */
export async function createCloudMcpSession(options:CloudMcpOptions){
 options={...options}
 const adapter=await createCloudMcpConnection(options)
 const facade=createNativeMcpServer(async()=>adapter.connection,{waitMs:options.waitMs,pollMs:options.pollMs,editorURL:adapter.editorURL})
 const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID(),enableJsonResponse:true})
 await facade.server.connect(transport)
 const digest=(s:string)=>createHash('sha256').update(s).digest()
 let closed=false
 return {
  binding:adapter.binding,
  async handleRequest(req:IncomingMessage,res:ServerResponse,body?:unknown){
   try{
    if(closed)throw new CloudAccessError(401,'MCP_SESSION_CLOSED','MCP会话已关闭')
    const header=req.headers.authorization
    if(typeof header!=='string'||!timingSafeEqual(digest(header),digest('Bearer '+(options.requestToken?.()??options.token))))throw new CloudAccessError(401,'MCP_SESSION_CREDENTIAL_MISMATCH','MCP会话凭据不匹配')
    const url=new URL(options.cloudOrigin)
    if(req.headers.host!==url.host||req.headers.origin&&req.headers.origin!==url.origin||req.headers['sec-fetch-site']==='cross-site')throw new CloudAccessError(403,'MCP_ORIGIN_REJECTED','MCP请求来源不匹配')
    // Even local guide/list/schema requests cross the authorized cloud HTTP health gate.
    await adapter.checkHealth()
    await transport.handleRequest(req,res,body)
   }catch(error){
    if(res.headersSent){res.end();return}
    const known=error instanceof CloudAccessError
    res.statusCode=known?error.status:503;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
    res.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32000,message:known?error.message:'云端MCP暂时不可用',data:{code:known?error.code:'MCP_CLOUD_UNAVAILABLE'}}}))
   }
  },
  async close(){if(closed)return;closed=true;try{await facade.close()}finally{await adapter.close()}}
 }
}
