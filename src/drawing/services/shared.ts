import { ref, type Ref, type ComputedRef } from 'vue'
import { copy, newId, validateDocument, type DiagramDocument } from '../core/model'
type RecordData={document:DiagramDocument;revision:number;savedAt:number}
const KEY='flymind-drawing-studio-v1'
export function sharedWorkspace(ctx:{documents:Ref<DiagramDocument[]>;activeId:Ref<string>;current:ComputedRef<DiagramDocument>;storageError:Ref<string>;notify:(s:string)=>void;reset:()=>void}){
  const shared=ref(false),loading=ref(false),pending=ref(0),conflictId=ref(''),revisions=ref<Record<string,number>>({});let tail=Promise.resolve()
  const unsaved=new Set<string>();try{for(const id of JSON.parse(localStorage.getItem(KEY+'-unsaved')||'[]'))unsaved.add(id)}catch{}
  function markDirty(id:string){unsaved.add(id);saveDirty()}
  function clearDirty(id:string){unsaved.delete(id);saveDirty()}
  function saveDirty(){try{localStorage.setItem(KEY+'-unsaved',JSON.stringify([...unsaved]))}catch{}}
  function backup(){localStorage.setItem(KEY,JSON.stringify({documents:ctx.documents.value,activeId:ctx.activeId.value}))}
  async function api(path:string,method='GET',body?:unknown){const r=await fetch('/studio-api'+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined}),v=r.status===204?null:await r.json();if(!r.ok){const e=new Error(v?.error||'共享服务请求失败') as Error&{status:number};e.status=r.status;throw e}return v}
  function enqueue(fn:()=>Promise<void>){pending.value++;tail=tail.then(fn).catch(e=>{ctx.storageError.value=(e as Error).message}).finally(()=>pending.value--);return tail}
  function save(d:DiagramDocument){const snapshot=copy(d);markDirty(d.id);enqueue(async()=>{if(conflictId.value===snapshot.id)return;try{const rev=revisions.value[snapshot.id],r:RecordData=await api(rev?`/diagrams/${snapshot.id}`:'/diagrams',rev?'PUT':'POST',rev?{document:snapshot,expectedRevision:rev}:{document:snapshot});revisions.value[snapshot.id]=r.revision;clearDirty(snapshot.id);ctx.storageError.value=''}catch(e){if((e as any).status===409){conflictId.value=snapshot.id;throw new Error('图形已有新的修改；本地内容已保留，请载入最新或另存副本。')}throw e}})}
  async function retrySync(){if(!shared.value){await initialize();return}for(const id of unsaved){const d=ctx.documents.value.find(d=>d.id===id);if(d)save(d)}await tail}
  const signature=(d:DiagramDocument)=>JSON.stringify({...d,updatedAt:0})
  async function initialize(){if(loading.value||shared.value)return;loading.value=true;try{
    let records:RecordData[]=await api('/diagrams');const original=localStorage.getItem(KEY)
    if(original&&(!localStorage.getItem(KEY+'-shared-migrated')||unsaved.size)){
      const migrated=!!localStorage.getItem(KEY+'-shared-migrated')
      for(const local of (JSON.parse(original).documents||[]) as DiagramDocument[]){if(migrated&&!unsaved.has(local.id))continue;const remote=records.find(r=>r.document.id===local.id);if(remote&&signature(remote.document)===signature(local)){clearDirty(local.id);continue}const d=copy(local);if(remote){d.id=newId('diagram');d.title+=' · 本地存档';if(ctx.activeId.value===local.id)ctx.activeId.value=d.id}records.push(await api('/diagrams','POST',{document:d}));clearDirty(local.id)}
      localStorage.setItem(KEY+'-shared-migrated','1')
    }
    records=await api('/diagrams');if(!records.length)throw new Error('共享工作区没有图形，请通过 MCP 创建或导入')
    ctx.documents.value=records.map(r=>validateDocument(r.document));revisions.value=Object.fromEntries(records.map(r=>[r.document.id,r.revision]));const requested=new URLSearchParams(window.location.hash.split('?')[1]||window.location.search).get('diagram');if(requested&&ctx.documents.value.some(d=>d.id===requested))ctx.activeId.value=requested;if(!ctx.documents.value.some(d=>d.id===ctx.activeId.value))ctx.activeId.value=ctx.documents.value[0].id
    ctx.reset();shared.value=true;ctx.storageError.value='';backup()
  }catch(e){ctx.storageError.value='共享服务未连接；当前保留本地备份。'+(e as Error).message}finally{loading.value=false}}
  async function refreshRemote(){if(!shared.value||pending.value||conflictId.value||unsaved.size||document.activeElement?.closest('input,textarea,select,[contenteditable]'))return;try{const records:RecordData[]=await api('/diagrams');const changed=records.some(r=>revisions.value[r.document.id]!==r.revision)||records.length!==ctx.documents.value.length;if(!changed)return;if(!records.length)return;const activeChanged=records.find(r=>r.document.id===ctx.activeId.value)?.revision!==revisions.value[ctx.activeId.value];if(activeChanged)ctx.notify('当前图形已同步最新修改');ctx.documents.value=records.map(r=>validateDocument(r.document));revisions.value=Object.fromEntries(records.map(r=>[r.document.id,r.revision]));if(!ctx.documents.value.some(d=>d.id===ctx.activeId.value))ctx.activeId.value=ctx.documents.value[0].id;if(activeChanged)ctx.reset();backup();ctx.storageError.value=''}catch(e){ctx.storageError.value='共享同步失败；本地内容仍保留。'+(e as Error).message}}
  async function resolveConflict(asCopy:boolean){await tail;const id=conflictId.value;if(!id)return;try{const local=copy(ctx.documents.value.find(d=>d.id===id)!),latest:RecordData=await api(`/diagrams/${id}`);ctx.documents.value=ctx.documents.value.map(d=>d.id===id?latest.document:d);revisions.value[id]=latest.revision;clearDirty(id);conflictId.value='';ctx.storageError.value='';ctx.reset();if(asCopy){local.id=newId('diagram');local.title+=' · 本地副本';ctx.documents.value.push(local);ctx.activeId.value=local.id;save(local)}backup()}catch(e){ctx.storageError.value=(e as Error).message}}
  function remove(id:string){enqueue(async()=>{try{if(revisions.value[id])await api(`/diagrams/${id}?revision=${revisions.value[id]}`,'DELETE');delete revisions.value[id];clearDirty(id)}catch(e){const latest:RecordData=await api(`/diagrams/${id}`);if(!ctx.documents.value.some(d=>d.id===id))ctx.documents.value.push(latest.document);backup();throw e}})}
  return {shared,loading,pending,conflictId,revisions,initialize,refreshRemote,resolveConflict,retrySync,markDirty,save,remove}
}
