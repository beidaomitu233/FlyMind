import {parseNative,attr} from '../drawio/xml'
import {businessLibraryConfiguration} from './library'

export const MAX_HOST_XML_BYTES=5*1024*1024
export const MAX_HOST_MESSAGE_BYTES=12*1024*1024
export interface HostReady {sessionKey:string}
export interface HostXML extends HostReady {xml:string;reason:'save'|'autosave'}
export interface HostError extends HostReady {code:string;message:string}
export interface HostSaveRequested extends HostReady {reason:'save'|'autosave'}
interface HostMessage {origin:string;source:unknown;data:unknown}
export interface DrawioHostOptions {
  sessionKey:string;initialXML:string;title?:string;origin:string
  source:()=>unknown
  post:(data:string,targetOrigin:string)=>void
  onReady?:(event:HostReady)=>void
  onXML?:(event:HostXML)=>void
  onSaveRequested?:(event:HostSaveRequested)=>void
  onError?:(event:HostError)=>void
  startupTimeoutMs?:number;requestTimeoutMs?:number
  readViewport?:()=>{scrollLeft:number;scrollTop:number}|Promise<{scrollLeft:number;scrollTop:number}>
  fontFamilies?:readonly string[]
}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)
const bytes=(value:string)=>new TextEncoder().encode(value).byteLength
function validXML(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=MAX_HOST_XML_BYTES&&bytes(value)<=MAX_HOST_XML_BYTES&&value.trimStart().startsWith('<')}
export class DrawioHostProtocolError extends Error {
  constructor(readonly code:string,message:string){super(message);this.name='DrawioHostProtocolError'}
}

