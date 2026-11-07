<script setup lang="ts">
import {computed,ref,shallowRef} from 'vue'
import type {NativeClient} from '../services/native-client'
import {NativeApiError,nativeRecordIdentity} from '../services/native-types'
import {identifyImportCandidates,selectImportFiles,scanImportEntries,MAX_IMPORT_BATCH_SOURCES,type ImportCandidate,type ImportDirectoryEntry,type ImportSelection} from '../services/import-files'
import type {ImportBatchItem,ImportBatchPreview,ImportBatchTarget} from '../services/import-batch'
import Icon from './Icon.vue'
const props=defineProps<{client:NativeClient;groups:Array<{id:string;name:string}>}>()
const emit=defineEmits<{changed:[];open:[id:string];pending:[value:boolean]}>()
type Row=ImportCandidate&{selected:boolean;preview?:ImportBatchPreview;result?:'imported'|'duplicate';error?:string;requestId:string;recordId?:string;unknown?:boolean}
const visible=ref(false),working=ref(false),target=ref(''),newName=ref(''),rows=shallowRef<Row[]>([]),message=ref(''),files=ref<HTMLInputElement>(),directory=ref<HTMLInputElement>(),dragging=ref(false)
let batchId=crypto.randomUUID(),generation=0,frozenTarget:ImportBatchTarget|undefined,dragDepth=0
const frozen=ref(false)
const selected=computed(()=>rows.value.filter(r=>r.selected&&!r.result&&r.format&&r.data))
const successful=computed(()=>rows.value.filter(r=>r.result==='imported').length)
const readyCount=computed(()=>rows.value.filter(r=>r.status==='ready').length)
const targetValue=():ImportBatchTarget=>target.value==='new'?{newGroupName:newName.value.trim()}:{groupId:target.value||null}
function input(row:Row):ImportBatchItem{return {batchId,itemId:row.itemId,requestId:row.requestId,source:{format:row.format!,data:row.data!,...(row.format==='drawio'?{title:row.name.replace(/\.(drawio|xml)$/i,'').slice(0,160)}:{})},target:frozenTarget??targetValue()}}
function update(){rows.value=[...rows.value];emit('pending',rows.value.some(r=>r.unknown)||working.value)}
function show(group:string|null=null){if(!visible.value&&!rows.value.some(r=>r.unknown)){rows.value=[];message.value='';frozen.value=false;frozenTarget=undefined;batchId=crypto.randomUUID();target.value=group??''}visible.value=true}
function close(){if(working.value)return;visible.value=false;dragDepth=0;dragging.value=false}
async function load(selection:ImportSelection[]){
 if(working.value||frozen.value)return
 const token=++generation;working.value=true;message.value='';emit('pending',true)
 try{const candidates=await identifyImportCandidates(selection);if(token!==generation)return;rows.value=candidates.map(r=>({...r,selected:r.status==='ready',requestId:crypto.randomUUID()}));await previews(token)}catch(e){message.value=e instanceof Error?e.message:String(e)}finally{if(token===generation){working.value=false;update()}}
}
async function chosen(event:Event){const el=event.target as HTMLInputElement;try{const value=selectImportFiles(el.files??[]);el.value='';await load(value)}catch(e){el.value='';message.value=e instanceof Error?e.message:String(e)}}
function dragFiles(event:DragEvent){return Array.from(event.dataTransfer?.types??[]).includes('Files')}
function dragenter(event:DragEvent){if(!dragFiles(event)||working.value||frozen.value)return;dragDepth++;dragging.value=true}
function dragover(event:DragEvent){if(dragFiles(event))event.dataTransfer!.dropEffect='copy'}
function dragleave(){if(dragDepth>0)dragDepth--;if(!dragDepth)dragging.value=false}
async function dropped(event:DragEvent,group:string|null){
 dragDepth=0;dragging.value=false
 if(working.value||rows.value.some(r=>r.unknown))return
 // Capture entry handles synchronously while DataTransfer is still readable.
 const entries=Array.from(event.dataTransfer?.items??[]).filter(i=>i.kind==='file').map(i=>i.webkitGetAsEntry()).filter(Boolean) as unknown as ImportDirectoryEntry[]
 const fallback=Array.from(event.dataTransfer?.files??[]);show(group)
 try{await load(entries.length?await scanImportEntries(entries):selectImportFiles(fallback))}catch(e){message.value=e instanceof Error?e.message:String(e)}
}
async function previews(token=++generation){
 // A new group without a name is not a valid target yet; wait instead of failing every row.
 if(!frozenTarget&&target.value==='new'&&!newName.value.trim())return
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
function formatLabel(row:Row){if(row.format==='project')return 'project';if(row.format==='content')return 'json';if(row.format==='drawio')return 'drawio';return /\.(png|svg)$/i.test(row.path)?'图片':'文件'}
function chip(row:Row):{text:string;tone:string}{
 if(row.result==='imported')return {text:'已导入',tone:'ok'}
 if(row.result==='duplicate')return {text:'已存在，未重复导入',tone:'muted'}
 if(row.unknown)return {text:'结果待确认，可重试',tone:'warn'}
 if(row.error)return {text:'失败',tone:'error'}
 if(row.status==='duplicate')return {text:'重复来源',tone:'muted'}
 if(row.status==='conflict')return {text:'需选择',tone:'warn'}
 if(row.status==='unsupported')return {text:'不支持',tone:'muted'}
 if(!row.preview)return {text:working.value?'预检中…':target.value==='new'&&!newName.value.trim()?'待填写分组名':'待预检',tone:'muted'}
 if(row.preview.duplicate)return {text:'已存在',tone:'muted'}
 return {text:'可导入',tone:'ok'}
}
function resultText(row:Row){if(row.result==='imported')return '';if(row.result==='duplicate')return '';if(row.unknown)return '结果待确认，可重试';if(row.error)return row.error;if(row.status==='duplicate')return row.reason??'重复来源';if(row.status==='unsupported'||row.status==='conflict')return row.reason;return row.preview?.duplicate?'':row.preview?(row.preview.quality?.issues.length?'可导入 · '+row.preview.quality.issues.length+' 项内容建议':''):''}
defineExpose({show,dropped})
</script>
<template>
<div v-if="visible" class="studio-overlay" @click.self="close"><section class="studio-dialog import-dialog" role="dialog" aria-modal="true" aria-label="导入图形">
 <header class="import-header">
  <div><h2>导入图形</h2><p class="import-subtitle">支持 project.json、content.json、drawio；同一导出集自动合并，只恢复一份图形</p></div>
  <button class="studio-icon" aria-label="关闭导入" :disabled="working" @click="close"><Icon name="close" :size="16"/></button>
 </header>
 <div class="import-toolbar">
  <span class="import-toolbar-label">导入到</span>
  <select v-model="target" aria-label="导入目标" :disabled="working||frozen" @change="changeTarget"><option value="">未分组</option><option v-for="group in groups" :key="group.id" :value="group.id">{{group.name}}</option><option value="new">新建分组…</option></select>
  <input v-if="target==='new'" v-model="newName" aria-label="导入新分组名称" placeholder="分组名称" maxlength="80" :disabled="working||frozen" @change="changeTarget">
 </div>
 <div class="import-dropzone" :class="{dragging,filled:rows.length>0,disabled:working||frozen}" role="button" tabindex="0" aria-label="拖拽或选择要导入的文件" @click="!working&&!frozen&&files?.click()" @keydown.enter.prevent="!working&&!frozen&&files?.click()" @keydown.space.prevent="!working&&!frozen&&files?.click()" @dragenter.prevent="dragenter" @dragover.prevent="dragover" @dragleave="dragleave" @drop.prevent="dropped($event,target||null)">
  <Icon name="import" :size="rows.length?18:26"/>
  <template v-if="!rows.length"><p class="import-drop-main">拖拽文件或文件夹到此处</p><div class="import-drop-actions"><button class="studio-secondary" type="button" :disabled="working||frozen" @click.stop="files?.click()">选择文件</button><button class="studio-secondary" type="button" :disabled="working||frozen" @click.stop="directory?.click()">选择文件夹</button></div><p class="import-drop-hint">一次最多 {{MAX_IMPORT_BATCH_SOURCES}} 份不同图形 · 单文件不超过 2.5MB</p></template>
  <template v-else><p class="import-drop-compact">继续拖拽文件替换当前选择，或 <button type="button" class="import-link" :disabled="working||frozen" @click.stop="files?.click()">选择文件</button> / <button type="button" class="import-link" :disabled="working||frozen" @click.stop="directory?.click()">选择文件夹</button></p></template>
 </div>
 <input ref="files" type="file" multiple accept=".json,.drawio,.xml,.svg,.png" hidden @change="chosen"><input ref="directory" type="file" webkitdirectory multiple hidden @change="chosen">
 <ul v-if="rows.length" class="import-list" aria-label="导入文件列表">
  <li v-for="row in rows" :key="row.itemId" class="import-row" :class="{disabled:!row.selected}">
   <label class="import-row-check"><input type="checkbox" :aria-label="'导入 '+row.path" :checked="row.selected" :disabled="working||frozen||row.status==='unsupported'||row.status==='duplicate'" @change="choose(row,$event)"></label>
   <span class="import-format" :data-kind="formatLabel(row)">{{formatLabel(row)}}</span>
   <div class="import-row-main"><button v-if="row.recordId" class="import-row-name link" @click="emit('open',row.recordId);close()">{{row.path}}</button><strong v-else class="import-row-name">{{row.path}}</strong><small v-if="resultText(row)" :class="{error:row.error||row.status==='conflict'}">{{resultText(row)}}</small></div>
   <span class="import-chip" :data-tone="chip(row).tone">{{chip(row).text}}</span>
  </li>
 </ul>
 <div v-if="message" class="import-alert" role="alert"><Icon name="bolt" :size="14"/><span>{{message}}</span></div>
 <footer class="studio-dialog-actions import-footer">
  <span class="import-summary" role="status">{{working?'处理中…':successful?'已导入 '+successful+' 张，共 '+rows.length+' 项':rows.length?'共 '+rows.length+' 项 · 已选择 '+selected.length+' 份 · 可导入 '+readyCount+' 份':''}}</span>
  <button class="studio-primary" :disabled="working||!selected.length||selected.every(r=>!!r.error&&!r.unknown)||target==='new'&&!newName.trim()" @click="submit">{{frozen?(selected.length?'重试未完成项':'导入完成'):selected.length?'导入 '+selected.length+' 份':'导入'}}</button>
  <button class="studio-secondary" :disabled="working" @click="close">关闭</button>
 </footer>
</section></div>
</template>
<style scoped>
.import-dialog{width:680px;max-width:94vw}
.import-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px}
.import-header h2{font-size:18px;letter-spacing:-.3px;font-weight:600}
.import-subtitle{margin-top:4px;font-size:12px;color:var(--fm-muted,#7e8696)}
.import-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.import-toolbar-label{font-size:12px;color:var(--fm-muted,#7e8696);white-space:nowrap}
.import-toolbar select,.import-toolbar input{border:1px solid var(--fm-border,#dde1eb);border-radius:8px;padding:7px 10px;font-size:12px;background:var(--fm-surface,#fff);color:inherit;max-width:220px}
.import-dropzone{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:132px;padding:18px;border:1.5px dashed var(--fm-border,#d4d9e6);border-radius:12px;background:var(--fm-surface-soft,#fafbfd);color:var(--fm-muted,#98a1b3);cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.import-dropzone:hover{border-color:#b6aef0;color:var(--fm-accent,#8172ef)}
.import-dropzone.filled{min-height:0;padding:10px;cursor:default}
.import-dropzone.disabled{opacity:.6;cursor:default}
.import-dropzone.dragging{border-color:var(--fm-accent,#8172ef);background:#f1eefe;color:var(--fm-accent,#8172ef)}
.import-drop-main{font-size:13px;font-weight:550;color:#6b7488}
.import-dropzone.dragging .import-drop-main{color:var(--fm-accent,#8172ef)}
.import-drop-actions{display:flex;gap:8px}
.import-drop-hint{font-size:11px}
.import-drop-compact{font-size:12px;color:var(--fm-muted,#7e8696)}
.import-link{color:var(--fm-accent,#8172ef);font-size:12px;padding:0 2px}
.import-link:hover{text-decoration:underline}
.import-list{list-style:none;margin:10px 0 0;padding:0;max-height:44vh;overflow:auto;border-top:1px solid var(--fm-border,#e5e7ef)}
.import-row{display:flex;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid var(--fm-border,#e5e7ef)}
.import-row.disabled .import-row-name,.import-row.disabled .import-format{opacity:.55}
.import-row-check input{width:14px;height:14px;margin:0;accent-color:var(--fm-accent,#8172ef)}
.import-format{flex:none;min-width:44px;padding:2px 7px;border-radius:6px;background:#eef0f6;color:#68748c;font-size:10px;font-weight:600;text-align:center;letter-spacing:.2px}
.import-format[data-kind="project"]{background:#e9e5fb;color:#5c55c9}
.import-format[data-kind="drawio"]{background:#e2f0e9;color:#3b7a5b}
.import-row-main{min-width:0;flex:1}
.import-row-name{display:block;font-size:13px;font-weight:500;overflow-wrap:anywhere;text-align:left}
.import-row-name.link{color:var(--fm-accent,#8172ef);padding:0}
.import-row-main small{display:block;margin-top:3px;font-size:11px;color:var(--fm-muted,#7e8696);overflow-wrap:anywhere}
.import-row-main small.error{color:#c05c5c}
.import-chip{flex:none;font-size:11px;font-weight:550;padding:3px 9px;border-radius:20px;white-space:nowrap}
.import-chip[data-tone="ok"]{background:#e4f3ea;color:#2e7d4f}
.import-chip[data-tone="muted"]{background:#eef0f4;color:#8891a3}
.import-chip[data-tone="warn"]{background:#fbf0dd;color:#a86a13}
.import-chip[data-tone="error"]{background:#fbe7e7;color:#b54444}
.import-alert{display:flex;align-items:flex-start;gap:8px;margin-top:12px;padding:10px 12px;border:1px solid #f0caca;border-radius:10px;background:#fdf0f0;color:#a84444;font-size:12px;line-height:1.5}
.import-alert svg{flex:none;margin-top:1px}
.import-footer{display:flex;align-items:center;gap:10px;margin-top:16px}
.import-summary{margin-right:auto;font-size:12px;color:var(--fm-muted,#7e8696)}
</style>
