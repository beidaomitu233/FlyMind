<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import Icon from './Icon.vue'
import {flymindDocumentation} from './flymind-documentation'

const props=withDefaults(defineProps<{open:boolean;appearance?:'light'|'dark'}>(),{appearance:'light'})
const emit=defineEmits<{close:[]}>()
const selected=ref(flymindDocumentation[0].id),panel=ref<HTMLElement>(),heading=ref<HTMLElement>(),article=ref<HTMLElement>(),copied=ref(''),copyError=ref('')
const current=computed(()=>flymindDocumentation.find(section=>section.id===selected.value)??flymindDocumentation[0])
let previousFocus:HTMLElement|undefined,previousOverflow:string|undefined,generation=0
function focusable(){return [...(panel.value?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="0"]')??[])].filter(e=>e.getClientRects().length>0)}
function onKeydown(event:KeyboardEvent){
 if(!props.open)return
 if(event.key==='Escape'){event.preventDefault();event.stopPropagation();emit('close');return}
 if(event.key!=='Tab')return
 const list=focusable(),first=list[0],last=list.at(-1);if(!first){event.preventDefault();return}
 const active=document.activeElement
 if(event.shiftKey&&(active===first||!list.includes(active as HTMLElement))){event.preventDefault();last?.focus()}
 else if(!event.shiftKey&&(active===last||!list.includes(active as HTMLElement))){event.preventDefault();first.focus()}
}
async function selectSection(id:string){selected.value=id;copied.value='';copyError.value='';await nextTick();article.value?.scrollTo({top:0});heading.value?.focus({preventScroll:true})}
async function copy(code:string,key:string){
 copied.value='';copyError.value=''
 try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(code);copied.value=key}
 catch{copyError.value='未能自动复制，请选中代码手动复制。'}
}
function release(){document.removeEventListener('keydown',onKeydown,true);if(previousOverflow!==undefined){document.body.style.overflow=previousOverflow;previousOverflow=undefined}}
watch(()=>props.open,async open=>{
 const own=++generation
 if(open){previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;if(previousOverflow===undefined)previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';document.addEventListener('keydown',onKeydown,true);await nextTick();if(own===generation)heading.value?.focus({preventScroll:true})}
 else{release();const restore=previousFocus;previousFocus=undefined;await nextTick();if(own===generation&&restore?.isConnected)restore.focus({preventScroll:true})}
},{immediate:true})
onBeforeUnmount(()=>{generation++;release();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true})})
</script>

<template>
 <Teleport to="body">
  <div v-if="open" class="fm-help-backdrop" :data-appearance="appearance" @click.self="emit('close')">
   <section ref="panel" class="fm-help" role="dialog" aria-modal="true" aria-labelledby="fm-help-title" aria-describedby="fm-help-subtitle">
    <header class="fm-help-header">
     <div class="fm-help-brand"><span class="fm-help-mark"><Icon name="diagram" :size="22"/></span><div><h1 id="fm-help-title">FlyMind 使用文档</h1><p id="fm-help-subtitle">画清关系，继续协作</p></div></div>
     <button class="fm-help-close" type="button" aria-label="关闭使用文档" title="关闭（Esc）" @click="emit('close')"><Icon name="close" :size="19"/></button>
    </header>
    <div class="fm-help-body">
     <nav class="fm-help-nav" aria-label="文档章节"><span class="fm-help-nav-label">使用指南</span><button v-for="(section,index) in flymindDocumentation" :key="section.id" type="button" :aria-current="selected===section.id?'page':undefined" @click="selectSection(section.id)"><span class="fm-help-nav-number">{{ String(index+1).padStart(2,'0') }}</span>{{ section.title }}<span v-if="selected===section.id" class="fm-help-active-dot" aria-hidden="true"/></button><p>按 Esc 关闭<br>无需离开当前图形</p></nav>
     <article ref="article" class="fm-help-article" :aria-label="current.title">
      <div class="fm-help-article-heading"><span class="fm-help-eyebrow">{{ current.kicker }}</span><h2 ref="heading" tabindex="-1">{{ current.title }}</h2><p>{{ current.description }}</p></div>
      <template v-for="(block,index) in current.blocks" :key="current.id+'-'+index">
       <p v-if="block.kind==='paragraph'" class="fm-help-paragraph">{{ block.text }}</p>
       <ol v-else-if="block.kind==='steps'" class="fm-help-steps"><li v-for="(text,step) in block.items" :key="step"><span aria-hidden="true">{{ step+1 }}</span><p>{{ text }}</p></li></ol>
       <div v-else-if="block.kind==='cards'" class="fm-help-cards"><section v-for="card in block.items" :key="card.title"><h3>{{ card.title }}</h3><p>{{ card.text }}</p></section></div>
       <aside v-else-if="block.kind==='notice'" class="fm-help-notice"><Icon name="bolt" :size="16"/><div><h3>{{ block.title }}</h3><p>{{ block.text }}</p></div></aside>
       <div v-else-if="block.kind==='code'" class="fm-help-code"><div class="fm-help-code-header"><span>{{ block.title }}</span><button type="button" :aria-label="'复制'+block.title" @click="copy(block.code,current.id+'-'+index)"><Icon :name="copied===current.id+'-'+index?'check':'copy'" :size="13"/>{{ copied===current.id+'-'+index?'已复制':'复制' }}</button></div><pre :aria-label="block.title" tabindex="0"><code>{{ block.code }}</code></pre><span class="fm-help-language">{{ block.language }}</span></div>
       <div v-else-if="block.kind==='links'" class="fm-help-links"><a v-for="link in block.items" :key="link.href" :href="link.href" target="_blank" rel="noopener noreferrer">{{ link.label }}<span aria-hidden="true">↗</span></a></div>
      </template>
      <p class="fm-help-copy-status" role="status" aria-live="polite">{{ copyError||(copied?'已复制到剪贴板':'') }}</p>
     </article>
    </div>
   </section>
  </div>
 </Teleport>
