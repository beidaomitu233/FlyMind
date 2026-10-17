import {NativeApiError,nativeRecordIdentity,type DraftRepository,type NativeAcknowledgement,type NativeDraft,type NativeDraftKey,type NativeDraftUpdate,type NativePendingSave,type NativeDrawingRecord,type NativeRecoveryDownload,type NativeSessionSnapshot,type NativeSessionStatus,type NativeTransport} from '../services/native-types'
import {NativeDraftError,recoveryDownload,validateNativeDraft} from '../services/native-drafts'

export interface NativeSessionOptions {
  dataRootId:string;diagramId:string;transport:NativeTransport;drafts:DraftRepository;sessionId?:string
  requestId?:()=>string
  onChange?:(snapshot:NativeSessionSnapshot)=>void
  onAcknowledged?:(ack:NativeAcknowledgement)=>void
}
export type NativeRecoveryResult={kind:'ready'|'pending-retry';session:NativeSaveSession}|{
  kind:'conflict'|'deleted'|'workspace-mismatch';draft:NativeDraft;error:NativeApiError;remoteRevision?:number;download:NativeRecoveryDownload
}
const uuid=()=>globalThis.crypto.randomUUID()
function apiError(error:unknown){return error instanceof NativeApiError?error:new NativeApiError((error as Error)?.message||'提交结果尚未确认',0,'NETWORK_ERROR')}
function deleted(error:NativeApiError){return (error.status===404||error.status===410)&&error.code!=='NATIVE_PILOT_DISABLED'}
function checkRecord(record:NativeDrawingRecord,id:string){
  if(record?.format!==3||record.document?.schemaVersion!==3||('mode'in record.document?record.document.mode!=='canvas-only'||record.document.id!==id:record.document.content?.id!==id)||typeof record.document.rendering?.engine?.xml!=='string'||!Number.isSafeInteger(record.revision)||record.revision<1)throw new NativeApiError('原生记录响应与当前图形不一致',0,'INVALID_RESPONSE')
}

