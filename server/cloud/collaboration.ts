import type {Response} from 'express'
import {CloudAccessError,type CloudPrincipal} from './identity'
import type {CloudTeamWorkspaces,CloudTeamWorkspace} from './team-workspaces'
import type {NativeDrawingRecord} from '../../src/drawing/services/native-types'
import {nativeProtocolPatch} from '../../src/drawing/engine/collaboration/protocol-patch'

export interface CollaborationEvent {revision:number;record:NativeDrawingRecord;fromRevision?:number;patch?:Record<string,unknown>}
const identity=(p:CloudPrincipal)=>JSON.stringify([p.user.id,p.session.id,p.team.id,p.authorization?.clientId??''])
interface Peer {team:string;id:string;root:string;token:string;binding:string;response:Response;last?:NativeDrawingRecord;busy:boolean;closed:boolean;opened:number;draining?:boolean;drainTimer?:ReturnType<typeof setTimeout>}
/** A bounded, single-process notification layer. SQLite revisions are the durable
 * cursor. Lost/expired history falls back to a snapshot, never a fabricated log.
 * Polling also observes MCP and other HTTP commits without changing the store. */
export class CloudCollaborationRooms {
 private readonly peers=new Set<Peer>()
 private readonly timer:ReturnType<typeof setInterval>
 private closed=false
 constructor(private readonly workspaces:CloudTeamWorkspaces,private readonly options:{intervalMs?:number;maxConnections?:number;maxRooms?:number;maxPerRoom?:number}={}){
  const interval=options.intervalMs??1000
  if(!Number.isFinite(interval)||interval<20||interval>30000)throw Error('Invalid collaboration interval')
  this.timer=setInterval(()=>this.kick(),interval);this.timer.unref()
 }
 async connect(input:{team:string;id:string;root:string;token:string;principal:CloudPrincipal;workspace:CloudTeamWorkspace;response:Response;since?:number}){
  if(this.closed)throw new CloudAccessError(503,'CLOUD_STOPPING','服务正在关闭')
  const room=(p:Peer)=>JSON.stringify([p.team,p.id]),key=JSON.stringify([input.team,input.id]),existing=[...this.peers]
  if(existing.length>=(this.options.maxConnections??128)||existing.filter(p=>room(p)===key).length>=(this.options.maxPerRoom??16)||!existing.some(p=>room(p)===key)&&new Set(existing.map(room)).size>=(this.options.maxRooms??64))throw new CloudAccessError(503,'COLLABORATION_CAPACITY','协同连接已满，请稍后重试')
  const record=await input.workspace.diagrams.getDrawing(input.id)
  const peer:Peer={...input,binding:identity(input.principal),busy:true,closed:false,opened:Date.now()}
  // Admission is repeated after async storage access; no concurrent overflow.
  if(this.closed)throw new CloudAccessError(503,'CLOUD_STOPPING','服务正在关闭')
  if(this.peers.size>=(this.options.maxConnections??128)||[...this.peers].filter(p=>room(p)===key).length>=(this.options.maxPerRoom??16)||![...this.peers].some(p=>room(p)===key)&&new Set([...this.peers].map(room)).size>=(this.options.maxRooms??64))throw new CloudAccessError(503,'COLLABORATION_CAPACITY','协同连接已满，请稍后重试')
  this.peers.add(peer)
  input.response.status(200).set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'}).flushHeaders()
  input.response.once('close',()=>this.drop(peer))
  try{
   if(input.since!==undefined&&input.since<=record.revision){try{peer.last=await input.workspace.store.getNativeDrawingRevision(input.id,input.since)}catch{/* History may have expired: send latest snapshot. */}}
   this.sendRecord(peer,record,true)
  }catch{this.drop(peer)}finally{peer.busy=false}
 }
 private drop(peer:Peer){if(peer.closed)return;peer.closed=true;clearTimeout(peer.drainTimer);this.peers.delete(peer);peer.response.end()}
 private send(peer:Peer,event:string,data:unknown,revision?:number){
  if(peer.closed||peer.response.destroyed||peer.response.writableEnded){this.drop(peer);return false}
  const frame=(revision===undefined?'':'id: '+revision+'\n')+'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'
  if(Buffer.byteLength(frame)>8_500_000||peer.response.writableLength>1_000_000){this.drop(peer);return false}
  if(!peer.response.write(frame)){
   peer.draining=true
   peer.drainTimer=setTimeout(()=>this.drop(peer),5000);peer.drainTimer.unref()
   peer.response.once('drain',()=>{clearTimeout(peer.drainTimer);peer.draining=false})
  }
  return true
 }
 private sendRecord(peer:Peer,record:NativeDrawingRecord,initial=false){
  if(!initial&&peer.last?.revision===record.revision){this.send(peer,'heartbeat',{revision:record.revision});return}
  const prior=peer.last
  let delta:Record<string,unknown>|undefined
  if(prior)try{delta=nativeProtocolPatch(prior.document.rendering.engine.xml,record.document.rendering.engine.xml)}catch{/* Page identity changes require snapshot. */}
  const event:CollaborationEvent={revision:record.revision,record,...(delta?{fromRevision:prior!.revision,patch:delta}:{})}
  if(this.send(peer,delta?'revision':'snapshot',event,record.revision))peer.last=record
 }
 kick(){if(this.closed)return;for(const peer of this.peers)if(!peer.busy&&!peer.draining){peer.busy=true;void this.poll(peer).finally(()=>{peer.busy=false})}}
 private async poll(peer:Peer){
  try{await this.workspaces.run(peer.token,peer.team,'diagram:read',async(workspace,principal)=>{
   if(peer.closed)return
   if(workspace.dataRootId!==peer.root||identity(principal)!==peer.binding)throw new CloudAccessError(403,'COLLABORATION_BINDING_CHANGED','协同会话身份已改变')
   if(Date.now()-peer.opened>10*60_000){this.send(peer,'reconnect',{code:'COLLABORATION_RECONNECT'});this.drop(peer);return}
   this.sendRecord(peer,await workspace.diagrams.getDrawing(peer.id))
  })}catch(error){if(!peer.closed){
   const failure=error as {status?:number;code?:string},status=failure.status
   const event=status===401||status===403?'access-revoked':status===404||status===410?'diagram-deleted':'unavailable'
   const publicStatus=event==='access-revoked'?status!:event==='diagram-deleted'?410:503
   const code=event==='access-revoked'&&error instanceof CloudAccessError?error.code:event==='diagram-deleted'?'DIAGRAM_DELETED':'COLLABORATION_UNAVAILABLE'
   this.send(peer,event,{code,status:publicStatus});this.drop(peer)
  }}
 }
 close(){this.closed=true;clearInterval(this.timer);for(const peer of this.peers)this.drop(peer)}
 /** Transport reconnect is not an ACK or revocation. Clients keep their durable
  * unconfirmed draft and resume from the last applied persisted revision. */
 quiesce(){if(this.closed)return;for(const peer of this.peers)this.send(peer,'reconnect',{code:'CLOUD_UPDATING',retryAfter:2});this.close()}
}
