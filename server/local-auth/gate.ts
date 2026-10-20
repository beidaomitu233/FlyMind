import {randomBytes,randomUUID} from 'node:crypto'
import {z} from 'zod'
import {assertCloudPermission,type CloudPermission,type CloudPrincipal} from '../cloud/identity'
import {PrivateLocalAuthStore} from './store'
import {LocalAuthError,type LocalAuthOptions,type LocalAuthState,type LocalAuthSelection,type LocalAuthLoginResult} from './types'
const identifier=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),opaque=z.string().regex(/^[A-Za-z0-9_-]{43}$/)
// Existing Java Jackson configuration serializes Long timestamps as decimal strings.
const wireTimestamp=z.union([z.number(),z.string().regex(/^[1-9][0-9]{0,15}$/).transform(Number)]).pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))
const team=z.strictObject({id:identifier,name:z.string().min(1).max(200),role:z.enum(['owner','admin','editor','viewer'])})
const user=z.strictObject({id:identifier,name:z.string().min(1).max(200)})
const meSchema=z.strictObject({user,expiresAt:wireTimestamp,teams:z.array(team).max(1000)})
const principalSchema=z.strictObject({user,session:z.strictObject({id:identifier,expiresAt:wireTimestamp}),team,binding:z.strictObject({deviceId:opaque,dataRootId:identifier})})
const stateSchema=z.strictObject({schemaVersion:z.literal(1),controlPlaneOrigin:z.string(),dataRootId:identifier,deviceId:opaque,generation:z.string().uuid(),userId:identifier.optional(),teamId:identifier.optional(),credential:z.strictObject({token:z.string().regex(/^fm_local_[A-Za-z0-9_-]{43}$/),expiresAt:z.number().int().positive()}).optional()})
interface Selection {appToken:string;userId:string;teams:z.infer<typeof team>[];expiresAt:number;epoch:number;generation:string;busy:boolean}
export class LocalAuthorizationGate {
 private readonly origin:string;private readonly store;private readonly transport:typeof fetch;private readonly now:()=>number;private epoch=0;private blocked=false
 private readonly pending=new Map<string,Selection>()
 constructor(private readonly options:LocalAuthOptions){
  let origin:URL;try{origin=new URL(options.controlPlaneOrigin)}catch{throw new LocalAuthError(500,'LOCAL_AUTH_CONFIGURATION_REQUIRED','v1.1必须配置可信授权控制面')}
  if(!identifier.safeParse(options.dataRootId).success||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||options.controlPlaneOrigin.endsWith('/')||origin.protocol!=='https:'&&!(options.allowInsecureLoopback&&origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname)))throw new LocalAuthError(500,'LOCAL_AUTH_CONFIGURATION_REQUIRED','必须配置固定HTTPS控制面与工作区身份')
  if(!options.store&&!options.credentialDirectory)throw new LocalAuthError(500,'LOCAL_AUTH_CONFIGURATION_REQUIRED','缺少私有授权目录')
  this.origin=origin.origin;this.store=options.store??new PrivateLocalAuthStore(options.credentialDirectory!);this.transport=options.fetch??globalThis.fetch.bind(globalThis);this.now=options.now??Date.now
 }
 private valid(state:LocalAuthState|undefined){const parsed=stateSchema.safeParse(state);if(!parsed.success)throw new LocalAuthError(503,'LOCAL_AUTH_STORE_INVALID','授权记录损坏，未自动解除绑定');const value=parsed.data;if(value.controlPlaneOrigin!==this.origin||value.dataRootId!==this.options.dataRootId)throw new LocalAuthError(409,'LOCAL_AUTH_BINDING_MISMATCH','授权目录已绑定其他控制面或工作区，未自动重绑');if(!!value.userId!==!!value.teamId||value.credential&&!value.userId)throw new LocalAuthError(503,'LOCAL_AUTH_STORE_INVALID','授权绑定记录不完整');return value}
 private async state(){let state=await this.store.read();if(!state)state=await this.store.update(existing=>existing??{schemaVersion:1,controlPlaneOrigin:this.origin,dataRootId:this.options.dataRootId,deviceId:randomBytes(32).toString('base64url'),generation:randomUUID()});return this.valid(state)}
 private async request(path:string,body?:unknown,token?:string){
  let response:Response;try{response=await this.transport(new URL('/app/flymind'+path,this.origin),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(this.options.timeoutMs??5000)})}catch{throw new LocalAuthError(503,'LOCAL_AUTH_UNAVAILABLE','授权服务暂时不可用，本地访问未放行')}
  if(!response.ok){const status=[400,401,403,409,429].includes(response.status)?response.status:503;throw new LocalAuthError(status,status===401?'LOCAL_LOGIN_REQUIRED':status===403?'LOCAL_PERMISSION_DENIED':status===429?'LOCAL_AUTH_RATE_LIMITED':'LOCAL_AUTH_UNAVAILABLE',status===401?'登录已失效，请重新登录':'授权未通过，本地访问未放行')}
  let bytes=0,text='';const reader=response.body?.getReader();if(!reader)throw new LocalAuthError(503,'LOCAL_AUTH_INVALID_RESPONSE','授权服务响应无效')
  const decoder=new TextDecoder();try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>65536)throw Error();text+=decoder.decode(part.value,{stream:true})}text+=decoder.decode();const value=JSON.parse(text);if(value.code!==200)throw Error();return value.data as unknown}catch{await reader.cancel().catch(()=>{});throw new LocalAuthError(503,'LOCAL_AUTH_INVALID_RESPONSE','授权服务响应无效')}finally{reader.releaseLock()}
 }
 async authorize(permission:CloudPermission='diagram:read'):Promise<CloudPrincipal>{
  if(this.blocked)throw new LocalAuthError(401,'LOCAL_LOGIN_REQUIRED','当前实例已退出，请显式重新登录')
  const before=await this.state(),epoch=this.epoch;if(!before.credential||before.credential.expiresAt<=this.now())throw new LocalAuthError(401,'LOCAL_LOGIN_REQUIRED','请先登录并授权当前本地工作区')
  const value=principalSchema.safeParse(await this.request('/local/introspect',{deviceId:before.deviceId,dataRootId:before.dataRootId},before.credential.token))
  if(!value.success)throw new LocalAuthError(503,'LOCAL_AUTH_INVALID_RESPONSE','授权服务响应无效')
  const p=value.data;if(p.user.id!==before.userId||p.team.id!==before.teamId||p.binding.deviceId!==before.deviceId||p.binding.dataRootId!==before.dataRootId)throw new LocalAuthError(409,'LOCAL_AUTH_BINDING_MISMATCH','授权身份与本地固定绑定不匹配')
  const current=await this.state();if(this.epoch!==epoch||current.generation!==before.generation||p.session.expiresAt<=this.now())throw new LocalAuthError(401,'LOCAL_LOGIN_REQUIRED','本地授权已失效或已退出')
  const principal:CloudPrincipal={user:p.user,session:p.session,team:p.team};try{assertCloudPermission(principal,permission)}catch{throw new LocalAuthError(403,'LOCAL_PERMISSION_DENIED','当前团队角色无权执行此操作')}return principal
 }
 async status(){const base={provider:this.options.providerName??new URL(this.origin).hostname,dataRootId:this.options.dataRootId};try{const principal=await this.authorize('workspace:read');return {...base,loginRequired:false,principal}}catch(e){if(e instanceof LocalAuthError&&[401,403].includes(e.status))return {...base,loginRequired:true};throw e}}
 async login(input:{phone:string;password:string;teamId?:string}):Promise<LocalAuthSelection|LocalAuthLoginResult>{
  if(!input||Object.keys(input).some(k=>!['phone','password','teamId'].includes(k))||typeof input.phone!=='string'||!/^1[3-9][0-9]{9}$/.test(input.phone)||typeof input.password!=='string'||Buffer.byteLength(input.password)>72||input.teamId!==undefined&&!identifier.safeParse(input.teamId).success)throw new LocalAuthError(400,'LOCAL_AUTH_INPUT_INVALID','登录字段无效')
  const state=await this.state(),epoch=this.epoch
  const logged=z.strictObject({sessionToken:opaque,expiresAt:wireTimestamp,user}).safeParse(await this.request('/auth/login',{phone:input.phone,password:input.password}))
  if(!logged.success)throw new LocalAuthError(503,'LOCAL_AUTH_INVALID_RESPONSE','授权服务响应无效')
  const appToken=logged.data.sessionToken
  try{
   const identity=meSchema.safeParse(await this.request('/auth/me',undefined,appToken))
   if(!identity.success||identity.data.user.id!==logged.data.user.id||identity.data.expiresAt<=this.now()||this.epoch!==epoch)throw new LocalAuthError(401,'LOCAL_LOGIN_REQUIRED','登录已失效')
   if(state.userId&&state.userId!==identity.data.user.id)throw new LocalAuthError(409,'LOCAL_AUTH_BINDING_MISMATCH','私有目录已绑定其他账号，未自动重绑')
   for(const [key,pending]of this.pending)if(pending.expiresAt<=this.now()){this.pending.delete(key);void this.request('/auth/logout',{},pending.appToken).catch(()=>{})}
   if(this.pending.size>=3)throw new LocalAuthError(429,'LOCAL_AUTH_RATE_LIMITED','待选择登录过多，请完成或退出后重试')
   const selectionId=randomBytes(32).toString('base64url');this.pending.set(selectionId,{appToken,userId:identity.data.user.id,teams:identity.data.teams,expiresAt:Math.min(this.now()+120000,identity.data.expiresAt),epoch,generation:state.generation,busy:false})
   const teamId=input.teamId??state.teamId
   if(teamId)return await this.clientDeviceGrant({selectionId,teamId})
   return {selectionRequired:true,selectionId,user:identity.data.user,teams:identity.data.teams}
  }catch(e){await this.request('/auth/logout',{},appToken).catch(()=>{});throw e}
 }
 async clientDeviceGrant(input:{selectionId:string;teamId:string}):Promise<LocalAuthLoginResult>{
  if(!input||Object.keys(input).some(k=>!['selectionId','teamId'].includes(k))||!opaque.safeParse(input.selectionId).success||!identifier.safeParse(input.teamId).success)throw new LocalAuthError(400,'LOCAL_AUTH_INPUT_INVALID','团队选择无效')
  const pending=this.pending.get(input.selectionId),state=await this.state()
  if(!pending||pending.expiresAt<=this.now()||pending.epoch!==this.epoch||pending.generation!==state.generation)throw new LocalAuthError(401,'LOCAL_LOGIN_REQUIRED','登录选择已失效，请重新登录')
  if(pending.busy)throw new LocalAuthError(409,'LOCAL_AUTH_PENDING','授权正在提交，请读取登录状态')
  if(!pending.teams.some(t=>t.id===input.teamId)||state.userId&&state.userId!==pending.userId||state.teamId&&state.teamId!==input.teamId)throw new LocalAuthError(409,'LOCAL_AUTH_BINDING_MISMATCH','团队不在当前账号范围内或与已有绑定不同')
  pending.busy=true;let grantToken:string|undefined
  try{
   const grant=z.strictObject({grantToken:z.string().regex(/^fm_local_[A-Za-z0-9_-]{43}$/),expiresAt:wireTimestamp}).safeParse(await this.request('/local/grants',{deviceId:state.deviceId,dataRootId:state.dataRootId,teamId:input.teamId},pending.appToken))
   if(!grant.success||grant.data.expiresAt<=this.now())throw new LocalAuthError(503,'LOCAL_AUTH_INVALID_RESPONSE','设备授权响应无效');grantToken=grant.data.grantToken
   const next=await this.store.update(raw=>{const current=this.valid(raw);if(this.epoch!==pending.epoch||current.generation!==state.generation||current.userId&&current.userId!==pending.userId||current.teamId&&current.teamId!==input.teamId)throw new LocalAuthError(409,'LOCAL_AUTH_BINDING_MISMATCH','本地绑定已改变，未保存新授权');return {...current,userId:pending.userId,teamId:input.teamId,generation:randomUUID(),credential:{token:grant.data.grantToken,expiresAt:grant.data.expiresAt}}})
   this.valid(next);this.blocked=false;return {authorized:true,principal:await this.authorize('workspace:read')}
  }catch(e){this.blocked=true;if(grantToken)await this.store.update(raw=>{const current=this.valid(raw);if(current.credential?.token!==grantToken)return current;const {credential:_,...binding}=current;return {...binding,generation:randomUUID()}}).catch(()=>{});if(grantToken)await this.request('/local/revoke',{deviceId:state.deviceId,dataRootId:state.dataRootId},grantToken).catch(()=>{});else await this.request('/auth/logout',{},pending.appToken).catch(()=>{});throw e}finally{this.pending.delete(input.selectionId)}
 }
 async logout(){
  this.epoch++;this.blocked=true;const state=await this.state(),pending=[...this.pending.values()];this.pending.clear()
  let storageFailure:unknown
  try{await this.store.update(raw=>{const current=this.valid(raw);const {credential:_,...binding}=current;return {...binding,generation:randomUUID()}})}catch(error){storageFailure=error}
  let remoteRevoked=true;if(state.credential)try{await this.request('/local/revoke',{deviceId:state.deviceId,dataRootId:state.dataRootId},state.credential.token)}catch{remoteRevoked=false}
  await Promise.all(pending.map(p=>this.request('/auth/logout',{},p.appToken).catch(()=>{remoteRevoked=false})))
  if(storageFailure)throw storageFailure
  return {loggedOut:true,remoteRevoked}
 }
}
