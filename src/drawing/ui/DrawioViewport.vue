<script setup lang="ts">
import {shallowRef,watch,onBeforeUnmount,nextTick,computed} from 'vue'
import DrawioHost from './DrawioHost.vue'
import type {DrawioAppearance} from '../engine/drawio-host/appearance'
import {DrawioHostProtocolError,HOST_PREPARATION_TIMEOUT_MS,type HostReady,type HostXML,type HostError,type HostSaveRequested} from '../engine/drawio-host/controller'

interface DocumentInput {sessionKey:string;initialXML:string;title?:string}
interface Slot extends DocumentInput {engineKey:string;ready:boolean;warm?:boolean;failed?:boolean}
type Host=InstanceType<typeof DrawioHost>
const props=defineProps<DocumentInput&{warmupKey?:string;loading?:boolean;layoutLoading?:boolean;layoutLoadingLabel?:string;appearance?:DrawioAppearance;collaboration?:boolean}>()
const emit=defineEmits<{ready:[event:HostReady];xml:[event:HostXML];error:[event:HostError];saveRequested:[event:HostSaveRequested];historyRequested:[action:'undo'|'redo']}>()
const slots=shallowRef<Slot[]>(props.sessionKey?[{sessionKey:props.sessionKey,initialXML:props.initialXML,title:props.title,engineKey:props.sessionKey,ready:false}]:[])
const displayedKey=shallowRef(props.sessionKey)
const hosts=new Map<string,Host>()
const preparing=shallowRef(false)
const covering=computed(()=>{const active=slots.value.find(slot=>slot.sessionKey===displayedKey.value);return !!props.loading||preparing.value||!!active&&!active.ready&&!active.failed})
let disposed=false
let waitingForEngine:{engineKey:string;input:DocumentInput}|undefined
let pending:{key:string;resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined
function error(code:string,message:string){return new DrawioHostProtocolError(code,message)}
function activeHost(){const slot=slots.value.find(slot=>slot.sessionKey===displayedKey.value),host=slot&&hosts.get(slot.engineKey);if(!host)throw error('NOT_READY','当前画布尚未就绪');return host}
function isActive(key:string){return key===displayedKey.value&&key===props.sessionKey}
function discardPrepared(){
  waitingForEngine=undefined
  if(pending){clearTimeout(pending.timer);pending.reject(error('PREPARATION_CANCELLED','已取消候选画布'));pending=undefined}
  preparing.value=false
  slots.value=slots.value.filter(slot=>slot.sessionKey===displayedKey.value||(slot.ready||slot.warm)&&!slot.failed)
}
let warmTimer:ReturnType<typeof setTimeout>|undefined
function warmSpare(){
  clearTimeout(warmTimer)
  warmTimer=setTimeout(()=>{
    const active=slots.value.find(slot=>slot.sessionKey===displayedKey.value)
    if(disposed||preparing.value||slots.value.length!==1||!active?.ready||!active.initialXML.includes('fmDocumentId=')||/math\s*=\s*["']1["']/.test(active.initialXML))return
    const key=active.sessionKey+'-standby'
    slots.value=[active,{...active,sessionKey:key,engineKey:key,ready:false}]
  },200)
}
function activate(key:string){
  const target=slots.value.find(slot=>slot.sessionKey===key&&slot.ready)
  if(!target)return false
  // Atomically reveal the prepared document; retain the old engine as one inert spare.
  displayedKey.value=key;preparing.value=false
  void nextTick(()=>{if(!disposed&&isActive(key)){emit('ready',{sessionKey:key});warmSpare()}})
  return true
}
function prepare(input:DocumentInput):Promise<void>{
  if(disposed)return Promise.reject(error('SESSION_CLOSED','画布已关闭'))
  if(!input.sessionKey||!input.initialXML)return Promise.reject(error('INVALID_INITIAL_DOCUMENT','候选画布信息无效'))
  if(input.sessionKey===displayedKey.value)return slots.value.find(slot=>slot.sessionKey===displayedKey.value)?.ready?Promise.resolve():Promise.reject(error('NOT_READY','当前画布仍在加载'))
  const existing=slots.value.find(slot=>slot.sessionKey===input.sessionKey)
  if(existing?.ready){if(existing.initialXML!==input.initialXML)return Promise.reject(error('SESSION_CHANGED','同一会话不能替换初始内容'));return Promise.resolve()}
  discardPrepared()
  preparing.value=true
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{if(pending?.key!==input.sessionKey)return;pending=undefined;preparing.value=false;slots.value=slots.value.filter(slot=>slot.sessionKey===displayedKey.value);reject(error('PREPARATION_TIMEOUT','目标画布准备超时，原画布已保留'))},HOST_PREPARATION_TIMEOUT_MS)
    pending={key:input.sessionKey,resolve,reject,timer}
    const scope=(key:string)=>key.includes(':')?key.slice(0,key.lastIndexOf(':')):undefined
    const reusable=slots.value.find(slot=>slot.sessionKey!==displayedKey.value&&(slot.ready||slot.warm)&&scope(slot.sessionKey)&&scope(slot.sessionKey)===scope(input.sessionKey)&&slot.initialXML.includes('fmDocumentId=')&&input.initialXML.includes('fmDocumentId=')&&!/math\s*=\s*["']1["']/.test(slot.initialXML+input.initialXML))
    if(reusable){if(reusable.ready)loadReusable(reusable,input);else waitingForEngine={engineKey:reusable.engineKey,input}}
    else slots.value=[...slots.value.filter(slot=>slot.sessionKey===displayedKey.value),{...input,engineKey:input.sessionKey,ready:false}]
  })
}
function loadReusable(slot:Slot,input:DocumentInput){
 const host=hosts.get(slot.engineKey)
 if(!host){failed({sessionKey:input.sessionKey,code:'ENGINE_MISSING',message:'预热引擎不可用'});return}
 slots.value=slots.value.map(item=>item.engineKey===slot.engineKey?{...input,engineKey:slot.engineKey,ready:false}:item)
 void host.loadDocument(input).catch(cause=>failed({sessionKey:input.sessionKey,code:cause.code??'LOAD_FAILED',message:cause.message}))
}
function ready(event:HostReady){
  const slot=slots.value.find(slot=>slot.sessionKey===event.sessionKey);if(!slot||disposed)return
  // DrawioHost emits ready only after the real native load and two paint frames.
  slots.value=slots.value.map(item=>item===slot?{...item,ready:true,failed:false}:item)
  if(waitingForEngine?.engineKey===slot.engineKey){const waiting=waitingForEngine;waitingForEngine=undefined;if(pending?.key===waiting.input.sessionKey){loadReusable(slot,waiting.input);return}}
  if(pending?.key===event.sessionKey){const request=pending;pending=undefined;preparing.value=false;clearTimeout(request.timer);request.resolve();if(props.sessionKey===event.sessionKey)activate(event.sessionKey)}
  else if(isActive(event.sessionKey)){emit('ready',event);warmSpare()}
}
function failed(event:HostError){
  if(waitingForEngine&&slots.value.some(slot=>slot.sessionKey===event.sessionKey&&slot.engineKey===waitingForEngine?.engineKey)){const input=waitingForEngine.input;waitingForEngine=undefined;failed({...event,sessionKey:input.sessionKey});return}
  if(event.sessionKey!==displayedKey.value){
    slots.value=slots.value.map(slot=>slot.sessionKey===event.sessionKey?{...slot,failed:true}:slot)
    if(pending?.key===event.sessionKey){const request=pending;pending=undefined;clearTimeout(request.timer);slots.value=slots.value.filter(slot=>slot.sessionKey===displayedKey.value);preparing.value=false;request.reject(error(event.code,event.message))}
    return
  }
  if(isActive(event.sessionKey)){slots.value=slots.value.map(slot=>slot.sessionKey===event.sessionKey?{...slot,failed:true}:slot);emit('error',event)}
}
watch(()=>props.warmupKey,key=>{
 if(!key||disposed||displayedKey.value||slots.value.length)return
 const sessionKey=key+':welcome-warm',initialXML='<mxfile><diagram id="warm"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><UserObject id="warm-title" label="FlyMind" fmDocumentId="warm-placeholder"><mxCell vertex="1" parent="1" style="fontFamily=Noto Sans CJK SC;fontSize=16;"><mxGeometry width="100" height="24" as="geometry"/></mxCell></UserObject></root></mxGraphModel></diagram></mxfile>'
 slots.value=[1,2].map(index=>({sessionKey:sessionKey+'-'+index,engineKey:sessionKey+'-'+index,initialXML,title:'',ready:false,warm:true}))
},{immediate:true})
watch(()=>props.sessionKey,key=>{
  if(!key){discardPrepared();slots.value=[];displayedKey.value='';return}
  if(key===displayedKey.value)return
  if(activate(key))return
  // Compatibility for an initial/direct activation: preserve the old frame while preparing.
  void prepare({sessionKey:key,initialXML:props.initialXML,title:props.title}).then(()=>{if(props.sessionKey===key)activate(key)}).catch(cause=>{if(!disposed)emit('error',{sessionKey:key,code:cause.code??'PREPARATION_FAILED',message:cause.message})})
},{flush:'post'})
onBeforeUnmount(()=>{disposed=true;clearTimeout(warmTimer);discardPrepared();hosts.clear()})
defineExpose({prepare,discardPrepared,groupSelection:(ungroup=false)=>activeHost().groupSelection(ungroup),
  captureXML:()=>activeHost().captureXML(),commitAndCaptureXML:()=>activeHost().commitAndCaptureXML(),
  hasUncommittedText:()=>{try{return activeHost().hasUncommittedText()}catch{return true}},
  getSelection:()=>activeHost().getSelection(),mergeXML:(xml:string)=>activeHost().mergeXML(xml),
  isInteracting:()=>{try{return activeHost().isInteracting()}catch{return true}},
  applyRemoteXML:(fromXML:string,toXML:string)=>activeHost().applyRemoteXML(fromXML,toXML),
  undo:()=>activeHost().undo(),redo:()=>activeHost().redo(),fit:()=>activeHost().fit(),
  deleteSelectedBranch:()=>activeHost().deleteSelectedBranch()
})
</script>

<template>
  <div class="drawio-viewport" :data-appearance="appearance??'light'" :aria-busy="covering||layoutLoading">
    <slot v-if="!displayedKey&&!covering" />
    <div v-for="slot in slots" :key="slot.engineKey" class="drawio-viewport-slot" :class="{'drawio-viewport-active':slot.sessionKey===displayedKey}" :inert="slot.sessionKey!==displayedKey||covering||layoutLoading" :aria-hidden="slot.sessionKey!==displayedKey">
      <DrawioHost :ref="value=>{if(value)hosts.set(slot.engineKey,value as Host);else hosts.delete(slot.engineKey)}" :appearance="appearance??'light'" :collaboration="props.collaboration" :session-key="slot.sessionKey" :initial-x-m-l="slot.initialXML" :title="slot.title" @ready="ready" @error="failed" @history-requested="action=>{if(isActive(slot.sessionKey))emit('historyRequested',action)}" @xml="(event:HostXML)=>{if(isActive(event.sessionKey))emit('xml',event)}" @save-requested="(event:HostSaveRequested)=>{if(isActive(event.sessionKey))emit('saveRequested',event)}" />
    </div>
    <div class="drawio-viewport-loader" :class="{'drawio-viewport-loading':covering}" :aria-hidden="!covering" role="status" aria-label="加载中">
      <div class="drawio-viewport-loader-content"><span class="drawio-viewport-spinner" aria-hidden="true"></span><span>加载中</span></div>
    </div>
    <div class="drawio-layout-overlay" :class="{'drawio-layout-running':layoutLoading&&!covering}" :aria-hidden="!layoutLoading||covering" role="status" aria-live="polite" aria-atomic="true">
      <div class="drawio-layout-status"><span class="drawio-layout-spinner" aria-hidden="true"></span><span>{{layoutLoadingLabel||'正在排版…'}}</span></div>
    </div>
  </div>
</template>

<style scoped>
.drawio-viewport{position:relative;flex:1;min-width:0;min-height:360px;height:100%;overflow:hidden;background:var(--fm-viewport-bg,#f5f6fa)}
.drawio-viewport-slot{position:absolute;inset:0;pointer-events:none;z-index:0}
.drawio-viewport-slot:not(.drawio-viewport-active){visibility:hidden}
.drawio-viewport-active{pointer-events:auto;z-index:1}
.drawio-viewport-loader{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;background:var(--fm-viewport-bg,#f5f6fa);opacity:0;visibility:hidden;pointer-events:none}
.drawio-viewport-loading{opacity:1;visibility:visible;pointer-events:auto}
.drawio-viewport-loader-content{display:flex;align-items:center;gap:9px;color:var(--fm-viewport-text,#747f94);font:12px "Segoe UI","Microsoft YaHei",sans-serif;opacity:0}
.drawio-viewport-loading .drawio-viewport-loader-content{animation:drawio-viewport-reveal 1ms linear 140ms forwards}
.drawio-viewport-spinner{width:16px;height:16px;box-sizing:border-box;border:2px solid var(--fm-viewport-line,#dfe3ed);border-top-color:var(--fm-viewport-accent,#6775b9);border-radius:50%;animation:drawio-viewport-spin .8s linear infinite}
@keyframes drawio-viewport-reveal{to{opacity:1}}
@keyframes drawio-viewport-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.drawio-viewport-spinner{animation:none}.drawio-viewport-loading .drawio-viewport-loader-content{animation:none;opacity:1}}
.drawio-viewport[data-appearance="dark"]{--fm-viewport-bg:#212121;--fm-viewport-text:#a1a1a1;--fm-viewport-line:#3a3a3a;--fm-viewport-accent:#8b83ff}
.drawio-layout-overlay{position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;background:rgba(250,250,252,.48);opacity:0;visibility:hidden;pointer-events:none;transition:opacity 160ms ease,visibility 0s linear 160ms}
.drawio-layout-running{opacity:1;visibility:visible;pointer-events:auto;transition:opacity 160ms ease,visibility 0s}
.drawio-layout-status{display:flex;align-items:center;gap:10px;padding:12px 17px;border:1px solid var(--ui-border,#e0e1e6);border-radius:12px;background:var(--ui-panel,#fff);color:var(--ui-text,#1c2024);box-shadow:0 4px 20px #0000000c;font:13px "Segoe UI","Microsoft YaHei",sans-serif}
.drawio-layout-spinner{width:16px;height:16px;box-sizing:border-box;border:2px solid var(--fm-viewport-line,#e0e1e6);border-top-color:var(--fm-viewport-accent,#5b5bd6);border-radius:50%;animation:drawio-viewport-spin .8s linear infinite;animation-play-state:paused}
.drawio-layout-running .drawio-layout-spinner{animation-play-state:running}
.drawio-viewport[data-appearance="dark"] .drawio-layout-overlay{background:rgba(25,25,25,.5)}
.drawio-viewport[data-appearance="dark"] .drawio-layout-status{background:#2b2b2b;border-color:#3a3a3a;color:#e1e1e1;box-shadow:0 4px 20px #0003}
@media(prefers-reduced-motion:reduce){.drawio-layout-overlay{transition:none}.drawio-layout-spinner{animation:none}}
</style>
