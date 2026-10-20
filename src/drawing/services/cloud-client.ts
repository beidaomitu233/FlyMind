import {NativeApiError} from './native-types'
export type CloudRole='owner'|'admin'|'editor'|'viewer'
export interface CloudTeam {id:string;name:string;role:CloudRole}
export interface CloudMember {userId:string;name:string;role:CloudRole}
export interface CloudMe {user:{id:string;name:string};expiresAt:number;teams:CloudTeam[]}
const id=(value:string)=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw new Error('团队或用户标识无效');return encodeURIComponent(value)}
export function cloudDraftDatabase(userId:string,teamId:string){return 'flymind-cloud-drafts-v1:'+encodeURIComponent(userId)+':'+encodeURIComponent(teamId)}
/** Extra UI guard; server independently authorizes every request. Exports remain available to viewers. */
export function cloudTeamFetch(role:CloudRole,transport:typeof fetch=fetch):typeof fetch{return async(input,init)=>{const method=(init?.method??'GET').toUpperCase(),path=String(input).split('?')[0];if(role==='viewer'&&!['GET','HEAD'].includes(method)&&!(method==='POST'&&(/\/diagrams\/[^/]+\/exports$/.test(path)||/\/exports\/[^/]+\/retry$/.test(path))))throw new NativeApiError('当前团队权限为只读',403,'FORBIDDEN');return transport(input,{...init,credentials:'same-origin',redirect:'error'})}}
export class CloudClient {
 constructor(private readonly transport:typeof fetch=fetch){}
 private async request<T>(path:string,method='GET',body?:unknown):Promise<T>{const response=await this.transport('/cloud-api'+path,{method,credentials:'same-origin',redirect:'error',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(!response.ok||value.code!==200)throw new NativeApiError(value.error??value.message??'云端请求失败',response.status,value.code&&typeof value.code==='string'?value.code:'CLOUD_ERROR');return value.data as T}
 login(phone:string,password:string){return this.request('/auth/login','POST',{phone,password})}
 me(){return this.request<CloudMe>('/auth/me')}
 logout(){return this.request('/auth/logout','POST')}
 createTeam(name:string){return this.request<CloudTeam>('/teams','POST',{name})}
 members(team:string){return this.request<CloudMember[]>('/teams/'+id(team)+'/members')}
 invite(team:string,phone:string,role:Exclude<CloudRole,'owner'>){return this.request<{id:string;inviteToken:string;expiresAt:number}>('/teams/'+id(team)+'/invites','POST',{phone,role})}
 accept(inviteToken:string){return this.request<CloudTeam>('/invites/accept','POST',{inviteToken})}
 role(team:string,user:string,role:Exclude<CloudRole,'owner'>){return this.request('/teams/'+id(team)+'/members/'+id(user),'PATCH',{role})}
 remove(team:string,user:string){return this.request('/teams/'+id(team)+'/members/'+id(user),'DELETE')}
 transfer(team:string,userId:string){return this.request('/teams/'+id(team)+'/transfer','POST',{userId})}
 leave(team:string){return this.request('/teams/'+id(team)+'/leave','POST')}
}
