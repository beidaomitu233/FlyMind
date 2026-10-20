import {NativeApiError} from './native-types'
export type CloudRole='owner'|'admin'|'editor'|'viewer'
export interface CloudTeam {id:string;name:string;role:CloudRole}
export interface CloudMember {userId:string;name:string;role:CloudRole}
export interface CloudMe {user:{id:string;name:string};expiresAt:number;teams:CloudTeam[]}
export interface CloudConsent {client:{id:string;name:string};scopes:string[];teams:CloudTeam[];expiresAt:number}
export function cloudConsentTeams(consent:CloudConsent):CloudTeam[]{return consent.teams.filter(team=>!consent.scopes.includes('flymind:write')||team.role!=='viewer')}
const id=(value:string)=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw new Error('团队或用户标识无效');return encodeURIComponent(value)}
const requestId=(value:string)=>{if(!/^[a-zA-Z0-9_-]{20,512}$/.test(value))throw new Error('授权请求无效');return value}
export function cloudDraftDatabase(userId:string,teamId:string){return 'flymind-cloud-drafts-v1:'+encodeURIComponent(userId)+':'+encodeURIComponent(teamId)}
const viewerWrite=(path:string,method:string)=>!['GET','HEAD'].includes(method)&&!(method==='POST'&&(/\/diagrams\/[^/]+\/exports$/.test(path)||/\/exports\/[^/]+\/retry$/.test(path)))
export function cloudTeamFetch(role:CloudRole,transport:typeof fetch=fetch):typeof fetch{return async(input,init)=>{if(role==='viewer'&&viewerWrite(String(input).split('?')[0],(init?.method??'GET').toUpperCase()))throw new NativeApiError('当前团队权限为只读',403,'FORBIDDEN');return transport(input,{...init,credentials:'same-origin',redirect:'error'})}}
/** Immutable browser identity. The server checks the same header against the cookie on every request. */
export class CloudIdentityGuard {
 private lost?:NativeApiError
 constructor(readonly userId:string,private readonly transport:typeof fetch=globalThis.fetch.bind(globalThis),private readonly onLost:(error:NativeApiError)=>void=()=>{}){}
 invalidate(message='登录身份或团队权限已变化，请重新登录',status=401,code='CLOUD_IDENTITY_CHANGED'){
  if(!this.lost){this.lost=new NativeApiError(message,status,code);this.onLost(this.lost)}return this.lost
 }
 private assertActive(){if(this.lost)throw this.lost}
 async check(teamId?:string):Promise<CloudMe>{
  this.assertActive()
  const response=await this.transport('/cloud-api/auth/me',{credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'X-FlyMind-User-Id':this.userId}})
  this.assertActive()
  if([401,403,409].includes(response.status))throw this.invalidate()
  const value=await response.json();this.assertActive()
  if(!response.ok||value.code!==200)throw new NativeApiError(value.error??'读取账号失败',response.status,'CLOUD_ERROR')
  const me=value.data as CloudMe
  if(me.user?.id!==this.userId||teamId&&!me.teams.some(t=>t.id===teamId))throw this.invalidate()
  return me
 }
 fetch(teamId?:string):typeof fetch{return async(input,init)=>{
  const me=await this.check(teamId);this.assertActive()
  const path=String(input).split('?')[0],method=(init?.method??'GET').toUpperCase()
  if(teamId&&me.teams.find(t=>t.id===teamId)?.role==='viewer'&&viewerWrite(path,method))throw new NativeApiError('当前团队权限为只读',403,'FORBIDDEN')
  const headers=new Headers(init?.headers);headers.set('X-FlyMind-User-Id',this.userId)
  const response=await this.transport(input,{...init,headers,credentials:'same-origin',redirect:'error'});this.assertActive()
  if([401,403].includes(response.status))throw this.invalidate(undefined,response.status)
  if(response.status===409){const value=await response.clone().json().catch(()=>({}));if(value.code==='USER_IDENTITY_MISMATCH'||value.code==='CLOUD_IDENTITY_CHANGED')throw this.invalidate()}
  return response
 }}
}
export function cloudAuthorizationRedirect(value:string,origin:string):string{
 const url=new URL(value);const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname)
 if(url.username||url.password||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&loopback))throw new Error('授权返回地址不安全')
 // origin is intentionally not used as a redirect source; only the server response is accepted.
 void origin;return url.href
}
export class CloudClient {
 constructor(private readonly transport:typeof fetch=globalThis.fetch.bind(globalThis)){}
 private async request<T>(path:string,method='GET',body?:unknown):Promise<T>{const response=await this.transport('/cloud-api'+path,{method,credentials:'same-origin',redirect:'error',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(!response.ok||value.code!==200)throw new NativeApiError(value.error??value.message??'云端请求失败',response.status,value.code&&typeof value.code==='string'?value.code:'CLOUD_ERROR');return value.data as T}
 login(phone:string,password:string){return this.request('/auth/login','POST',{phone,password})}
 me(){return this.request<CloudMe>('/auth/me')}
 logout(){return this.request('/auth/logout','POST')}
 inspectAuthorization(value:string){return this.request<CloudConsent>('/oauth/requests/inspect','POST',{requestId:requestId(value)})}
 approveAuthorization(value:string,approved:boolean,teamId?:string){return this.request<{redirectUri:string}>('/oauth/requests/approve','POST',{requestId:requestId(value),approved,...(approved?{teamId:id(teamId??'')}:{})})}
 createTeam(name:string){return this.request<CloudTeam>('/teams','POST',{name})}
 members(team:string){return this.request<CloudMember[]>('/teams/'+id(team)+'/members')}
 invite(team:string,phone:string,role:Exclude<CloudRole,'owner'>){return this.request<{id:string;inviteToken:string;expiresAt:number}>('/teams/'+id(team)+'/invites','POST',{phone,role})}
 accept(inviteToken:string){return this.request<CloudTeam>('/invites/accept','POST',{inviteToken})}
 role(team:string,user:string,role:Exclude<CloudRole,'owner'>){return this.request('/teams/'+id(team)+'/members/'+id(user),'PATCH',{role})}
 remove(team:string,user:string){return this.request('/teams/'+id(team)+'/members/'+id(user),'DELETE')}
 transfer(team:string,userId:string){return this.request('/teams/'+id(team)+'/transfer','POST',{userId})}
 leave(team:string){return this.request('/teams/'+id(team)+'/leave','POST')}
}
