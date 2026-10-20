import {requestClient} from '#/api/request';
export interface TeamRow {id:string;name:string;type:string;status:number;createdAt:number}
export interface MemberRow {userId:string;name:string;role:string}
export interface AppUserRow {id:string;name:string;phone:string;status:number}
export const listTeams=()=>requestClient.get<TeamRow[]>('/admin/flymind/teams');
export const teamMembers=(id:string)=>requestClient.get<MemberRow[]>(`/admin/flymind/teams/${encodeURIComponent(id)}/members`);
export const setTeamStatus=(id:string,status:number)=>requestClient.request(`/admin/flymind/teams/${encodeURIComponent(id)}`,{method:'PATCH',data:{status}});
export const listAppUsers=()=>requestClient.get<AppUserRow[]>('/admin/flymind/users');
export const createAppUser=(body:{name:string;phone:string;password:string})=>requestClient.post<AppUserRow>('/admin/flymind/users',body);
export const setAppUserStatus=(id:string,status:number)=>requestClient.request(`/admin/flymind/users/${encodeURIComponent(id)}`,{method:'PATCH',data:{status}});

export const resetAppUserPassword=(id:string,password:string)=>requestClient.post(`/admin/flymind/users/${encodeURIComponent(id)}/password`,{password});
