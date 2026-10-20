<script setup lang="ts">
import {computed,ref,shallowRef} from 'vue'
import type {NativeClient} from '../services/native-client'
import {NativeApiError,nativeRecordIdentity} from '../services/native-types'
import {identifyImportCandidates,selectImportFiles,scanImportEntries,type ImportCandidate,type ImportDirectoryEntry,type ImportSelection} from '../services/import-files'
import type {ImportBatchItem,ImportBatchPreview,ImportBatchTarget} from '../services/import-batch'
import Icon from './Icon.vue'
const props=defineProps<{client:NativeClient;groups:Array<{id:string;name:string}>}>()
const emit=defineEmits<{changed:[];open:[id:string];pending:[value:boolean]}>()
type Row=ImportCandidate&{selected:boolean;preview?:ImportBatchPreview;result?:'imported'|'duplicate';error?:string;requestId:string;recordId?:string;unknown?:boolean}
const visible=ref(false),working=ref(false),target=ref(''),newName=ref(''),rows=shallowRef<Row[]>([]),message=ref(''),files=ref<HTMLInputElement>(),directory=ref<HTMLInputElement>()
let batchId=crypto.randomUUID(),generation=0,frozenTarget:ImportBatchTarget|undefined
const frozen=ref(false)
const selected=computed(()=>rows.value.filter(r=>r.selected&&!r.result&&r.format&&r.data))
const successful=computed(()=>rows.value.filter(r=>r.result==='imported').length)
const targetValue=():ImportBatchTarget=>target.value==='new'?{newGroupName:newName.value.trim()}:{groupId:target.value||null}
function input(row:Row):ImportBatchItem{return {batchId,itemId:row.itemId,requestId:row.requestId,source:{format:row.format!,data:row.data!,...(row.format==='drawio'?{title:row.name.replace(/\.(drawio|xml)$/i,'').slice(0,160)}:{})},target:frozenTarget??targetValue()}}
function update(){rows.value=[...rows.value];emit('pending',rows.value.some(r=>r.unknown)||working.value)}
function show(group:string|null=null){if(!visible.value&&!rows.value.some(r=>r.unknown)){rows.value=[];message.value='';frozen.value=false;frozenTarget=undefined;batchId=crypto.randomUUID();target.value=group??''}visible.value=true}
function close(){if(working.value)return;visible.value=false}
async function load(selection:ImportSelection[]){
 if(working.value||frozen.value)return
 const token=++generation;working.value=true;message.value='';emit('pending',true)
 try{const candidates=await identifyImportCandidates(selection);if(token!==generation)return;rows.value=candidates.map(r=>({...r,selected:r.status==='ready',requestId:crypto.randomUUID()}));await previews(token)}catch(e){message.value=e instanceof Error?e.message:String(e)}finally{if(token===generation){working.value=false;update()}}
}
async function chosen(event:Event){const input=event.target as HTMLInputElement;try{const value=selectImportFiles(input.files??[]);input.value='';await load(value)}catch(e){input.value='';message.value=e instanceof Error?e.message:String(e)}}
async function dropped(event:DragEvent,group:string|null){
 if(working.value||rows.value.some(r=>r.unknown))return
 // Capture entry handles synchronously while DataTransfer is still readable.
 const entries=Array.from(event.dataTransfer?.items??[]).filter(i=>i.kind==='file').map(i=>i.webkitGetAsEntry()).filter(Boolean) as unknown as ImportDirectoryEntry[]
 const fallback=Array.from(event.dataTransfer?.files??[]);show(group)
 try{await load(entries.length?await scanImportEntries(entries):selectImportFiles(fallback))}catch(e){message.value=e instanceof Error?e.message:String(e)}
}
async function previews(token=++generation){
 for(const row of rows.value){
  if(token!==generation)return
  if(!row.selected||row.result||!row.format||!row.data)continue
  row.error=undefined
  try{row.preview=await props.client.previewImportItem(input(row));if(!row.preview.supported&&!row.preview.duplicate)row.error='此文件类型尚未启用'}catch(e){row.error=e instanceof Error?e.message:String(e)}
  update()
 }
 // Only actual server fingerprints may associate XML with JSON. Filename is not identity.
 const ordered=[...rows.value].filter(r=>r.selected&&r.preview?.sourceFingerprint).sort((a,b)=>rank(a)-rank(b))
 const preferred=new Map<string,Row>()
 for(const row of ordered){const f=row.preview!.sourceFingerprint!;if(!f.sourceKey||!f.contentHash)continue;const prior=preferred.get(f.sourceKey)
  if(!prior){preferred.set(f.sourceKey,row);continue}
  const p=prior.preview!.sourceFingerprint!
  if(f.contentHash===p.contentHash&&(!f.complete||!p.complete||f.renderHash===p.renderHash)){row.selected=false;row.status='duplicate';row.preferredItemId=prior.itemId;row.reason='与规范源一致，仅导入一份';row.error=undefined}
  else {row.status='conflict';prior.status='conflict';row.selected=false;prior.selected=false;row.reason=prior.reason='同源图形内容或人工排版不同，请选择一份';row.error=prior.error=undefined}
 }
 update()
}
function rank(row:Row){return row.format==='project'?0:row.format==='drawio'?1:2}
async function changeTarget(){if(frozen.value)return;batchId=crypto.randomUUID();for(const row of rows.value){row.requestId=crypto.randomUUID();row.preview=undefined;row.error=undefined}working.value=true;try{await previews()}finally{working.value=false;update()}}
async function choose(row:Row,event:Event){if(frozen.value)return;row.selected=(event.target as HTMLInputElement).checked;if(row.selected&&row.sourceId)for(const other of rows.value)if(other!==row&&other.sourceId===row.sourceId)other.selected=false;working.value=true;try{await previews()}finally{working.value=false;update()}}
async function submit(){
 if(working.value||!selected.value.length||target.value==='new'&&!newName.value.trim())return
 working.value=true;emit('pending',true);message.value=''
 if(!frozenTarget)frozenTarget=structuredClone(targetValue());frozen.value=true
 try{
  for(const row of [...selected.value].sort((a,b)=>rank(a)-rank(b))){
   if(row.error&&!row.unknown)continue
   row.error=undefined;row.unknown=true;update()
   try{const result=await props.client.commitImportItem(input(row));row.result=result.status;row.recordId=nativeRecordIdentity(result.record).id;row.unknown=false;emit('changed')}
   catch(e){row.error=e instanceof Error?e.message:String(e);row.unknown=!(e instanceof NativeApiError)||e.uncertain}
   update()
  }
 }finally{working.value=false;update()}
}
function resultText(row:Row){if(row.result==='imported')return '已导入';if(row.result==='duplicate')return '已存在，未重复导入';if(row.unknown)return '结果待确认，可重试';if(row.error)return row.error;if(row.status==='duplicate')return row.reason??'重复来源';if(row.status==='unsupported'||row.status==='conflict')return row.reason;return row.preview?.duplicate?'已存在':row.preview?'可导入':'待预检'}
defineExpose({show,dropped})
</script>
<template>
<div v-if="visible" class="studio-overlay" @click.self="close"><section class="studio-dialog import-batch-dialog" role="dialog" aria-modal="true" aria-label="导入图形">
 <div class="studio-dialog-heading"><h2>导入图形</h2><button class="studio-icon" aria-label="关闭导入" :disabled="working" @click="close"><Icon name="close" :size="16"/></button></div>
 <div class="import-batch-tools"><button class="studio-secondary" :disabled="working||frozen" @click="files?.click()">选择文件</button><button class="studio-secondary" :disabled="working||frozen" @click="directory?.click()">选择文件夹</button><select v-model="target" aria-label="导入目标" :disabled="working||frozen" @change="changeTarget"><option value="">未分组</option><option v-for="group in groups" :key="group.id" :value="group.id">{{group.name}}</option><option value="new">新建分组…</option></select><input v-if="target==='new'" v-model="newName" aria-label="导入新分组名称" placeholder="分组名称" maxlength="80" :disabled="working||frozen" @change="changeTarget"></div>
 <input ref="files" type="file" multiple accept=".json,.drawio,.xml,.svg,.png" hidden @change="chosen"><input ref="directory" type="file" webkitdirectory multiple hidden @change="chosen">
 <div class="import-batch-list" @dragover.prevent @drop.prevent="dropped($event,target||null)"><p v-if="!rows.length" class="workspace-empty">选择或拖入文件、文件夹</p><div v-for="row in rows" :key="row.itemId" class="import-batch-row"><input type="checkbox" :aria-label="'导入 '+row.path" :checked="row.selected" :disabled="working||frozen||row.status==='unsupported'||row.status==='duplicate'" @change="choose(row,$event)"><div><button v-if="row.recordId" class="import-batch-name" @click="emit('open',row.recordId);close()">{{row.path}}</button><strong v-else>{{row.path}}</strong><small :class="{error:row.error||row.status==='conflict'}">{{resultText(row)}}</small></div></div></div>
 <p v-if="message" role="alert">{{message}}</p><div class="studio-dialog-actions"><span role="status">{{working?'处理中…':successful?'已导入 '+successful+' 张':selected.length?'已选择 '+selected.length+' 份':''}}</span><button class="studio-primary" :disabled="working||!selected.length||selected.every(r=>!!r.error&&!r.unknown)||target==='new'&&!newName.trim()" @click="submit">{{frozen?'重试未完成项':'导入'}}</button><button class="studio-secondary" :disabled="working" @click="close">关闭</button></div>
