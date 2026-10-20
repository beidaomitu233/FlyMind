import type {CloudPermission,CloudPrincipal} from '../cloud/identity'
export type {CloudPermission,CloudPrincipal}
export class LocalAuthError extends Error {constructor(readonly status:number,readonly code:string,message:string){super(message);this.name='LocalAuthError'}}
export interface LocalAuthState {schemaVersion:1;controlPlaneOrigin:string;dataRootId:string;deviceId:string;generation:string;userId?:string;teamId?:string;credential?:{token:string;expiresAt:number}}
export interface LocalAuthStore {read():Promise<LocalAuthState|undefined>;update(change:(state:LocalAuthState|undefined)=>LocalAuthState):Promise<LocalAuthState>}
export interface LocalAuthOptions {controlPlaneOrigin:string;credentialDirectory?:string;dataRootId:string;providerName?:string;allowInsecureLoopback?:boolean;fetch?:typeof fetch;timeoutMs?:number;now?:()=>number;store?:LocalAuthStore}
export interface LocalAuthSelection {selectionRequired:true;selectionId:string;user:{id:string;name:string};teams:Array<{id:string;name:string;role:string}>}
export interface LocalAuthLoginResult {authorized:true;principal:CloudPrincipal}
