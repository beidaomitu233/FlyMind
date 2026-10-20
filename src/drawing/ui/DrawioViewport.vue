<script setup lang="ts">
import {shallowRef,watch,onBeforeUnmount,nextTick,computed} from 'vue'
import DrawioHost from './DrawioHost.vue'
import type {DrawioAppearance} from '../engine/drawio-host/appearance'
import {DrawioHostProtocolError,type HostReady,type HostXML,type HostError,type HostSaveRequested} from '../engine/drawio-host/controller'

interface DocumentInput {sessionKey:string;initialXML:string;title?:string}
interface Slot extends DocumentInput {ready:boolean;failed?:boolean}
type Host=InstanceType<typeof DrawioHost>
const props=defineProps<DocumentInput&{loading?:boolean;appearance?:DrawioAppearance;collaboration?:boolean}>()
const emit=defineEmits<{ready:[event:HostReady];xml:[event:HostXML];error:[event:HostError];saveRequested:[event:HostSaveRequested]}>()
const slots=shallowRef<Slot[]>(props.sessionKey?[{sessionKey:props.sessionKey,initialXML:props.initialXML,title:props.title,ready:false}]:[])
const displayedKey=shallowRef(props.sessionKey)
const hosts=new Map<string,Host>()
const covering=computed(()=>{const active=slots.value.find(slot=>slot.sessionKey===displayedKey.value);return !!props.loading||slots.value.length>1||!!active&&!active.ready&&!active.failed})
let disposed=false
let pending:{key:string;resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined
function error(code:string,message:string){return new DrawioHostProtocolError(code,message)}
function activeHost(){const host=hosts.get(displayedKey.value);if(!host)throw error('NOT_READY','当前画布尚未就绪');return host}
function isActive(key:string){return key===displayedKey.value&&key===props.sessionKey}
function discardPrepared(){
  if(pending){clearTimeout(pending.timer);pending.reject(error('PREPARATION_CANCELLED','已取消候选画布'));pending=undefined}
  slots.value=slots.value.filter(slot=>slot.sessionKey===displayedKey.value)
}
function activate(key:string){
  const target=slots.value.find(slot=>slot.sessionKey===key&&slot.ready)
  if(!target)return false
  // One reactive render makes the prepared frame visible and removes the old Host.
  displayedKey.value=key;slots.value=[target]
  void nextTick(()=>{if(!disposed&&isActive(key))emit('ready',{sessionKey:key})})
  return true
}
function prepare(input:DocumentInput):Promise<void>{
  if(disposed)return Promise.reject(error('SESSION_CLOSED','画布已关闭'))
  if(!input.sessionKey||!input.initialXML)return Promise.reject(error('INVALID_INITIAL_DOCUMENT','候选画布信息无效'))
  if(input.sessionKey===displayedKey.value)return slots.value[0]?.ready?Promise.resolve():Promise.reject(error('NOT_READY','当前画布仍在加载'))
  const existing=slots.value.find(slot=>slot.sessionKey===input.sessionKey)
  if(existing?.ready){if(existing.initialXML!==input.initialXML)return Promise.reject(error('SESSION_CHANGED','同一会话不能替换初始内容'));return Promise.resolve()}
  discardPrepared()
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{if(pending?.key!==input.sessionKey)return;pending=undefined;slots.value=slots.value.filter(slot=>slot.sessionKey===displayedKey.value);reject(error('PREPARATION_TIMEOUT','目标画布准备超时，原画布已保留'))},40000)
    pending={key:input.sessionKey,resolve,reject,timer}
    slots.value=[...slots.value,{...input,ready:false}]
  })
}
function ready(event:HostReady){
  const slot=slots.value.find(slot=>slot.sessionKey===event.sessionKey);if(!slot||disposed)return
  // DrawioHost emits ready only after the real native load and two paint frames.
  slots.value=slots.value.map(item=>item===slot?{...item,ready:true,failed:false}:item)
  if(pending?.key===event.sessionKey){const request=pending;pending=undefined;clearTimeout(request.timer);request.resolve();if(props.sessionKey===event.sessionKey)activate(event.sessionKey)}
  else if(isActive(event.sessionKey))emit('ready',event)
}
function failed(event:HostError){
  if(event.sessionKey!==displayedKey.value){
    if(pending?.key===event.sessionKey){const request=pending;pending=undefined;clearTimeout(request.timer);slots.value=slots.value.filter(slot=>slot.sessionKey===displayedKey.value);request.reject(error(event.code,event.message))}
    return
  }
  if(isActive(event.sessionKey)){slots.value=slots.value.map(slot=>slot.sessionKey===event.sessionKey?{...slot,failed:true}:slot);emit('error',event)}
}
watch(()=>props.sessionKey,key=>{
  if(!key){discardPrepared();slots.value=[];displayedKey.value='';return}
  if(key===displayedKey.value)return
  if(activate(key))return
  // Compatibility for an initial/direct activation: preserve the old frame while preparing.
  void prepare({sessionKey:key,initialXML:props.initialXML,title:props.title}).then(()=>{if(props.sessionKey===key)activate(key)}).catch(cause=>{if(!disposed)emit('error',{sessionKey:key,code:cause.code??'PREPARATION_FAILED',message:cause.message})})
},{flush:'post'})
onBeforeUnmount(()=>{disposed=true;discardPrepared();hosts.clear()})
defineExpose({prepare,discardPrepared,groupSelection:(ungroup=false)=>activeHost().groupSelection(ungroup),
  captureXML:()=>activeHost().captureXML(),commitAndCaptureXML:()=>activeHost().commitAndCaptureXML(),
  hasUncommittedText:()=>{try{return activeHost().hasUncommittedText()}catch{return true}},
  getSelection:()=>activeHost().getSelection(),mergeXML:(xml:string)=>activeHost().mergeXML(xml),
  applyRemoteXML:(fromXML:string,toXML:string)=>activeHost().applyRemoteXML(fromXML,toXML),
  undo:()=>activeHost().undo(),redo:()=>activeHost().redo(),fit:()=>activeHost().fit(),
  deleteSelectedBranch:()=>activeHost().deleteSelectedBranch()
})
</script>

