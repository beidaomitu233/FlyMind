<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import Icon from './Icon.vue'
import {agentConnectionScope,buildAgentInstallPrompt,type AgentConnectContext} from './agent-connect'
const props=withDefaults(defineProps<{open:boolean;appearance?:'light'|'dark';context?:AgentConnectContext}>(),{appearance:'light'})
const emit=defineEmits<{close:[];confirmed:[]}>()
const panel=ref<HTMLElement>(),title=ref<HTMLElement>(),copied=ref(false),error=ref('')
const prompt=computed(()=>buildAgentInstallPrompt(props.context)),scope=computed(()=>agentConnectionScope(props.context))
let previousFocus:HTMLElement|undefined,overflow:string|undefined,generation=0
function release(){document.removeEventListener('keydown',keydown,true);if(overflow!==undefined){document.body.style.overflow=overflow;overflow=undefined}}
function keydown(event:KeyboardEvent){
 if(!props.open)return
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();emit('close');return}
 if(event.key!=='Tab')return
 const list=[...(panel.value?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],summary,textarea,[tabindex="0"]')??[])].filter(el=>el.getClientRects().length>0),first=list[0],last=list.at(-1),active=document.activeElement
 if(!first){event.preventDefault();return}
 if(event.shiftKey&&(active===first||!list.includes(active as HTMLElement))){event.preventDefault();last?.focus()}
 else if(!event.shiftKey&&(active===last||!list.includes(active as HTMLElement))){event.preventDefault();first.focus()}
}
async function copy(){const value=prompt.value;copied.value=false;error.value='';try{await navigator.clipboard.writeText(value);if(prompt.value===value)copied.value=true}catch{error.value='未能自动复制，请选中下面的消息手动复制。'}}
watch(prompt,()=>{copied.value=false;error.value=''})
watch(()=>props.open,async open=>{const own=++generation;if(open){previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;overflow=document.body.style.overflow;document.body.style.overflow='hidden';document.addEventListener('keydown',keydown,true);copied.value=false;error.value='';await nextTick();if(own===generation)title.value?.focus()}else{release();const prior=previousFocus;previousFocus=undefined;await nextTick();if(own===generation&&prior?.isConnected)prior.focus()}},{immediate:true})
onBeforeUnmount(()=>{generation++;release();if(previousFocus?.isConnected)previousFocus.focus()})
</script>
<template>
 <Teleport to="body"><div v-if="open" class="fm-connect-backdrop" :data-appearance="appearance" @click.self="emit('close')">
  <section ref="panel" class="fm-connect" role="dialog" aria-modal="true" aria-labelledby="fm-connect-title" aria-describedby="fm-connect-description">
   <header><div><h2 id="fm-connect-title" ref="title" tabindex="-1">一句话，开始一起画</h2></div><button class="fm-connect-icon" aria-label="关闭连接面板" @click="emit('close')"><Icon name="close" :size="20"/></button></header>
   <p id="fm-connect-description">适用于支持 MCP 的 Agent，例如 Codex、WorkBuddy。</p>
   <ol class="fm-connect-steps"><li>复制消息，发给 Agent</li><li>在浏览器中本人登录、选择团队并授权</li></ol>
   <aside v-if="scope==='same-diagram'" class="fm-connect-context"><strong>继续当前图 · {{ context?.title||'当前图形' }}</strong><p>保留已有编辑，在同一张图继续。</p></aside>
   <aside v-else-if="scope==='import-required'" class="fm-connect-context"><strong>先确认云端图形</strong><p>本地图不会自动上传。请显式导入云端团队后，从那张图打开此面板，避免改错图。</p></aside>
   <label class="fm-connect-message">发给 Agent 的消息<textarea :value="prompt" readonly rows="6" aria-label="给 Agent 的安装消息"/></label>
   <button class="fm-connect-primary" @click="copy"><Icon :name="copied?'check':'copy'" :size="16"/>{{ copied?'已复制，去发给 Agent':'复制安装消息' }}</button>
   <p class="fm-connect-status" role="status">{{ error||(copied?'消息已复制，请在 Agent 中继续授权。':'') }}</p>
  </section>
 </div></Teleport>
</template>
<style scoped src="./flymind-agent-connect.css"></style>
