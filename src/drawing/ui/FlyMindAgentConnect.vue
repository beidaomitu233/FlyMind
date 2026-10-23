<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import Icon from './Icon.vue'
import {AGENT_CONNECT_GUIDE_PATH,agentClients,agentConnectionScope,buildAgentInstallPrompt,type AgentClient,type AgentConnectContext} from './agent-connect'
const props=withDefaults(defineProps<{open:boolean;appearance?:'light'|'dark';context?:AgentConnectContext}>(),{appearance:'light'})
const emit=defineEmits<{close:[];confirmed:[]}>()
const client=ref<AgentClient>('codex'),panel=ref<HTMLElement>(),title=ref<HTMLElement>(),copied=ref(false),error=ref('')
const prompt=computed(()=>buildAgentInstallPrompt(client.value,props.context)),scope=computed(()=>agentConnectionScope(props.context))
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
   <p id="fm-connect-description">把消息发给你正在使用的 Agent，然后在浏览器中完成授权。</p>
   <div class="fm-connect-clients" aria-label="选择 AI 客户端"><button v-for="(entry,key) in agentClients" :key="key" :aria-pressed="client===key" @click="client=key">{{ entry.name }}</button></div>
   <div class="fm-connect-steps"><span><b>1</b>复制给 Agent</span><span><b>2</b>自己登录并选团队</span><span><b>3</b>回到同一张图</span></div>
   <aside v-if="scope==='same-diagram'" class="fm-connect-context"><strong>继续当前图 · {{ context?.title||'当前图形' }}</strong><span>团队 {{ context?.teamId }} · 图形 {{ context?.diagramId }}</span><p>先读最新修订，保留已有编辑，不新建副本。</p></aside>
   <aside v-else-if="scope==='import-required'" class="fm-connect-context"><strong>先确认云端图形</strong><p>本地图不会自动上传。请显式导入云端团队后，从那张图打开此面板，避免改错图。</p></aside>
   <label class="fm-connect-message">发给 {{ agentClients[client].name }} 的消息<textarea :value="prompt" readonly rows="7" aria-label="给 Agent 的安装消息"/></label>
   <button class="fm-connect-primary" @click="copy"><Icon :name="copied?'check':'copy'" :size="16"/>{{ copied?'已复制，去发给 Agent':'复制安装消息' }}</button>
   <p class="fm-connect-status" role="status">{{ error||(copied?'复制不等于已安装；请在 Agent 内继续。':'不需要在这里填写密码或 Token。') }}</p>
   <details class="fm-connect-advanced"><summary>高级：手动连接与排查</summary><pre>{{ agentClients[client].manual }}</pre><p>已有同名服务先核对地址，不覆盖其他配置。OAuth 完成后工具可能需要重连或新会话；浏览器登录不会替你修改客户端配置。这里不提供长期 PAT 或登录 cookie。</p><p>随源码提供的无密钥指南：<code>{{ AGENT_CONNECT_GUIDE_PATH }}</code>，不代表已部署同名网页。</p><a :href="agentClients[client].guide" target="_blank" rel="noopener noreferrer">查看客户端官方说明 ↗</a></details>
   <footer><button @click="emit('confirmed')">我已授权，继续</button></footer>
  </section>
 </div></Teleport>
</template>
<style scoped src="./flymind-agent-connect.css"></style>
