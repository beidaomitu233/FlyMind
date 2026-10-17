import type {DraftGuard,DraftRepository,NativeDraft,NativeDraftKey,NativeDraftUpdate,NativeRecoveryDownload} from './native-types'

export class NativeDraftError extends Error {
  constructor(message:string,readonly code='DRAFT_STORAGE_FAILED'){super(message);this.name='NativeDraftError'}
}
export const draftKey=(key:NativeDraftKey):[string,string,number,string]=>[key.dataRootId,key.diagramId,key.baseRevision,key.sessionId]
export const draftSessionKey=(key:NativeDraftKey):[string,string,string]=>[key.dataRootId,key.diagramId,key.sessionId]
export function acceptsDraftGuard(previous:DraftGuard|undefined,next:DraftGuard):boolean {
  return !previous||next.generation>previous.generation||next.generation===previous.generation&&next.journalVersion>=previous.journalVersion&&next.latestSeq>=previous.latestSeq
}
export function validateNativeDraft(input:unknown):NativeDraft {
  const d=input as NativeDraft
  const integer=(v:unknown,min=0)=>Number.isSafeInteger(v)&&Number(v)>=min
  if(!d||d.formatVersion!==1||![d.dataRootId,d.diagramId,d.sessionId].every(v=>typeof v==='string'&&!!v)||!integer(d.baseRevision,1)||!integer(d.generation,1)||!integer(d.journalVersion,1)||!integer(d.latestSeq)||!integer(d.acknowledgedSeq)||d.acknowledgedSeq>d.latestSeq||typeof d.latestXML!=='string'||typeof d.acknowledgedXML!=='string'||!integer(d.updatedAt,1))throw new NativeDraftError('恢复草稿格式无效，原数据应保留','DRAFT_INVALID')
  if(d.inflight&&(!integer(d.inflight.seq)||d.inflight.seq>d.latestSeq||d.inflight.seq<d.acknowledgedSeq||d.inflight.request?.expectedRevision!==d.baseRevision||typeof d.inflight.request.xml!=='string'||typeof d.inflight.request.requestId!=='string'||!d.inflight.request.requestId))throw new NativeDraftError('未确认请求的恢复数据无效','DRAFT_INVALID')
  return structuredClone(d)
}
export function recoveryDownload(draft:NativeDraft):NativeRecoveryDownload {
  return {filename:`flymind-recovery-${draft.diagramId}-${draft.sessionId}.json`,mimeType:'application/json',contents:JSON.stringify({format:'flymind-native-recovery',schemaVersion:1,draft},null,2)}
}
function storageError(error:unknown):NativeDraftError {
  if(error instanceof NativeDraftError)return error
  return (error as {name?:string})?.name==='QuotaExceededError'?new NativeDraftError('浏览器草稿空间不足，请下载恢复数据','DRAFT_QUOTA'):new NativeDraftError('浏览器草稿未能保存，请下载恢复数据')
}
interface DraftLease {key?:NativeDraftKey;guard:DraftGuard}