/** Public embed protocol only. It owns requests, not document persistence. */
export class DrawioHostController {
  private phase:'configure'|'init'|'load'|'ready'|'closed'='configure'
  private committedLoad:{id:string;xml:string}|undefined
  private captureView:{scale:number;translate:{x:number;y:number}}|undefined
  private sequence=0
  private readonly token=globalThis.crypto.randomUUID()
  private startup:ReturnType<typeof setTimeout>|undefined
  private jsonPending=new Map<string,{resolve:(value:Record<string,unknown>)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  private mergePending=new Map<string,{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  private pending=new Map<string,{resolve:(xml:string)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  constructor(private readonly options:DrawioHostOptions){
    const origin=new URL(options.origin)
    if(origin.origin!==options.origin||!['http:','https:'].includes(origin.protocol))throw new DrawioHostProtocolError('INVALID_ORIGIN','Host 必须使用精确 HTTP origin')
    if(!options.sessionKey||options.sessionKey.length>1000||!validXML(options.initialXML))throw new DrawioHostProtocolError('INVALID_INITIAL_DOCUMENT','会话或初始 XML 无效/超过 5 MiB')
    if(options.title!==undefined&&(typeof options.title!=='string'||options.title.length>1000))throw new DrawioHostProtocolError('INVALID_TITLE','标题过长或无效')
    this.startup=setTimeout(()=>this.fail('STARTUP_TIMEOUT','原生编辑器初始化超时'),options.startupTimeoutMs??30000)
  }
  private report(code:string,message:string){this.options.onError?.({sessionKey:this.options.sessionKey,code,message})}
  private fail(code:string,message:string){this.report(code,message);this.dispose(new DrawioHostProtocolError(code,message))}
  private send(action:string,fields:Record<string,unknown>={}){
    if(!['configure','load','export','fit','invokeAction'].includes(action)||action==='invokeAction'&&!['save','selectDescendants','deleteAll','undo','redo','group','ungroup'].includes(String(fields.actionName)))throw new DrawioHostProtocolError('ACTION_DENIED','不允许的原生编辑器动作')
    if(this.phase==='closed')throw new DrawioHostProtocolError('SESSION_CLOSED','编辑会话已关闭')
    this.options.post(JSON.stringify({action,...fields}),this.options.origin)
  }
  handle(event:HostMessage){try{this.receive(event)}catch{this.fail('PROTOCOL_FAILURE','原生消息处理或发送失败')}}
  private receive(event:HostMessage){
    // Do not parse or report messages from other windows/origins.
    if(this.phase==='closed'||event.origin!==this.options.origin||!event.source||event.source!==this.options.source())return
    if(typeof event.data!=='string'||event.data.length>MAX_HOST_MESSAGE_BYTES||bytes(event.data)>MAX_HOST_MESSAGE_BYTES){this.report('INVALID_MESSAGE','原生消息类型或字节上限无效');return}
    let data:unknown;try{data=JSON.parse(event.data)}catch{this.report('INVALID_MESSAGE','原生消息不是 JSON');return}
    if(!object(data)||typeof data.event!=='string'){this.report('INVALID_MESSAGE','原生消息缺少有效 event');return}
    if(data.event==='configure'){
      if(this.phase!=='configure')return
      this.phase='init';this.send('configure',{config:businessLibraryConfiguration(this.options.fontFamilies)});return
    }
    if(data.event==='init'){
      if(this.phase!=='init')return
      this.phase='load';this.send('load',{xml:this.options.initialXML,title:this.options.title??'',autosave:1});return
    }
    if(data.event==='load'&&this.phase==='ready'&&this.committedLoad){const request=this.committedLoad;if(data.xml!==request.xml)return;const pending=this.mergePending.get(request.id);if(!pending)return;this.committedLoad=undefined;this.mergePending.delete(request.id);clearTimeout(pending.timer);pending.resolve();return}
    if(data.event==='load'){
      if(this.phase!=='load')return
      if(!validXML(data.xml)){this.fail('INVALID_LOAD','原生加载回复缺少有效 XML');return}
      clearTimeout(this.startup);this.startup=undefined;this.phase='ready';this.options.onReady?.({sessionKey:this.options.sessionKey});return
    }
    if(data.event==='error'){
      if(typeof data.message==='string'&&data.message.length<=4000)this.report('EDITOR_ERROR',data.message)
      else this.report('INVALID_MESSAGE','无效的编辑器错误消息')
      return
    }
    if(this.phase!=='ready')return
    if(data.event==='autosave'||data.event==='save'){
      if(!validXML(data.xml)){this.report('INVALID_XML','原生保存 XML 无效或超过 5 MiB');return}
      const reason=data.event;this.options.onXML?.({sessionKey:this.options.sessionKey,xml:data.xml,reason})
      this.options.onSaveRequested?.({sessionKey:this.options.sessionKey,reason});return
    }
    if(data.event==='merge'&&object(data.message)&&data.message.action==='merge'&&typeof data.message.message==='string'){const request=this.mergePending.get(data.message.message);if(!request)return;this.mergePending.delete(data.message.message);clearTimeout(request.timer);if(data.error!==undefined)request.reject(new DrawioHostProtocolError('MERGE_FAILED','原生编辑器应用失败'));else request.resolve();return}
    if(data.event==='export'&&object(data.message)&&data.message.action==='export'&&data.message.format==='json'&&typeof data.message.message==='string'){const pending=this.jsonPending.get(data.message.message);if(!pending)return;this.jsonPending.delete(data.message.message);clearTimeout(pending.timer);if(data.format!=='json'||data.error!==undefined||!object(data.data))pending.reject(new DrawioHostProtocolError('SELECTION_FAILED','原生选区读取无效'));else pending.resolve(data.data);return}
    if(data.event==='export'){
      // Fixed 31.5.3 echoes the request object, not the message string itself.
      if(!object(data.message)||data.message.action!=='export'||data.message.format!=='xml'||typeof data.message.message!=='string')return
      const id=data.message.message,pending=this.pending.get(id);if(!pending)return
      this.pending.delete(id);clearTimeout(pending.timer)
      if(data.error!==undefined||data.format!=='xml'||!validXML(data.xml))pending.reject(new DrawioHostProtocolError('CAPTURE_FAILED','原生 XML 抓取返回错误或无效数据'))
      else {if(typeof data.scale==='number'&&data.scale>0&&object(data.translate)&&typeof data.translate.x==='number'&&typeof data.translate.y==='number')this.captureView={scale:data.scale,translate:{x:data.translate.x,y:data.translate.y}};pending.resolve(data.xml)}
    }
  }
  captureXML():Promise<string>{
    if(this.phase!=='ready')return Promise.reject(new DrawioHostProtocolError(this.phase==='closed'?'SESSION_CLOSED':'NOT_READY','编辑器尚未就绪或已关闭'))
    if(this.pending.size>=16)return Promise.reject(new DrawioHostProtocolError('TOO_MANY_REQUESTS','XML 抓取请求过多'))
    const id=`${this.token}:${++this.sequence}`
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);const error=new DrawioHostProtocolError('CAPTURE_TIMEOUT','原生 XML 抓取超时');reject(error);this.report(error.code,error.message)},this.options.requestTimeoutMs??10000)
      this.pending.set(id,{resolve,reject,timer})
      try{this.send('export',{format:'xml',message:id})}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error)}
    })
  }
  /** Explicit user save/switch boundary only. Same-target messages preserve order. */
  commitAndCaptureXML():Promise<string>{
    if(this.phase!=='ready')return Promise.reject(new DrawioHostProtocolError(this.phase==='closed'?'SESSION_CLOSED':'NOT_READY','编辑器尚未就绪或已关闭'))
    try{this.send('invokeAction',{actionName:'save'})}catch(error){return Promise.reject(error)}
    return this.captureXML()
  }
  /** Caller confirms a mindmap branch operation. Native traversal/deletion are
   * one native undoable edit; no server-side invisible descendant deletion. */
  private captureSelection():Promise<Record<string,unknown>>{if(this.jsonPending.size+this.pending.size>=16)return Promise.reject(new DrawioHostProtocolError('TOO_MANY_REQUESTS','原生请求过多'));if(this.phase!=='ready')return Promise.reject(new DrawioHostProtocolError('NOT_READY','编辑器尚未就绪'));const id=`${this.token}:selection:${++this.sequence}`;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.jsonPending.delete(id);reject(new DrawioHostProtocolError('SELECTION_TIMEOUT','选区读取超时'))},this.options.requestTimeoutMs??10000);this.jsonPending.set(id,{resolve,reject,timer});try{this.send('export',{format:'json',selection:1,includeData:0,compressed:0,message:id})}catch(error){clearTimeout(timer);this.jsonPending.delete(id);reject(error)}})}
  async deleteSelectedBranch():Promise<string>{const xml=await this.commitAndCaptureXML(),n=parseNative(xml);if(![...n.cells.values()].some(e=>attr(e.object,'fmType')==='decoration'&&attr(e.object,'fmRole')==='title'&&attr(e.object,'fmKind')==='mindmap'))throw new DrawioHostProtocolError('NOT_MINDMAP','删除分支只适用于业务脑图');const selection=await this.captureSelection(),pages=selection.pages;if(!Array.isArray(pages)||pages.length!==1||!object(pages[0])||!Array.isArray(pages[0].cells))throw new DrawioHostProtocolError('INVALID_SELECTION','选区结构无效');const cells=pages[0].cells.filter(object),ids=new Set(cells.map(c=>c.id)),roots=cells.filter(c=>!ids.has(c.parent));if(roots.length!==1||!object(roots[0].metadata)||roots[0].metadata.fmType!=='node'||roots[0].metadata.fmKind!=='topic'||(roots[0].metadata.fmRole??'main')!=='main')throw new DrawioHostProtocolError('SELECT_ONE_TOPIC','请只选择一个脑图主题');const selected=roots[0].id;if(![...n.cells.values()].some(e=>e.id===selected&&attr(e.object,'fmParentId')))throw new DrawioHostProtocolError('ROOT_BRANCH_DELETE','根主题不能作为待删除分支');const expected=new Set<string>([String(selected)]);let count=-1;while(count!==expected.size){count=expected.size;const business=new Set([...expected].map(id=>attr(n.cells.get(id)!.object,'fmId')));for(const e of n.cells.values())if(attr(e.object,'fmType')==='node'&&attr(e.object,'fmKind')==='topic'&&(attr(e.object,'fmRole')??'main')==='main'&&business.has(attr(e.object,'fmParentId')))expected.add(e.id)}this.send('invokeAction',{actionName:'selectDescendants'});const descendants=await this.captureSelection(),actualPages=descendants.pages;if(!Array.isArray(actualPages)||actualPages.length!==1||!object(actualPages[0])||!Array.isArray(actualPages[0].cells))throw new DrawioHostProtocolError('INVALID_SELECTION','原生分支选区无效');const actual=new Set(actualPages[0].cells.filter(object).filter(c=>object(c.metadata)&&c.metadata.fmType==='node'&&c.metadata.fmKind==='topic'&&(c.metadata.fmRole??'main')==='main').map(c=>String(c.id)));if(actual.size!==expected.size||[...actual].some(id=>!expected.has(id)))throw new DrawioHostProtocolError('BRANCH_SELECTION_MISMATCH','原生树遍历与明确父子关系不一致，已停止删除；请先修复业务关系/交叉边属性');this.send('invokeAction',{actionName:'deleteAll'});return this.commitAndCaptureXML()}
  async getSelection():Promise<{cellId:string;businessId?:string;type?:string}[]>{const selection=await this.captureSelection();if(!Array.isArray(selection.pages)||selection.pages.length!==1||!object(selection.pages[0])||!Array.isArray(selection.pages[0].cells))throw new DrawioHostProtocolError('INVALID_SELECTION','选区结构无效');return selection.pages[0].cells.filter(object).filter(c=>typeof c.id==='string').map(c=>({cellId:String(c.id),...(object(c.metadata)&&typeof c.metadata.fmId==='string'?{businessId:c.metadata.fmId}:{}),...(object(c.metadata)&&typeof c.metadata.fmType==='string'?{type:c.metadata.fmType}:{})}))}
  /** Explicit content commit boundary: native load clears pre-commit Undo.
   * Never called by autosave/ack; viewport restored, selection intentionally reset. */
  async mergeXML(xml:string):Promise<void>{if(this.phase!=='ready')throw new DrawioHostProtocolError('NOT_READY','编辑器尚未就绪');if(!validXML(xml))throw new DrawioHostProtocolError('INVALID_XML','XML 无效或超过字节预算');parseNative(xml);if(this.mergePending.size)throw new DrawioHostProtocolError('TOO_MANY_REQUESTS','已有属性提交');await this.captureXML();const view=this.captureView;if(!view||!this.options.readViewport)throw new DrawioHostProtocolError('VIEWPORT_UNAVAILABLE','无法读取当前视口，未应用属性');const scroll=await this.options.readViewport();if(!Number.isFinite(scroll.scrollLeft)||!Number.isFinite(scroll.scrollTop))throw new DrawioHostProtocolError('VIEWPORT_UNAVAILABLE','当前滚动位置无效');const id=`${this.token}:commit:${++this.sequence}`;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.mergePending.delete(id);this.committedLoad=undefined;reject(new DrawioHostProtocolError('APPLY_TIMEOUT','属性提交超时'))},this.options.requestTimeoutMs??10000);this.mergePending.set(id,{resolve,reject,timer});this.committedLoad={id,xml};try{this.send('load',{xml,title:this.options.title??'',autosave:1,scale:view.scale,scroll:{x:scroll.scrollLeft/view.scale-view.translate.x,y:scroll.scrollTop/view.scale-view.translate.y},message:id})}catch(error){clearTimeout(timer);this.mergePending.delete(id);reject(error)}})}
  /** Native visual grouping only; business identity and persistence stay external. */
  async groupSelection(ungroup=false):Promise<string>{
    if(this.phase!=='ready')throw new DrawioHostProtocolError('NOT_READY','编辑器尚未就绪')
    await this.commitAndCaptureXML()
    this.send('invokeAction',{actionName:ungroup?'ungroup':'group'})
    return this.commitAndCaptureXML()
  }
  undo():Promise<void>{if(this.phase!=='ready')return Promise.reject(new DrawioHostProtocolError('NOT_READY','编辑器尚未就绪'));this.send('invokeAction',{actionName:'undo'});return Promise.resolve()}
  redo():Promise<void>{if(this.phase!=='ready')return Promise.reject(new DrawioHostProtocolError('NOT_READY','编辑器尚未就绪'));this.send('invokeAction',{actionName:'redo'});return Promise.resolve()}
  fit(){if(this.phase!=='ready')throw new DrawioHostProtocolError('NOT_READY','编辑器尚未就绪');this.send('fit',{border:16,maxScale:1})}
  dispose(error:Error=new DrawioHostProtocolError('SESSION_CLOSED','编辑会话已关闭')){
    this.phase='closed';clearTimeout(this.startup);this.startup=undefined
    for(const request of this.mergePending.values()){clearTimeout(request.timer);request.reject(error)}this.mergePending.clear()
    for(const request of this.jsonPending.values()){clearTimeout(request.timer);request.reject(error)}this.jsonPending.clear()
    for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(error)}this.pending.clear()
  }
}
