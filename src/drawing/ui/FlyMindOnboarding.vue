<script setup lang="ts">
import {computed,ref,watch,nextTick,onBeforeUnmount} from 'vue'
import {ONBOARDING_STEPS,type OnboardingProgress,type OnboardingStep} from '../state/onboarding'
const props=defineProps<{open:boolean;progress:OnboardingProgress;readOnly?:boolean;cloud?:boolean;hasDiagram?:boolean;canInvite?:boolean;working?:boolean;message?:string}>()
const emit=defineEmits<{close:[];later:[];skip:[step:OnboardingStep];action:[action:'create'|'connect'|'verify'|'create-team'|'members'];select:[step:OnboardingStep]}>()
const panel=ref<HTMLElement>(),labels={create:'创建图形',connect:'连接 Agent',alternate:'同图交替编辑',team:'团队协作'}
const descriptions={create:'输入名称和类型，开始第一张图。',connect:'把连接消息发给你使用的 Agent。',alternate:'人工与 Agent 在同一张图继续。',team:'创建团队，邀请同伴一起绘图。'}
const ended=computed(()=>ONBOARDING_STEPS.every(step=>props.progress.steps[step]!=='pending'))
const completedCount=computed(()=>ONBOARDING_STEPS.filter(step=>props.progress.steps[step]==='completed').length)
function disabled(step:OnboardingStep){return props.working||step==='create'&&props.readOnly||step==='alternate'&&(!props.hasDiagram||props.readOnly)}
function activate(step:OnboardingStep){
 if(disabled(step))return
 emit('select',step)
 if(step==='create'||step==='connect')emit('action',step)
 else if(step==='alternate')emit('close')
 else emit('action',props.cloud&&props.canInvite?'members':'create-team')
}
let returnTo:HTMLElement|undefined
function keyboard(event:KeyboardEvent){if(!props.open)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();emit('close')}if(event.key==='Tab'&&panel.value){const nodes=[...panel.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const index=nodes.indexOf(document.activeElement as HTMLButtonElement);if(event.shiftKey&&index<=0){event.preventDefault();nodes.at(-1)?.focus()}else if(!event.shiftKey&&(index===nodes.length-1||index<0)){event.preventDefault();nodes[0]?.focus()}}}
watch(()=>props.open,async open=>{if(open){returnTo=document.activeElement instanceof HTMLElement?document.activeElement:undefined;window.addEventListener('keydown',keyboard,true);await nextTick();panel.value?.querySelector<HTMLButtonElement>('button')?.focus()}else{window.removeEventListener('keydown',keyboard,true);if(returnTo?.isConnected)returnTo.focus()}},{immediate:true})
onBeforeUnmount(()=>window.removeEventListener('keydown',keyboard,true))
</script>
<template><div v-if="open" class="studio-overlay flymind-tour-overlay" @click.self="$emit('close')"><section ref="panel" class="studio-dialog flymind-tour" role="dialog" aria-modal="true" aria-label="新手引导"><header class="studio-dialog-heading"><h2>开始使用 FlyMind</h2><button class="studio-icon" aria-label="关闭引导" @click="$emit('close')">×</button></header>
 <div class="flymind-tour-steps" aria-label="引导步骤"><article v-for="(step,index) in ONBOARDING_STEPS" :key="step" class="flymind-tour-card" :data-current="progress.step===step">
  <button type="button" class="flymind-tour-card-main" :aria-current="progress.step===step?'step':undefined" :disabled="disabled(step)" @click="activate(step)"><span class="tour-card-top"><span class="tour-card-number">0{{index+1}}</span><span aria-hidden="true">↗</span></span><span class="tour-card-copy"><strong>{{labels[step]}}</strong><span>{{step==='team'&&!cloud?'进入云端，与同伴共享图形。':descriptions[step]}}</span></span></button>
  <div class="tour-card-bottom"><small>{{progress.steps[step]==='completed'?'已完成':progress.steps[step]==='skipped'?'已跳过':''}}</small><button v-if="progress.steps[step]==='pending'" type="button" :disabled="working" :aria-label="'跳过'+labels[step]" @click="$emit('skip',step)">跳过此步</button></div>
 </article></div>
 <div class="flymind-tour-body"><template v-if="ended"><h3>引导已结束</h3><p>已完成 {{completedCount}} 步，已跳过 {{ONBOARDING_STEPS.length-completedCount}} 步。</p></template><template v-else-if="progress.step==='create'"><p>{{readOnly?'当前空间只读，可跳过或切换空间。':'点击卡片打开新建窗口，分组可选。'}}</p></template>
 <template v-else-if="progress.step==='connect'"><p>在 Agent 发起的浏览器页面中本人授权，复制消息不会标记为已完成。</p></template>
 <template v-else-if="progress.step==='alternate'"><p v-if="!hasDiagram">请先创建或选择图形。</p><p v-else-if="readOnly">当前空间只读，请切换到有编辑权限的空间。</p><p v-else>点击卡片回到画布，保存人工修改后再让 Agent 继续。</p><div class="flymind-tour-actions"><button class="studio-text-btn" :disabled="!hasDiagram||readOnly||working" @click="$emit('action','connect')">让 Agent 修改此图</button><button class="studio-text-btn" :disabled="!hasDiagram||!cloud||readOnly||working" @click="$emit('action','verify')">{{working?'检查中…':'检查实际修改记录'}}</button></div><p v-if="!cloud">远程编辑需先显式导入云端空间。</p></template>
 <template v-else><p>{{cloud&&canInvite?'点击卡片打开团队成员，按用户 ID 邀请同伴。':cloud?'点击卡片创建自己的团队。':'点击卡片进入云端空间。'}}</p><button v-if="cloud&&canInvite" class="studio-text-btn" :disabled="working" @click="$emit('action','create-team')">创建另一个团队</button></template>
 <p v-if="message" class="flymind-tour-message" role="status">{{message}}</p></div>
 <footer class="flymind-tour-footer"><button v-if="ended" class="studio-primary" @click="$emit('close')">完成引导</button><button v-else class="studio-text-btn" :disabled="working" @click="$emit('later')">暂时跳过全部</button></footer>
 </section></div></template>