</section></div>
</template>
<style scoped>
.import-batch-dialog{width:660px;max-width:92vw}.import-batch-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:16px 0}.import-batch-tools select,.import-batch-tools input{max-width:190px;border:1px solid var(--fm-border,#dde1eb);border-radius:7px;padding:7px;background:var(--fm-surface,#fff);color:inherit}.import-batch-list{min-height:100px;max-height:50vh;overflow:auto}.import-batch-row{display:flex;gap:10px;align-items:flex-start;padding:11px 3px;border-bottom:1px solid var(--fm-border,#e5e7ef)}.import-batch-row>input{margin-top:3px}.import-batch-row>div{min-width:0;flex:1}.import-batch-row strong,.import-batch-name{font-size:13px;font-weight:500;overflow-wrap:anywhere}.import-batch-name{color:var(--fm-accent,#8172ef);text-align:left;padding:0}.import-batch-row small{display:block;margin-top:5px;font-size:12px;color:var(--fm-muted,#7e8696);overflow-wrap:anywhere}.import-batch-row small.error{color:#c36c6c}.studio-dialog-actions{display:flex;align-items:center;gap:8px;margin-top:16px}.studio-dialog-actions>span{margin-right:auto;font-size:12px;color:var(--fm-muted,#7e8696)}
</style>
