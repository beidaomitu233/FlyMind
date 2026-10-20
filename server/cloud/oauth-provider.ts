import {randomUUID} from 'node:crypto'
import type {Response} from 'express'
import type {OAuthServerProvider,AuthorizationParams} from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type {OAuthClientInformationFull,OAuthTokenRevocationRequest,OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js'
import {OAuthClientInformationFullSchema,OAuthTokensSchema} from '@modelcontextprotocol/sdk/shared/auth.js'
import {InvalidClientMetadataError,InvalidRequestError,InvalidScopeError,InvalidTargetError,InvalidTokenError,ServerError,OAUTH_ERRORS} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import {CloudControlPlane,type CloudPrincipal} from './identity'
import {wirePositiveInteger} from './wire'

export const MCP_SCOPES=['flymind:read','flymind:write']
export interface CloudOAuthOptions {controlPlaneURL:string;publicOrigin:string;gatewayKey:string;fetch?:typeof fetch;allowInsecureLoopback?:boolean}
export class CloudOAuthProvider implements OAuthServerProvider {
 readonly resource:string;readonly identity:CloudControlPlane
 readonly skipLocalPkceValidation=true // Java atomically validates PKCE + consumes the code.
 constructor(readonly options:CloudOAuthOptions){
  this.options=Object.freeze({...options})
  if(Buffer.byteLength(options.gatewayKey)<32||/[\r\n]/.test(options.gatewayKey))throw Error('FLYMIND_GATEWAY_KEY must contain at least 32 bytes')
  this.resource=options.publicOrigin+'/mcp'
  this.identity=new CloudControlPlane(options.controlPlaneURL,{fetch:options.fetch,allowInsecureLoopback:options.allowInsecureLoopback,gatewayKey:options.gatewayKey,mcpResource:this.resource})
 }
 readonly clientsStore={
  getClient:async(id:string):Promise<OAuthClientInformationFull|undefined>=>{
   if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return undefined
   const value=await this.internal('/clients/'+id,undefined,undefined,true)
   return value===undefined?undefined:this.client(OAuthClientInformationFullSchema.parse(value))
  },
  registerClient:async(input:Omit<OAuthClientInformationFull,'client_id'|'client_id_issued_at'>):Promise<OAuthClientInformationFull>=>{
   const client=this.client({...input,grant_types:input.grant_types??['authorization_code'],response_types:input.response_types??['code'],client_id:randomUUID(),client_id_issued_at:Math.floor(Date.now()/1000)})
   return this.client(OAuthClientInformationFullSchema.parse(await this.internal('/clients',client)))
  }
 }
 private client(c:OAuthClientInformationFull){
  if(c.token_endpoint_auth_method!=='none'||c.client_secret!==undefined||c.client_secret_expires_at!==undefined||!c.redirect_uris.length||c.redirect_uris.length>16||!c.grant_types?.every(g=>['authorization_code','refresh_token'].includes(g))||!c.grant_types.includes('authorization_code')||c.response_types?.length!==1||c.response_types[0]!=='code')throw new InvalidClientMetadataError('仅支持public client、PKCE授权码及refresh')
  for(const s of c.redirect_uris){let u:URL;try{u=new URL(s)}catch{throw new InvalidClientMetadataError('redirect_uri无效')}
   if(u.username||u.password||u.hash||s.includes('*')||u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw new InvalidClientMetadataError('redirect_uri需要HTTPS或本机回环且无fragment')
  }
  if(c.scope)this.scopes(c.scope.split(' '))
  return c
 }
 private scopes(scopes?:string[]){const s=scopes?.length?scopes:MCP_SCOPES;if(!s.includes('flymind:read')||new Set(s).size!==s.length||s.some(v=>!MCP_SCOPES.includes(v)))throw new InvalidScopeError('scope需要flymind:read，write不可单独使用');return s}
 private target(resource?:URL){if(resource?.href!==this.resource)throw new InvalidTargetError('resource必须为当前MCP地址');return this.resource}
 async internal(path:string,body?:unknown,token?:string,allowMissing=false):Promise<any>{
  if(!/^\/(?:clients(?:\/[a-zA-Z0-9_-]{1,100})?|requests(?:\/(?:inspect|approve))?|code|refresh|revoke)$/.test(path))throw new ServerError('授权路径无效')
  let response:globalThis.Response
  try{response=await (this.options.fetch??fetch)(new URL('/app/flymind/oauth'+path,this.options.controlPlaneURL),{method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),headers:{'X-FlyMind-Gateway-Key':this.options.gatewayKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})}catch{throw new ServerError('授权服务暂时不可用')}
  if(allowMissing&&response.status===404)return undefined
  let payload:any
  try{const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144){await reader.cancel();throw Error('budget')}chunks.push(value)}payload=JSON.parse(Buffer.concat(chunks).toString('utf8'))}finally{reader.releaseLock()}}catch{throw new ServerError('授权服务响应无效')}
  if(!response.ok||payload?.code!==200){const code=payload?.data?.error;const ErrorType=typeof code==='string'&&Object.hasOwn(OAUTH_ERRORS,code)?OAUTH_ERRORS[code as keyof typeof OAUTH_ERRORS]:undefined;throw ErrorType?new ErrorType('授权请求未获批准'):new ServerError('授权服务暂时不可用')}
  // Normalize only documented numeric authority fields before SDK strict schemas.
  // Session introspection is normalized independently by CloudControlPlane.
  if(payload.data&&typeof payload.data==='object'&&!Array.isArray(payload.data)){
   for(const key of ['expiresAt','client_id_issued_at','expires_in'])if(Object.hasOwn(payload.data,key)){
    try{payload.data[key]=wirePositiveInteger(payload.data[key])}catch{throw new ServerError('授权服务数值响应无效')}
   }
  }
  return payload.data
 }
 async authorize(client:OAuthClientInformationFull,params:AuthorizationParams,res:Response){
  if(!client.redirect_uris.includes(params.redirectUri))throw new InvalidRequestError('redirect_uri必须精确匹配注册值')
  if(!/^[a-zA-Z0-9_-]{43}$/.test(params.codeChallenge))throw new InvalidRequestError('需要S256 PKCE challenge')
  const value=await this.internal('/requests',{clientId:client.client_id,redirectUri:params.redirectUri,codeChallenge:params.codeChallenge,scopes:this.scopes(params.scopes),state:params.state,resource:this.target(params.resource)})
  if(!/^[a-zA-Z0-9_-]{20,512}$/.test(value?.requestId)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now())throw new ServerError('授权请求响应无效')
  res.redirect(this.options.publicOrigin+'/#/cloud?authorize='+encodeURIComponent(value.requestId))
 }
 async challengeForAuthorizationCode():Promise<string>{throw new ServerError('PKCE由Java权威验证')}
 private tokens(input:unknown){const tokens=OAuthTokensSchema.parse(input);if(!/^fm_mcp_[a-zA-Z0-9_-]{43}$/.test(tokens.access_token)||tokens.token_type.toLowerCase()!=='bearer'||!Number.isInteger(tokens.expires_in)||(tokens.expires_in??0)<=0||(tokens.expires_in??0)>600||!/^fm_refresh_[a-zA-Z0-9_-]{43}$/.test(tokens.refresh_token??'')||!tokens.scope)throw new ServerError('令牌响应无效');this.scopes(tokens.scope.split(' '));return tokens}
 async exchangeAuthorizationCode(client:OAuthClientInformationFull,code:string,codeVerifier?:string,redirectUri?:string,resource?:URL):Promise<OAuthTokens>{
  if(!codeVerifier||!/^[a-zA-Z0-9._~-]{43,128}$/.test(codeVerifier)||!redirectUri||!client.redirect_uris.includes(redirectUri))throw new InvalidRequestError('PKCE或redirect_uri无效')
  return this.tokens(await this.internal('/code',{clientId:client.client_id,code,codeVerifier,redirectUri,resource:this.target(resource)}))
 }
 async exchangeRefreshToken(client:OAuthClientInformationFull,refreshToken:string,scopes?:string[],resource?:URL):Promise<OAuthTokens>{return this.tokens(await this.internal('/refresh',{clientId:client.client_id,refreshToken,...(scopes?{scopes:this.scopes(scopes)}:{}),resource:this.target(resource)}))}
 async principal(token:string):Promise<CloudPrincipal>{try{return await this.identity.introspectMcp(token)}catch{throw new InvalidTokenError('访问令牌无效、已撤销或资源不匹配')}}
 async verifyAccessToken(token:string){const p=await this.principal(token);return {token,clientId:p.authorization!.clientId,scopes:p.authorization!.scopes,expiresAt:Math.floor(p.session.expiresAt/1000),resource:new URL(this.resource),extra:{principal:p}}}
 async revokeToken(client:OAuthClientInformationFull,request:OAuthTokenRevocationRequest){await this.internal('/revoke',{clientId:client.client_id,token:request.token,tokenTypeHint:request.token_type_hint})}
}
