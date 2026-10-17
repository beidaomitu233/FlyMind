<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,watch,nextTick} from 'vue'
import {DrawioHostController,DrawioHostProtocolError,type HostReady,type HostXML,type HostError,type HostSaveRequested} from '../engine/drawio-host/controller'
import {drawioHostURL} from '../engine/drawio-host/library'
import {applyDrawioAppearance,type DrawioAppearance} from '../engine/drawio-host/appearance'
import {hasUncommittedNativeText} from '../engine/drawio-host/editing'

const props=defineProps<{sessionKey:string;initialXML:string;title?:string;appearance?:DrawioAppearance}>()
const emit=defineEmits<{ready:[event:HostReady];xml:[event:HostXML];error:[event:HostError];saveRequested:[event:HostSaveRequested]}>()
// Initial document is immutable for this mounted session. Saving never reloads it.
const initial={sessionKey:props.sessionKey,initialXML:props.initialXML,title:props.title}
const iframe=ref<HTMLIFrameElement>(),src=ref<string>(),visible=ref(false),loadFailed=ref(false),attempt=ref(0)
let disposed=false,paintFrame:number|undefined,paintGeneration=0
function cancelReveal(){paintGeneration++;if(paintFrame!==undefined)cancelAnimationFrame(paintFrame);paintFrame=undefined}
function applyAppearance(){const document=iframe.value?.contentDocument;if(document?.head)applyDrawioAppearance(document,props.appearance??'light')}
function reveal(event:HostReady){
  applyAppearance()
  const generation=++paintGeneration
  paintFrame=requestAnimationFrame(()=>{paintFrame=requestAnimationFrame(()=>{paintFrame=undefined;if(disposed||generation!==paintGeneration)return;visible.value=true;loadFailed.value=false;emit('ready',event)})})
}
let controller:DrawioHostController|undefined
const receive=(event:MessageEvent)=>controller?.handle(event)
const report=(error:unknown)=>{if(!visible.value)loadFailed.value=true;emit('error',{sessionKey:initial.sessionKey,code:error instanceof DrawioHostProtocolError?error.code:'HOST_ERROR',message:error instanceof Error?error.message:String(error)})}
function boot(){
  if(disposed)return
  visible.value=false;loadFailed.value=false;cancelReveal()
  try{
    controller=new DrawioHostController({...initial,origin:window.location.origin,source:()=>iframe.value?.contentWindow,
      post:(data,origin)=>{if(!iframe.value?.contentWindow)throw new Error('编辑器窗口不存在');iframe.value.contentWindow.postMessage(data,origin)},
      readViewport:()=>{const el=iframe.value?.contentDocument?.querySelector('.geDiagramContainer');if(!el||!Number.isFinite(el.scrollLeft)||!Number.isFinite(el.scrollTop))throw new DrawioHostProtocolError('VIEWPORT_UNAVAILABLE','当前画布不可读');return {scrollLeft:el.scrollLeft,scrollTop:el.scrollTop}},
      onReady:reveal,onXML:e=>emit('xml',e),onError:e=>{if(!visible.value){cancelReveal();loadFailed.value=true}emit('error',e)},onSaveRequested:e=>emit('saveRequested',e)})
    window.addEventListener('message',receive);const url=new URL(drawioHostURL(window.location.origin));url.searchParams.set('tooltips','0');url.searchParams.set('dark','0');src.value=url.href
  }catch(error){report(error)}
}
onMounted(boot)
async function retryLoad(){if(disposed)return;cancelReveal();controller?.dispose();controller=undefined;visible.value=false;loadFailed.value=false;src.value=undefined;attempt.value++;await nextTick();boot()}
watch(()=>props.appearance,applyAppearance)
watch(()=>props.sessionKey,key=>{if(key!==initial.sessionKey){cancelReveal();visible.value=false;controller?.dispose();report(new DrawioHostProtocolError('SESSION_CHANGED','切图须以 sessionKey 作为组件 key 重新挂载'))}})
onBeforeUnmount(()=>{disposed=true;cancelReveal();window.removeEventListener('message',receive);controller?.dispose();controller=undefined})
const requireController=()=>{if(!controller)throw new DrawioHostProtocolError('NOT_READY','编辑器尚未就绪');return controller}
defineExpose({groupSelection:(ungroup=false)=>requireController().groupSelection(ungroup),getSelection:()=>requireController().getSelection(),mergeXML:(xml:string)=>requireController().mergeXML(xml),undo:()=>requireController().undo(),redo:()=>requireController().redo(),deleteSelectedBranch:()=>controller?controller.deleteSelectedBranch():Promise.reject(new DrawioHostProtocolError('NOT_READY','编辑器尚未就绪')),captureXML:()=>controller?.captureXML()??Promise.reject(new DrawioHostProtocolError('NOT_READY','编辑器尚未就绪')),
  commitAndCaptureXML:()=>controller?.commitAndCaptureXML()??Promise.reject(new DrawioHostProtocolError('NOT_READY','编辑器尚未就绪')),
  hasUncommittedText:()=>hasUncommittedNativeText(()=>iframe.value?.contentDocument??null),
  fit:()=>{try{if(!controller)throw new DrawioHostProtocolError('NOT_READY','编辑器尚未就绪');controller.fit()}catch(error){report(error)}}})
</script>

<template>
  <div class="drawio-host-surface" :data-appearance="appearance??'light'" :aria-busy="!visible&&!loadFailed">
    <iframe :key="attempt" ref="iframe" :src="src" @load="applyAppearance" class="drawio-host" :class="{'drawio-host-pending':!visible}" :aria-hidden="!visible" :inert="!visible" :tabindex="visible?undefined:-1" title="FlyMind 原生图形编辑器" referrerpolicy="same-origin" />
    <button v-if="loadFailed&&!visible" class="drawio-host-retry" @click="retryLoad">重新加载画布</button>
  </div>
</template>

<style scoped>
.drawio-host-surface{position:relative;display:flex;flex:1;min-width:0;min-height:360px;height:100%;background:var(--fm-host-bg,#f5f6fa)}
.drawio-host-pending{visibility:hidden!important;pointer-events:none!important}
.drawio-host-retry{position:absolute;inset:50% auto auto 50%;transform:translate(-50%,-50%);border:1px solid #e1e5ed;border-radius:7px;background:var(--fm-host-popup,#fff);padding:8px 12px;color:var(--fm-host-text,#747f94);font:12px "Segoe UI","Microsoft YaHei",sans-serif;cursor:pointer}
.drawio-host { flex:1; display:block; width:100%; height:100%; min-height:360px; border:0; background:#fff; }
.drawio-host-surface[data-appearance="dark"]{--fm-host-bg:#212121;--fm-host-popup:#2b2b2b;--fm-host-text:#b6b6b6}
</style>