</template>

<style scoped>
.fm-help-backdrop{--help-bg:#fff;--help-side:#f8f9fb;--help-surface:#f4f5f8;--help-text:#252630;--help-muted:#686d7b;--help-border:#e7e8ed;--help-accent:#6256cc;--help-accent-bg:#f1efff;position:fixed;inset:0;z-index:1800;display:grid;place-items:center;padding:28px;background:rgba(16,18,27,.38);color:var(--help-text);font-family:Inter,"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.6}
.fm-help-backdrop[data-appearance=dark]{--help-bg:#212121;--help-side:#191919;--help-surface:#292929;--help-text:#ededee;--help-muted:#aaaab1;--help-border:#38383b;--help-accent:#b5afff;--help-accent-bg:#302d43;background:rgba(0,0,0,.58);color-scheme:dark}
.fm-help,.fm-help *{box-sizing:border-box}.fm-help{width:min(980px,100%);height:min(760px,calc(100dvh - 56px));display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--help-border);border-radius:18px;background:var(--help-bg);box-shadow:0 24px 80px #0003}.fm-help button,.fm-help a{font:inherit}.fm-help button{cursor:pointer}.fm-help button:focus-visible,.fm-help a:focus-visible,.fm-help pre:focus-visible{outline:2px solid var(--help-accent);outline-offset:3px}.fm-help h1,.fm-help h2,.fm-help h3,.fm-help p{margin:0}
.fm-help-header{flex:none;display:flex;align-items:center;justify-content:space-between;padding:22px 28px;border-bottom:1px solid var(--help-border)}.fm-help-brand{display:flex;align-items:center;gap:13px}.fm-help-mark{display:grid;place-items:center;width:44px;height:44px;background:var(--help-accent-bg);color:var(--help-accent);border-radius:13px}.fm-help-header h1{font-size:16px;font-weight:650;letter-spacing:.01em}.fm-help-header p{font-size:12px;color:var(--help-muted);margin-top:2px}.fm-help-close{display:grid;place-items:center;width:34px;height:34px;background:none;border:0;color:var(--help-muted);border-radius:8px}.fm-help-close:hover{background:var(--help-surface);color:var(--help-text)}
.fm-help-body{display:grid;grid-template-columns:200px minmax(0,1fr);min-height:0;flex:1}.fm-help-nav{background:var(--help-side);border-right:1px solid var(--help-border);padding:28px 14px;overflow:auto}.fm-help-nav-label{display:block;margin:0 14px 14px;color:var(--help-muted);font-size:11px;letter-spacing:.12em}.fm-help-nav button{display:flex;align-items:center;gap:10px;text-align:left;width:100%;padding:12px 13px;margin:3px 0;background:none;border:0;border-radius:9px;white-space:nowrap;color:var(--help-muted);font-size:13px}.fm-help-nav button:hover{background:var(--help-surface);color:var(--help-text)}.fm-help-nav button[aria-current]{background:var(--help-accent-bg);color:var(--help-accent);font-weight:600}.fm-help-nav-number{font-size:10px;font-variant-numeric:tabular-nums;opacity:.7}.fm-help-active-dot{width:5px;height:5px;background:currentColor;border-radius:50%;margin-left:auto}.fm-help-nav>p{margin:32px 14px 0;color:var(--help-muted);font-size:11px;line-height:1.9}
.fm-help-article{min-width:0;overflow:auto;overscroll-behavior:contain;padding:34px 38px 20px;scrollbar-color:var(--help-border) transparent}.fm-help-article-heading{margin-bottom:25px}.fm-help-eyebrow{color:var(--help-accent);font-size:11px;font-weight:600;letter-spacing:.08em}.fm-help-article h2{font-size:26px;letter-spacing:-.025em;line-height:1.35;margin-top:9px;font-weight:650;outline:none}.fm-help-article-heading>p{margin-top:12px;color:var(--help-muted);font-size:13px}.fm-help-paragraph{margin:20px 0!important;line-height:1.9;overflow-wrap:anywhere}.fm-help-steps{padding:0;list-style:none;margin:20px 0 26px}.fm-help-steps li{display:flex;gap:13px;margin:17px 0}.fm-help-steps li>span{display:grid;place-items:center;flex:none;align-self:flex-start;width:25px;height:25px;margin-top:1px;border:1px solid var(--help-border);border-radius:50%;color:var(--help-accent);font-size:11px;font-weight:600}.fm-help-steps p{line-height:1.85;overflow-wrap:anywhere}
.fm-help-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:22px 0}.fm-help-cards section{padding:16px 18px;border:1px solid var(--help-border);border-radius:11px}.fm-help-cards h3{font-size:13px;font-weight:600}.fm-help-cards p{margin-top:5px;color:var(--help-muted);font-size:12px;line-height:1.75}.fm-help-notice{display:flex;align-items:flex-start;gap:11px;padding:17px 18px;margin:22px 0;background:var(--help-accent-bg);border-radius:10px}.fm-help-notice>svg{flex:none;margin-top:3px;color:var(--help-accent)}.fm-help-notice h3{font-size:13px;font-weight:600}.fm-help-notice p{font-size:12px;margin-top:5px;line-height:1.85;color:var(--help-muted)}
.fm-help-code{margin:20px 0;border:1px solid var(--help-border);border-radius:10px;overflow:hidden;background:var(--help-surface)}.fm-help-code-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-bottom:1px solid var(--help-border);font-size:11px;color:var(--help-muted)}.fm-help-code-header button{display:flex;align-items:center;gap:5px;flex:none;padding:3px 6px;border:0;border-radius:5px;background:none;color:var(--help-text);font-size:11px}.fm-help-code-header button:hover{background:var(--help-accent-bg);color:var(--help-accent)}.fm-help-code pre{margin:0;padding:17px 18px;overflow:auto;font:12px/1.8 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2;color:var(--help-text)}.fm-help-language{display:block;padding:0 14px 8px;text-align:right;font-size:9px;letter-spacing:.06em;color:var(--help-muted)}.fm-help-links{display:flex;flex-wrap:wrap;gap:10px 20px;margin-top:26px}.fm-help-links a{display:inline-flex;gap:7px;color:var(--help-accent);text-decoration:none;font-size:12px}.fm-help-links a:hover{text-decoration:underline}.fm-help-copy-status{min-height:20px;margin-top:18px!important;color:var(--help-muted);font-size:11px}
@media(max-width:680px){.fm-help-backdrop{padding:12px}.fm-help{height:calc(100dvh - 24px);border-radius:13px}.fm-help-header{padding:16px 18px}.fm-help-body{display:flex;flex-direction:column}.fm-help-nav{flex:none;display:flex;gap:4px;overflow-x:auto;padding:9px 12px;border-right:0;border-bottom:1px solid var(--help-border)}.fm-help-nav-label,.fm-help-nav>p,.fm-help-nav-number,.fm-help-active-dot{display:none}.fm-help-nav button{width:auto;flex:none;padding:9px 11px;margin:0;font-size:12px}.fm-help-article{padding:25px 20px 12px}.fm-help-article h2{font-size:23px}.fm-help-cards{gap:8px}.fm-help-cards section{padding:13px}.fm-help-code-header{align-items:flex-start}.fm-help-code pre{font-size:11px;padding:14px}}
@media(prefers-reduced-motion:reduce){.fm-help *{scroll-behavior:auto!important}}
</style>