/** Framework-independent, one-request save state machine. XML returned by an ack never replaces latestXML. */
export class NativeSaveSession {
  readonly dataRootId:string;readonly diagramId:string;readonly sessionId:string
  private generation=1
  private baseRevision:number
  private latestXML:string
  private acknowledgedXML:string
  private latestSeq=0
  private acknowledgedSeq=0
  private journalVersion=0
  private backedUp=true
  private status:NativeSessionStatus='ready'
  private error:NativeApiError|NativeDraftError|undefined
  private inflight:NativePendingSave|undefined
  private running:Promise<void>|undefined
  private persistTail:Promise<void>=Promise.resolve()
  private closed=false
  private constructor(private readonly options:NativeSessionOptions,record:NativeDrawingRecord,draft?:NativeDraft){
    this.dataRootId=options.dataRootId;this.diagramId=options.diagramId;this.sessionId=draft?.sessionId||options.sessionId||uuid()
    this.baseRevision=draft?.baseRevision??record.revision
    this.latestXML=draft?.latestXML??record.document.rendering.engine.xml
    this.acknowledgedXML=draft?.acknowledgedXML??this.latestXML
    if(draft){this.latestSeq=draft.latestSeq;this.acknowledgedSeq=draft.acknowledgedSeq;this.inflight=structuredClone(draft.inflight);this.generation=draft.generation+1;this.journalVersion=draft.journalVersion+1;this.backedUp=false;this.status=this.inflight?'offline':this.dirty?'dirty':'ready'}
  }
  static async open(options:NativeSessionOptions):Promise<NativeSaveSession>{
    const health=await options.transport.health()
    if(health.dataRootId!==options.dataRootId)throw new NativeApiError('工作区身份已改变，请保留草稿并重新打开',409,'WORKSPACE_MISMATCH')
    if(!health.capabilities.nativePilot||!health.capabilities.nativeDocumentWrites)throw new NativeApiError('Native pilot 未启用',404,'NATIVE_PILOT_DISABLED')
    const record=await options.transport.get(options.diagramId);checkRecord(record,options.diagramId)
    return new NativeSaveSession(options,record)
  }
  private get dirty(){return !!this.inflight||this.latestXML!==this.acknowledgedXML}
  private key():NativeDraftKey{return {dataRootId:this.dataRootId,diagramId:this.diagramId,baseRevision:this.baseRevision,sessionId:this.sessionId}}
  private draft():NativeDraft{return {...this.key(),formatVersion:1,generation:this.generation,journalVersion:Math.max(1,this.journalVersion),latestSeq:this.latestSeq,latestXML:this.latestXML,acknowledgedXML:this.acknowledgedXML,acknowledgedSeq:this.acknowledgedSeq,...(this.inflight?{inflight:structuredClone(this.inflight)}:{}),updatedAt:Date.now()}}
  snapshot():NativeSessionSnapshot{
    const error=this.error?{message:this.error.message,code:this.error.code,status:this.error instanceof NativeApiError?this.error.status:0,...(this.error instanceof NativeApiError&&this.error.currentRevision!==undefined?{currentRevision:this.error.currentRevision}:{})}:undefined
    return {...this.key(),generation:this.generation,latestXML:this.latestXML,latestSeq:this.latestSeq,acknowledgedSeq:this.acknowledgedSeq,dirty:this.dirty,backedUp:this.backedUp,status:this.status,...(this.inflight?{inflight:structuredClone(this.inflight)}:{}),...(error?{error}:{})}
  }
  private emit(){try{this.options.onChange?.(this.snapshot())}catch{/* Observers cannot change commit certainty. */}}
  private active(generation:number){return !this.closed&&generation===this.generation}
  private assertOpen(){if(this.closed)throw new NativeApiError('保存会话已关闭',0,'SESSION_CLOSED')}
  private touch(){this.journalVersion++;this.backedUp=false}
  private persist():Promise<void>{
    const draft=this.draft(),generation=this.generation,version=this.journalVersion
    const retain=this.dirty||this.error instanceof NativeApiError&&[409,404,410].includes(this.error.status)
    const update:NativeDraftUpdate={key:this.key(),guard:{generation,journalVersion:Math.max(1,version),latestSeq:this.latestSeq},...(retain?{draft}:{})}
    const task=this.persistTail.then(async()=>{
      const accepted=await this.options.drafts.write(update)
      if(!accepted)throw new NativeDraftError('此草稿已有更新的恢复会话，请保留当前内容','DRAFT_SUPERSEDED')
      if(this.generation===generation&&this.journalVersion===version){this.backedUp=true;this.emit()}
    }).catch(error=>{
      const failure=error instanceof NativeDraftError?error:new NativeDraftError((error as Error)?.message||'草稿未能保存，请下载恢复数据')
      if(this.generation===generation){this.error=failure;if(!this.closed)this.status='draft-error';this.backedUp=false;this.emit()}
      throw failure
    })
    this.persistTail=task.catch(()=>{})
    return task
  }
  async edit(xml:string):Promise<void>{
    this.assertOpen();if(typeof xml!=='string')throw new NativeApiError('编辑内容应为 XML 字符串',400,'INVALID_XML')
    if(xml===this.latestXML)return
    this.latestXML=xml;this.latestSeq++;this.touch()
    if(!['conflict','deleted','offline'].includes(this.status)){this.status=this.inflight?'saving':this.dirty?'dirty':'ready';this.error=undefined}
    this.emit();await this.persist()
  }
  flush():Promise<void>{
    this.assertOpen()
    if(this.running)return this.running
    if(['conflict','deleted','offline','invalid','draft-error'].includes(this.status))return Promise.reject(this.error||new NativeApiError('当前草稿需要恢复操作后才能继续保存',409,'SAVE_BLOCKED'))
    return this.start()
  }
  private start():Promise<void>{
    if(this.running)return this.running
    const generation=this.generation
    const running=this.pump(generation).finally(()=>{if(this.running===running)this.running=undefined})
    this.running=running
    return running
  }
  private async pump(generation:number):Promise<void>{
    while(this.active(generation)){
      if(!this.inflight&&!this.dirty){this.status='ready';this.emit();return}
      if(!this.inflight){this.inflight={seq:this.latestSeq,request:{xml:this.latestXML,expectedRevision:this.baseRevision,requestId:this.options.requestId?.()||uuid()}};this.touch()}
      const pending=this.inflight
      this.status='saving';this.error=undefined;this.emit()
      // A failed backup prevents a network request. The exact request stays recoverable in memory.
      await this.persist()
      if(!this.active(generation))return
      let record:NativeDrawingRecord
      try{
        record=await this.options.transport.saveEditor(this.diagramId,structuredClone(pending.request))
        if(!this.active(generation))return
        checkRecord(record,this.diagramId)
        if(record.revision<pending.request.expectedRevision)throw new NativeApiError('确认响应的修订号无效',0,'INVALID_RESPONSE')
      }catch(error){
        if(!this.active(generation))return
        const failure=apiError(error);this.error=failure
        const newer=this.latestSeq>pending.seq
        if(failure.uncertain)this.status='offline'
        else if(failure.status===409){this.inflight=undefined;this.status='conflict'}
        else if(deleted(failure)){this.inflight=undefined;this.status='deleted'}
        else if([400,413,422].includes(failure.status)){this.inflight=undefined;this.status=newer?'dirty':'invalid'}
        else this.status='offline' // Retry exactly; do not reinterpret an unsuccessful response as an ack.
        this.touch();this.emit();await this.persist()
        if(!this.active(generation))return
        if([400,413,422].includes(failure.status)&&newer)continue
        throw failure
      }
      if(!this.active(generation)||this.inflight!==pending)return
      this.baseRevision=record.revision;this.acknowledgedXML=pending.request.xml;this.acknowledgedSeq=pending.seq;this.inflight=undefined
      this.status=this.dirty?'dirty':'ready';this.error=undefined;this.touch();this.emit()
      // Move/clear the old baseRevision key atomically before submitting the next edit.
      await this.persist()
      if(!this.active(generation))return
      try{this.options.onAcknowledged?.({request:structuredClone(pending.request),record:structuredClone(record),seq:pending.seq,hasNewerEdits:this.latestSeq>pending.seq})}catch{/* An observer failure cannot undo a known server commit. */}
    }
  }
  /** Explicit content action: caller must hold editor interaction and merge this exact record first. */
  async adoptCommitted(record:NativeDrawingRecord,expectedRevision:number):Promise<void>{
    this.assertOpen();checkRecord(record,this.diagramId)
    if(this.running||this.inflight||this.dirty||(this.baseRevision!==expectedRevision&&!(this.baseRevision===record.revision&&this.latestXML===record.document.rendering.engine.xml))||record.revision<expectedRevision)throw new NativeApiError('编辑期间状态已改变，不能采纳业务属性结果',409,'REVISION_CONFLICT',this.baseRevision)
    this.baseRevision=record.revision;this.latestXML=record.document.rendering.engine.xml;this.acknowledgedXML=this.latestXML;this.latestSeq++;this.acknowledgedSeq=this.latestSeq;this.error=undefined;this.status='ready';this.touch();this.emit();await this.persist()
  }
  async retry():Promise<void>{
    this.assertOpen();if(this.running)return this.running
    if(this.status==='conflict'||this.status==='deleted')throw this.error||new NativeApiError('请保留草稿并另存，不能覆盖远端',409,'SAVE_BLOCKED')
    const generation=this.generation
    try{
      const health=await this.options.transport.health()
      if(!this.active(generation))return
      if(health.dataRootId!==this.dataRootId)throw new NativeApiError('工作区身份已改变，请另存恢复数据',409,'WORKSPACE_MISMATCH')
      if(!health.capabilities.nativePilot||!health.capabilities.nativeDocumentWrites)throw new NativeApiError('Native pilot 未启用',404,'NATIVE_PILOT_DISABLED')
      const remote=await this.options.transport.get(this.diagramId)
      if(!this.active(generation))return
      checkRecord(remote,this.diagramId)
      if(this.inflight?remote.revision<this.inflight.request.expectedRevision:remote.revision!==this.baseRevision)throw new NativeApiError('远端修订与草稿不一致，请保留并另存',409,'REVISION_CONFLICT',remote.revision)
    }catch(error){
      if(!this.active(generation))return
      const failure=apiError(error);this.error=failure;this.status=failure.status===409?'conflict':deleted(failure)?'deleted':'offline';this.touch();this.emit();await this.persist();throw failure
    }
    if(!this.active(generation))return
    this.error=undefined;this.status=this.dirty?'dirty':'ready';this.touch();this.emit()
    await this.persist()
    if(!this.active(generation))return
    return this.start()
  }
  async close():Promise<void>{
    if(this.closed)return this.persistTail
    this.closed=true;this.generation++;this.status='closed';this.touch();this.emit()
    await this.persist()
  }
  downloadRecovery():NativeRecoveryDownload{return recoveryDownload(this.draft())}