/** No in-memory fallback: a failed IDB write must remain visible to the caller. */
export class IndexedDbDraftRepository implements DraftRepository {
  private opened:Promise<IDBDatabase>|undefined
  constructor(readonly name='flymind-native-drafts-v1',private readonly factory:IDBFactory|undefined=globalThis.indexedDB){}
  private open():Promise<IDBDatabase>{
    if(!this.factory)return Promise.reject(new NativeDraftError('此环境无法使用 IndexedDB，请下载恢复数据','DRAFT_UNAVAILABLE'))
    if(!this.opened){
      this.opened=new Promise<IDBDatabase>((resolve,reject)=>{
        const request=this.factory!.open(this.name,1)
        request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('drafts'))db.createObjectStore('drafts');if(!db.objectStoreNames.contains('sessions'))db.createObjectStore('sessions')}
        request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();this.opened=undefined};resolve(db)}
        request.onerror=()=>reject(storageError(request.error))
        request.onblocked=()=>reject(new NativeDraftError('草稿数据库被其他页面阻塞，请下载恢复数据','DRAFT_UNAVAILABLE'))
      }).catch(error=>{this.opened=undefined;throw storageError(error)})
    }
    return this.opened
  }
  async write(update:NativeDraftUpdate):Promise<boolean>{
    const value=structuredClone(update)
    if(value.draft){validateNativeDraft(value.draft);if(JSON.stringify(draftKey(value.key))!==JSON.stringify(draftKey(value.draft))||value.guard.generation!==value.draft.generation||value.guard.journalVersion!==value.draft.journalVersion||value.guard.latestSeq!==value.draft.latestSeq)throw new NativeDraftError('草稿键与序号不一致','DRAFT_INVALID')}
    const db=await this.open()
    return new Promise<boolean>((resolve,reject)=>{
      const tx=db.transaction(['drafts','sessions'],'readwrite'),drafts=tx.objectStore('drafts'),sessions=tx.objectStore('sessions')
      let accepted=false,failure:unknown
      const request=sessions.get(draftSessionKey(value.key))
      request.onsuccess=()=>{
        try{
          const previous=request.result as DraftLease|undefined
          if(!acceptsDraftGuard(previous?.guard,value.guard))return
          if(previous?.key)drafts.delete(draftKey(previous.key))
          if(value.draft)drafts.put(value.draft,draftKey(value.key))
          else drafts.delete(draftKey(value.key))
          // Retain a guard even after clear, so a late old write cannot resurrect a draft.
          sessions.put({key:value.draft?value.key:undefined,guard:value.guard} satisfies DraftLease,draftSessionKey(value.key))
          accepted=true
        }catch(error){failure=error;tx.abort()}
      }
      tx.oncomplete=()=>resolve(accepted)
      tx.onabort=()=>reject(storageError(failure||tx.error))
      tx.onerror=()=>{failure=tx.error}
    })
  }
  async get(key:NativeDraftKey):Promise<NativeDraft|undefined>{
    const db=await this.open()
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts','readonly'),request=tx.objectStore('drafts').get(draftKey(key))
      request.onsuccess=()=>{try{resolve(request.result===undefined?undefined:validateNativeDraft(request.result))}catch(error){reject(error)}}
      request.onerror=()=>reject(storageError(request.error))
    })
  }
  /** Explicit removal is a compare-and-delete, never a clear of a newer session key. */
  async remove(key:NativeDraftKey,guard:DraftGuard):Promise<boolean>{
    const db=await this.open()
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['drafts','sessions'],'readwrite'),drafts=tx.objectStore('drafts'),sessions=tx.objectStore('sessions')
      let removed=false
      const request=sessions.get(draftSessionKey(key))
      request.onsuccess=()=>{
        const lease=request.result as DraftLease|undefined
        if(!lease?.key||JSON.stringify(draftKey(lease.key))!==JSON.stringify(draftKey(key))||lease.guard.generation!==guard.generation||lease.guard.journalVersion!==guard.journalVersion||lease.guard.latestSeq!==guard.latestSeq)return
        drafts.delete(draftKey(key));sessions.put({guard:{...lease.guard,generation:lease.guard.generation+1,journalVersion:lease.guard.journalVersion+1}} satisfies DraftLease,draftSessionKey(key));removed=true
      }
      tx.oncomplete=()=>resolve(removed);tx.onabort=()=>reject(storageError(tx.error));tx.onerror=()=>{}
    })
  }
  async list(filter:{dataRootId?:string;diagramId?:string}={}):Promise<NativeDraft[]>{
    const db=await this.open()
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('drafts','readonly'),request=tx.objectStore('drafts').getAll()
      request.onsuccess=()=>{try{resolve(request.result.map(validateNativeDraft).filter(d=>(!filter.dataRootId||d.dataRootId===filter.dataRootId)&&(!filter.diagramId||d.diagramId===filter.diagramId)))}catch(error){reject(error)}}
      request.onerror=()=>reject(storageError(request.error))
    })
  }
}
