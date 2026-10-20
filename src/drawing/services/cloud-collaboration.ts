import type {NativeDrawingRecord,NativeSaveRequest} from './native-types'
import {NativeApiError} from './native-types'

export interface CloudCollaborationEvent {revision:number;record:NativeDrawingRecord;fromRevision?:number;patch?:Record<string,unknown>}
export interface CloudCollaborationOptions {
 /** Same-origin team native prefix, e.g. /cloud-api/teams/t/studio-api/native. */
 baseURL:string;diagramId:string;dataRootId:string;userId:string;fetch?:typeof fetch
}
function endpoint(options:CloudCollaborationOptions,suffix:string){
 if(!/^\/cloud-api\/teams\/[a-zA-Z0-9_-]{1,100}\/studio-api\/native$/.test(options.baseURL)||!/^[a-zA-Z0-9_-]{1,100}$/.test(options.diagramId))throw Error('Invalid collaboration endpoint')
 return options.baseURL+'/collaboration/'+encodeURIComponent(options.diagramId)+'/'+suffix
}
function headers(options:CloudCollaborationOptions){return {'X-FlyMind-DataRoot-Id':options.dataRootId,'X-FlyMind-User-Id':options.userId}}
async function failure(response:Response):Promise<never>{const body=await response.json().catch(()=>({}));throw new NativeApiError(body.error??'协同请求失败',response.status,body.code??'COLLABORATION_UNAVAILABLE',body.currentRevision)}
export async function commitCloudCollaboration(options:CloudCollaborationOptions,request:NativeSaveRequest,signal?:AbortSignal):Promise<{requestId:string;record:NativeDrawingRecord}>{
 const response=await (options.fetch??fetch)(endpoint(options,'commit'),{method:'POST',credentials:'same-origin',redirect:'error',headers:{...headers(options),'Content-Type':'application/json'},body:JSON.stringify(request),signal})
 if(!response.ok)return failure(response)
 const body=await response.json();if(body.requestId!==request.requestId||!body.record||!Number.isSafeInteger(body.record.revision))throw Error('Invalid collaboration acknowledgement');return body
}
/** One stream attempt. Caller owns reconnect/backoff and durable unACK draft.
 * Awaiting onEvent preserves ordering. No snapshot ever replaces local XML here.
 * Reconnect with last applied revision; initial event may be latest snapshot. */
export async function subscribeCloudCollaboration(options:CloudCollaborationOptions & {since?:number;signal:AbortSignal;onEvent:(event:CloudCollaborationEvent)=>void|Promise<void>;onHeartbeat?:(revision:number)=>void}):Promise<void>{
 const response=await (options.fetch??fetch)(endpoint(options,'events')+(options.since===undefined?'':'?since='+options.since),{credentials:'same-origin',redirect:'error',headers:{...headers(options),Accept:'text/event-stream'},signal:options.signal})
 if(!response.ok)return failure(response)
 if(!response.headers.get('content-type')?.startsWith('text/event-stream')||!response.body)throw Error('Invalid collaboration stream')
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending=''
 try{for(;;){
  const result=await reader.read();if(result.done)return
  pending+=decoder.decode(result.value,{stream:true})
  if(pending.length>8_500_000)throw Error('Collaboration stream budget exceeded')
  let end:number
  while((end=pending.indexOf('\n\n'))>=0){
   const frame=pending.slice(0,end);pending=pending.slice(end+2)
   const lines=frame.split('\n'),event=lines.find(l=>l.startsWith('event: '))?.slice(7),data=lines.filter(l=>l.startsWith('data: ')).map(l=>l.slice(6)).join('\n')
   if(!data)continue
   const value=JSON.parse(data)
   if(event==='access-revoked')throw new NativeApiError('协同访问已失效，请保留本地草稿',value.status===401?401:403,value.code??'PERMISSION_DENIED')
   if(event==='diagram-deleted')throw new NativeApiError('图形已删除，请保留本地草稿',410,'DIAGRAM_DELETED')
   if(event==='unavailable')throw new NativeApiError('协同服务暂时不可用，请保留草稿并稍后重连',503,'COLLABORATION_UNAVAILABLE')
   if(event==='reconnect')return
   if(event==='heartbeat'){options.onHeartbeat?.(value.revision);continue}
   if(event!=='snapshot'&&event!=='revision')throw Error('Invalid collaboration event')
   if(!Number.isSafeInteger(value.revision)||value.revision<1||value.record?.revision!==value.revision||typeof value.record?.document?.rendering?.engine?.xml!=='string')throw Error('Invalid collaboration record')
   await options.onEvent(value)
  }
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
