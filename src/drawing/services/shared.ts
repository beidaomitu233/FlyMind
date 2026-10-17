import { ref, type Ref, type ComputedRef } from 'vue'
import { projectDocument } from '../core/layers'
import { copy, newId, validateDocument, type DiagramDocument } from '../core/model'
import type { RecordData, WorkspaceGroup, WorkspaceSnapshot,TrashItem } from './workspace-types'
const KEY='flymind-drawing-studio-v1'
const hydrate=(r:RecordData)=>validateDocument({...r.document,createdAt:r.createdAt??r.document.createdAt})
function read<T>(key:string,fallback:T):T{try{return JSON.parse(localStorage.getItem(KEY+key)||'null')??fallback}catch{return fallback}}
function stable(value:any):any{return Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value}
const signature=(d:DiagramDocument)=>JSON.stringify(stable({...d,updatedAt:0,createdAt:0}))
export function sharedWorkspace(ctx:{documents:Ref<DiagramDocument[]>;activeId:Ref<string>;current:ComputedRef<DiagramDocument>;storageError:Ref<string>;notify:(s:string)=>void;reset:()=>void}){
  const shared=ref(false),loading=ref(false),pending=ref(0),conflictId=ref(''),revisions=ref<Record<string,number>>(read('-revisions',{}))
  const workspaceGroups=ref<WorkspaceGroup[]>([]),assignments=ref<Record<string,string|null>>({})
  const trash=ref<TrashItem[]>([])
  const recoveries=ref<DiagramDocument[]>([]);for(const d of read<any[]>('-recoveries',[])){try{recoveries.value.push(validateDocument(d))}catch{ctx.storageError.value='部分待恢复存档格式无效，原始本地备份仍保留'}}
  const unsaved=new Set<string>(read('-unsaved',[])),newIds=new Set<string>(read('-new',[]))
  const deletions=read<Record<string,number>>('-deletions',{})
  let tail=Promise.resolve(),generation=0
  let initialLocalData:string|null=null;try{initialLocalData=localStorage.getItem(KEY)}catch{}
  function metadata(){try{localStorage.setItem(KEY+'-revisions',JSON.stringify(revisions.value));localStorage.setItem(KEY+'-new',JSON.stringify([...newIds]));localStorage.setItem(KEY+'-unsaved',JSON.stringify([...unsaved]));localStorage.setItem(KEY+'-deletions',JSON.stringify(deletions))}catch{ctx.storageError.value='本地备份空间不足，请导出备份并检查同步状态'}}
  function markDirty(id:string){generation++;unsaved.add(id);metadata()}
  function markNew(id:string){newIds.add(id);markDirty(id)}
  function clearDirty(id:string){unsaved.delete(id);newIds.delete(id);metadata()}
  function backup(){localStorage.setItem(KEY,JSON.stringify({documents:ctx.documents.value.map(projectDocument),activeId:ctx.activeId.value}));metadata()}
  function recover(d:DiagramDocument){if(!recoveries.value.some(x=>x.id===d.id&&signature(x)===signature(d))){recoveries.value.push(copy(d));localStorage.setItem(KEY+'-recoveries',JSON.stringify(recoveries.value.map(projectDocument)))}}
  async function api(path:string,method='GET',body?:unknown){const r=await fetch('/studio-api'+path,{method,cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined}),v=r.status===204?null:await r.json();if(!r.ok){const e=new Error(v?.error||'共享服务请求失败') as Error&{status:number};e.status=r.status;throw e}return v}
  function enqueue(fn:()=>Promise<void>){generation++;pending.value++;tail=tail.then(fn).catch(e=>{ctx.storageError.value=(e as Error).message}).finally(()=>pending.value--);return tail}
  function apply(snapshot:WorkspaceSnapshot){
    const records=snapshot.diagrams.filter(r=>!Object.hasOwn(deletions,r.document.id))
    workspaceGroups.value=snapshot.groups;trash.value=snapshot.trash||[];assignments.value=Object.fromEntries(records.map(r=>[r.document.id,r.workspaceGroupId||null]))
    ctx.documents.value=records.map(hydrate);revisions.value=Object.fromEntries(records.map(r=>[r.document.id,r.revision]))
    if(!records.some(r=>r.document.id===ctx.activeId.value))ctx.activeId.value=records[0]?.document.id||''
  }
  function save(d:DiagramDocument){const snapshot=copy(d);markDirty(d.id);enqueue(async()=>{
    if(Object.hasOwn(deletions,snapshot.id)||conflictId.value===snapshot.id)return
    try{const rev=revisions.value[snapshot.id];if(!rev&&!newIds.has(snapshot.id)){recover(snapshot);clearDirty(snapshot.id);throw new Error('未识别的本地存档已保留在待恢复内容中')}
      const r:RecordData=await api(rev?`/diagrams/${snapshot.id}`:'/diagrams',rev?'PUT':'POST',rev?{document:snapshot,expectedRevision:rev}:{document:snapshot})
      revisions.value[snapshot.id]=r.revision;assignments.value[snapshot.id]=r.workspaceGroupId||null
      const local=ctx.documents.value.find(d=>d.id===snapshot.id);if(local)local.createdAt=r.createdAt??r.document.createdAt
      // Keep a newer edit dirty while an older request is in flight.
      if(local&&signature(local)===signature(snapshot)){local.updatedAt=r.document.updatedAt;clearDirty(snapshot.id)}
      else {newIds.delete(snapshot.id);metadata()}
      ctx.storageError.value='';backup()
    }catch(e){if([404,410].includes((e as any).status)){recover(snapshot);ctx.documents.value=ctx.documents.value.filter(d=>d.id!==snapshot.id);if(ctx.activeId.value===snapshot.id)ctx.activeId.value=ctx.documents.value[0]?.id||'';clearDirty(snapshot.id);delete revisions.value[snapshot.id];ctx.reset();backup();throw new Error('该图形已在其他位置删除；本地修改已保留，可主动恢复为新图形')}
      if((e as any).status===409){conflictId.value=snapshot.id;throw new Error('图形已有新的修改；本地内容已保留，请载入最新或另存副本。')}throw e}
  })}
  async function flushDeletions(){for(const [id,queuedRevision] of Object.entries(deletions)){const revision=revisions.value[id]||queuedRevision;try{if(revision)await api(`/diagrams/${id}?revision=${revision}`,'DELETE');delete deletions[id];delete revisions.value[id];clearDirty(id)}catch(e){if([404,410].includes((e as any).status)){delete deletions[id];clearDirty(id)}else if((e as any).status===409){delete deletions[id];metadata();ctx.notify('删除未完成：图形已有新的修改，请确认最新内容后再次删除')}else throw e}}metadata()}
  async function initialize(){if(loading.value||shared.value)return;loading.value=true;try{
    await flushDeletions();let snapshot:WorkspaceSnapshot=await api('/workspace')
    let previous:any[]=[];try{previous=initialLocalData?JSON.parse(initialLocalData).documents||[]:ctx.documents.value}catch{}
    const originals=new Map<string,DiagramDocument>();for(const d of previous){try{const v=validateDocument(d);originals.set(v.id,v)}catch{}}
    for(const d of ctx.documents.value)if(generation>0&&unsaved.has(d.id))originals.set(d.id,copy(d));const original=[...originals.values()]
    for(const stored of original){const local=validateDocument(stored),remote=snapshot.diagrams.find(r=>r.document.id===local.id)
      if(remote&&signature(hydrate(remote))===signature(local)){clearDirty(local.id);continue}
      if(unsaved.has(local.id)&&!snapshot.deletedIds.includes(local.id)&&((remote&&revisions.value[local.id]===remote.revision)||(!remote&&newIds.has(local.id)))){
        try{await api(remote?`/diagrams/${local.id}`:'/diagrams',remote?'PUT':'POST',remote?{document:local,expectedRevision:remote.revision}:{document:local});clearDirty(local.id)}catch(e){if(![404,409,410].includes((e as any).status))throw e;recover(local);clearDirty(local.id)}
      }else if(unsaved.has(local.id)||(!localStorage.getItem(KEY+'-shared-migrated')&&initialLocalData)){recover(local);clearDirty(local.id)}
    }
    snapshot=await api('/workspace');apply(snapshot)
    const requested=new URLSearchParams(window.location.hash.split('?')[1]||window.location.search).get('diagram');if(requested&&ctx.documents.value.some(d=>d.id===requested))ctx.activeId.value=requested
    ctx.reset();shared.value=true;ctx.storageError.value='';localStorage.setItem(KEY+'-shared-migrated','1');initialLocalData=null;backup()
  }catch(e){ctx.storageError.value='共享服务未连接；当前保留本地备份。'+(e as Error).message}finally{loading.value=false}}
  async function retrySync(){if(!shared.value){await initialize();return}enqueue(flushDeletions);for(const id of unsaved){const d=ctx.documents.value.find(d=>d.id===id);if(d)save(d)}await tail;await refreshRemote()}
  async function refreshRemote(){if(!shared.value||pending.value||conflictId.value||unsaved.size||document.activeElement?.closest('input,textarea,select,[contenteditable]'))return;const started=generation;try{const snapshot:WorkspaceSnapshot=await api('/workspace');if(started!==generation||pending.value||unsaved.size)return
    const changed=snapshot.diagrams.some(r=>revisions.value[r.document.id]!==r.revision)||snapshot.diagrams.length!==ctx.documents.value.length
    workspaceGroups.value=snapshot.groups;trash.value=snapshot.trash||[];assignments.value=Object.fromEntries(snapshot.diagrams.map(r=>[r.document.id,r.workspaceGroupId||null]))
    if(!changed)return;const activeChanged=snapshot.diagrams.find(r=>r.document.id===ctx.activeId.value)?.revision!==revisions.value[ctx.activeId.value];apply(snapshot);if(activeChanged)ctx.reset();backup();ctx.storageError.value=''
  }catch(e){ctx.storageError.value='共享同步失败；本地内容仍保留。'+(e as Error).message}}
  async function resolveConflict(asCopy:boolean){await tail;const id=conflictId.value;if(!id)return;try{const local=copy(ctx.documents.value.find(d=>d.id===id)!);try{const latest:RecordData=await api(`/diagrams/${id}`);ctx.documents.value=ctx.documents.value.map(d=>d.id===id?hydrate(latest):d);revisions.value[id]=latest.revision}catch(e){if(![404,410].includes((e as any).status))throw e;ctx.documents.value=ctx.documents.value.filter(d=>d.id!==id)}clearDirty(id);conflictId.value='';ctx.storageError.value='';ctx.reset();if(asCopy){local.id=newId('diagram');local.createdAt=local.updatedAt=Date.now();local.title+=' · 本地副本';ctx.documents.value.push(local);ctx.activeId.value=local.id;markNew(local.id);save(local)}else if(!ctx.documents.value.some(d=>d.id===ctx.activeId.value))ctx.activeId.value=ctx.documents.value[0]?.id||'';backup()}catch(e){ctx.storageError.value=(e as Error).message}}
  function remove(id:string){generation++;if(conflictId.value===id)conflictId.value='';deletions[id]=revisions.value[id]||0;clearDirty(id);metadata();enqueue(async()=>{await flushDeletions();trash.value=await api('/trash')})}
  async function restoreDeleted(item:TrashItem){let restored=false;await enqueue(async()=>{const r:RecordData=await api(`/trash/${item.id}/restore`,'POST',{expectedRevision:item.revision,deletedAt:item.deletedAt});delete deletions[item.id];clearDirty(item.id);ctx.documents.value=[...ctx.documents.value.filter(d=>d.id!==item.id),hydrate(r)];revisions.value[item.id]=r.revision;assignments.value[item.id]=r.workspaceGroupId||null;trash.value=await api('/trash');ctx.activeId.value=item.id;ctx.reset();backup();ctx.storageError.value='';ctx.notify('图形已恢复');restored=true});return restored}
  async function purgeDeleted(item:TrashItem){await enqueue(async()=>{await api(`/trash/${item.id}?revision=${item.revision}&deletedAt=${item.deletedAt}`,'DELETE');trash.value=await api('/trash');ctx.storageError.value='';ctx.notify('已永久删除')})}
  async function restoreRecovery(index:number){const original=recoveries.value[index];if(!original)return;const d=copy(original);d.id=newId('diagram');d.title+=' · 恢复副本';d.createdAt=d.updatedAt=Date.now();ctx.documents.value.push(d);ctx.activeId.value=d.id;markNew(d.id);backup();if(shared.value){save(d);await tail;if(unsaved.has(d.id))return}recoveries.value.splice(index,1);localStorage.setItem(KEY+'-recoveries',JSON.stringify(recoveries.value.map(projectDocument)));ctx.reset()}
  async function ensureDocument(id:string){await tail;if(Object.hasOwn(deletions,id))return false;if(ctx.documents.value.some(d=>d.id===id))return true;try{const record:RecordData=await api('/diagrams/'+encodeURIComponent(id));if(!ctx.documents.value.some(d=>d.id===id)){ctx.documents.value.push(hydrate(record));revisions.value[id]=record.revision;assignments.value[id]=record.workspaceGroupId||null;backup()}return true}catch(e){ctx.notify((e as Error).message);return false}}
  async function groupAction(fn:()=>Promise<unknown>){await enqueue(async()=>{await fn();const snapshot:WorkspaceSnapshot=await api('/workspace');workspaceGroups.value=snapshot.groups;assignments.value=Object.fromEntries(snapshot.diagrams.map(r=>[r.document.id,r.workspaceGroupId||null]));ctx.storageError.value=''})}
  function createWorkspaceGroup(name:string){return groupAction(()=>api('/groups','POST',{name}))}
  function renameWorkspaceGroup(id:string,name:string){const group=workspaceGroups.value.find(g=>g.id===id);return groupAction(()=>api('/groups/'+id,'PUT',{name,expectedRevision:group?.revision}))}
  function deleteWorkspaceGroup(id:string){const group=workspaceGroups.value.find(g=>g.id===id);return groupAction(()=>api(`/groups/${id}?revision=${group?.revision}`,'DELETE'))}
  async function moveToWorkspaceGroup(id:string,workspaceGroupId:string|null){await tail;return groupAction(()=>api(`/diagrams/${id}/group`,'PUT',{workspaceGroupId,expectedWorkspaceGroupId:assignments.value[id]||null}))}
  return {shared,loading,pending,conflictId,revisions,workspaceGroups,assignments,trash,recoveries,initialize,refreshRemote,ensureDocument,resolveConflict,retrySync,markDirty,markNew,save,remove,restoreRecovery,restoreDeleted,purgeDeleted,createWorkspaceGroup,renameWorkspaceGroup,deleteWorkspaceGroup,moveToWorkspaceGroup}
}