<template>
  <div class="drawio-viewport" :data-appearance="appearance??'light'" :aria-busy="covering">
    <slot v-if="!slots.length&&!covering" />
    <div v-for="slot in slots" :key="slot.sessionKey" class="drawio-viewport-slot" :class="{'drawio-viewport-active':slot.sessionKey===displayedKey}" :inert="slot.sessionKey!==displayedKey||covering" :aria-hidden="slot.sessionKey!==displayedKey">
      <DrawioHost :ref="value=>{if(value)hosts.set(slot.sessionKey,value as Host);else hosts.delete(slot.sessionKey)}" :appearance="appearance??'light'" :collaboration="props.collaboration" :session-key="slot.sessionKey" :initial-x-m-l="slot.initialXML" :title="slot.title" @ready="ready" @error="failed" @xml="(event:HostXML)=>{if(isActive(event.sessionKey))emit('xml',event)}" @save-requested="(event:HostSaveRequested)=>{if(isActive(event.sessionKey))emit('saveRequested',event)}" />
    </div>
    <div class="drawio-viewport-loader" :class="{'drawio-viewport-loading':covering}" :aria-hidden="!covering" role="status" aria-label="加载中">
      <div class="drawio-viewport-loader-content"><span class="drawio-viewport-spinner" aria-hidden="true"></span><span>加载中</span></div>
    </div>
  </div>
</template>

<style scoped>
.drawio-viewport{position:relative;flex:1;min-width:0;min-height:360px;height:100%;overflow:hidden;background:var(--fm-viewport-bg,#f5f6fa)}
.drawio-viewport-slot{position:absolute;inset:0;pointer-events:none;z-index:0}
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
</style>