  static async recover(options:NativeSessionOptions,input:unknown):Promise<NativeRecoveryResult>{
    const draft=validateNativeDraft(input),health=await options.transport.health()
    const blocked=(kind:'conflict'|'deleted'|'workspace-mismatch',error:NativeApiError,remoteRevision?:number):NativeRecoveryResult=>({kind,draft,error,remoteRevision,download:recoveryDownload(draft)})
    if(draft.dataRootId!==options.dataRootId||health.dataRootId!==draft.dataRootId||draft.diagramId!==options.diagramId)return blocked('workspace-mismatch',new NativeApiError('草稿与当前工作区身份不一致',409,'WORKSPACE_MISMATCH'))
    if(!health.capabilities.nativePilot||!health.capabilities.nativeDocumentWrites)throw new NativeApiError('Native pilot 未启用',404,'NATIVE_PILOT_DISABLED')
    let record:NativeDrawingRecord
    try{record=await options.transport.get(options.diagramId);checkRecord(record,options.diagramId)}catch(error){const failure=apiError(error);if(deleted(failure))return blocked('deleted',failure);throw failure}
    if(draft.inflight?record.revision<draft.inflight.request.expectedRevision:record.revision!==draft.baseRevision)return blocked('conflict',new NativeApiError('草稿基准修订与远端不一致',409,'REVISION_CONFLICT',record.revision),record.revision)
    // Two tabs may restore the same source simultaneously. Fork their local journals,
    // while preserving the uncertain server request exactly for idempotent resolution.
    const session=new NativeSaveSession(options,record,{...draft,sessionId:uuid()})
    session.touch();await session.persist()
    return {kind:draft.inflight?'pending-retry':'ready',session}
  }
}

export const recoverNativeSession=NativeSaveSession.recover
