import {NativeApiError,type NativeHealth,type NativeRecord,type NativeDrawingRecord,type NativeImportRequest,type NativeImportPreview,type NativeSaveRequest,type NativeTransport,type NativeWorkspace,type NativeExportJob,type NativeExportOptions} from './native-types'
import packageInfo from '../../../package.json'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION,DEFAULT_SWIMLANE_PROFILE} from '../engine/constants'
import {nativeDocumentCapabilities} from './native-capabilities'

/** Native API adapter only; no localStorage replay and no document downgrades. */
export class NativeClient implements NativeTransport {
  readonly expectedDataRootId:string|undefined
  private readonly base:string
  private readonly fetcher:typeof fetch
  private readonly bootstrap:boolean
  private readonly token:string|undefined
  private session:Promise<void>|undefined
  constructor(baseURL='',options:{fetch?:typeof fetch;expectedDataRootId?:string;sessionToken?:string;bootstrapSession?:boolean}={}){this.base=baseURL.replace(/\/$/,'');this.fetcher=options.fetch??globalThis.fetch.bind(globalThis);this.expectedDataRootId=options.expectedDataRootId;this.token=options.sessionToken;this.bootstrap=options.bootstrapSession??(typeof window!=='undefined'&&!this.token)}
  private async browserSession(){
    if(!this.session)this.session=(async()=>{const health=await this.health();if(!health.capabilities.nativePilot)throw new NativeApiError('Native pilot未启用',404,'NATIVE_PILOT_DISABLED');const response=await this.fetcher(this.base+'/studio-api/session',{method:'POST',cache:'no-store',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({...(this.expectedDataRootId?{expectedDataRootId:this.expectedDataRootId}:{})})});const value=await response.json();if(!response.ok)throw new NativeApiError(value?.error||'浏览器会话失败',response.status,value?.code||'SESSION_REQUIRED');if(value.dataRootId!==health.dataRootId||value.instanceId!==health.runtime?.instanceId)throw new NativeApiError('浏览器会话身份已改变',409,'WORKSPACE_MISMATCH')})().catch(e=>{this.session=undefined;throw e})
    return this.session
  }
  private async request<T>(path:string,method='GET',body?:unknown):Promise<T>{
    let response:Response
    if(method!=='GET'&&!this.expectedDataRootId)throw new NativeApiError('保存客户端尚未绑定工作区身份',409,'WORKSPACE_MISMATCH')
    if(this.bootstrap&&path!=='/health')await this.browserSession()
    const headers={...(body!==undefined?{'Content-Type':'application/json'}:{}),...(this.expectedDataRootId?{'X-FlyMind-DataRoot-Id':this.expectedDataRootId}:{}),...(this.token?{Authorization:'Bearer '+this.token}:{})}
    const send=async()=>{try{return await this.fetcher(this.base+'/studio-api'+path,{method,cache:'no-store',credentials:'same-origin',redirect:'error',headers,body:body!==undefined?JSON.stringify(body):undefined})}catch(error){throw new NativeApiError((error as Error)?.message||'本地服务未连接',0,'NETWORK_ERROR')}}
    response=await send()
    if(response.status===401&&this.bootstrap&&path!=='/health'){this.session=undefined;await this.browserSession();response=await send()}
    let value:any
    try{value=await response.json()}catch{throw new NativeApiError('服务响应不完整，提交结果尚未确认',0,'INVALID_RESPONSE')}
    if(!response.ok)throw new NativeApiError(typeof value?.error==='string'?value.error:'原生文档请求失败',response.status,typeof value?.code==='string'?value.code:'REQUEST_FAILED',Number.isSafeInteger(value?.currentRevision)?value.currentRevision:undefined)
    return value as T
  }
  async health(){const value=await this.request<NativeHealth>('/health');if(typeof value?.dataRootId!=='string'||!value.dataRootId||!value.capabilities)throw new NativeApiError('工作区身份响应无效',0,'INVALID_RESPONSE');if(this.expectedDataRootId&&value.dataRootId!==this.expectedDataRootId)throw new NativeApiError('工作区身份已改变，不能自动重绑',409,'WORKSPACE_MISMATCH');if(this.bootstrap&&value.capabilities.nativePilot){const r=value.runtime,c=value.capabilities,expected=nativeDocumentCapabilities();if(value.name!=='flymind'||value.version!==packageInfo.version||value.storage!=='sqlite'||r?.application!=='flymind'||r.appVersion!==packageInfo.version||r.apiVersion!==1||!r.instanceId||!r.rootPathId||c.apiVersion!==1||c.drawingProjectVersion!==3||c.drawioVersion!==DRAWIO_VERSION||c.adapterVersion!==DRAWIO_ADAPTER_VERSION||c.profile?.id!==DEFAULT_SWIMLANE_PROFILE.id||c.profile.version!==DEFAULT_SWIMLANE_PROFILE.version||JSON.stringify(c.supportedKinds)!==JSON.stringify(expected.supportedKinds)||JSON.stringify(c.profiles)!==JSON.stringify(expected.profiles)||c.configureRendering!==expected.configureRendering||JSON.stringify(c.imports)!==JSON.stringify(expected.imports)||c.nativeExports!==true)throw new NativeApiError('Runtime版本/能力握手不符',409,'RUNTIME_VERSION_MISMATCH')}return value}
  async get(id:string){return this.request<NativeDrawingRecord>('/native/diagrams/'+encodeURIComponent(id))}
  async capabilities(){return this.request<ReturnType<typeof nativeDocumentCapabilities>>('/native/capabilities')}
  async importBusiness(input:NativeImportRequest){return this.request<NativeDrawingRecord>('/native/imports','POST',input)}
  async previewImport(input:NativeImportRequest){return this.request<NativeImportPreview>('/native/imports/preview','POST',input)}
  async groups(){return this.request<{groups:Array<{id:string;name:string}>}>('/native/groups')}
  async organization(path:string,method:string,input?:unknown){return this.request<unknown>('/native'+path,method,input)}
  async trash(){return this.request<{diagrams:import('./sidebar-adapter').SidebarTrash[]}>('/native/trash')}
  async patchContent(id:string,input:{operations:unknown[];expectedRevision:number;requestId:string}){return this.request<NativeRecord>('/native/diagrams/'+encodeURIComponent(id)+'/content-patch','POST',input)}
  async mapCanvas(id:string,input:{mapping:import('../engine/types').NativeBusinessMapping;expectedRevision:number;requestId:string}){return this.request<NativeRecord>('/native/diagrams/'+encodeURIComponent(id)+'/business-mapping','POST',input)}
  async canvasMappingCells(id:string){return this.request<{id:string;title:string;revision:number;enabled:boolean;cells:import('../engine/types').NativeCanvasCell[]}>('/native/diagrams/'+encodeURIComponent(id)+'/business-mapping')}
  async previewCanvasMapping(id:string,input:{mapping:import('../engine/types').NativeBusinessMapping;expectedRevision:number}){return this.request<{revision:number;kind:import('../core/model').DiagramKind;nodes:number;edges:number;quality:NonNullable<NativeRecord['quality']>}>('/native/diagrams/'+encodeURIComponent(id)+'/business-mapping/preview','POST',input)}
  async list(){return this.request<NativeWorkspace['metadata']>('/native/diagrams')}
  async workspace(){return this.request<NativeWorkspace>('/native/workspace')}
  async create(input:{content:unknown;requestId:string;profile?:unknown;preferences?:unknown;workspaceGroupId?:string|null}){return this.request<NativeRecord>('/native/diagrams','POST',input)}
  async saveEditor(id:string,request:NativeSaveRequest){return this.request<NativeDrawingRecord>('/native/diagrams/'+encodeURIComponent(id)+'/editor-save','POST',request)}
  async configureRendering(id:string,input:{rendering:{relayout:true;orientation?:'vertical'|'horizontal'};expectedRevision:number;requestId:string}){return this.request<NativeRecord>('/native/diagrams/'+encodeURIComponent(id)+'/rendering','POST',input)}
  async createExport(id:string,input:{expectedRevision:number;requestId:string;options?:NativeExportOptions}){return this.request<NativeExportJob>('/native/diagrams/'+encodeURIComponent(id)+'/exports','POST',input)}
  async exportJob(id:string){return this.request<NativeExportJob>('/native/exports/'+encodeURIComponent(id))}
  async retryExport(id:string,input:{requestId:string}){return this.request<NativeExportJob>('/native/exports/'+encodeURIComponent(id)+'/retry','POST',input)}
}
