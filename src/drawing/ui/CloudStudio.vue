<script setup lang="ts">
import {computed,nextTick,onMounted,onBeforeUnmount,ref,shallowRef,watch} from 'vue'
import {useRoute,useRouter,onBeforeRouteUpdate,type LocationQueryRaw} from 'vue-router'
import NativeStudio from './NativeStudio.vue'
import Icon from './Icon.vue'
import FlyMindDocumentation from './FlyMindDocumentation.vue'
import {readStudioAppearance} from '../state/studio-appearance'
import {CloudClient,CloudIdentityGuard,cloudAuthorizationRedirect,cloudConsentTeams,cloudDraftDatabase,type CloudConsent,type CloudMe,type CloudTeam,type CloudMember,type CloudRole} from '../services/cloud-client'
import {IndexedDbDraftRepository} from '../services/native-drafts'
import {NativeApiError} from '../services/native-types'
import './cloud-studio.css'
const authApi=new CloudClient();let api=authApi;const identity=shallowRef<CloudIdentityGuard>(),suspended=ref(false),consent=shallowRef<CloudConsent>(),consentTeam=ref(''),now=ref(Date.now());const route=useRoute(),router=useRouter(),me=shallowRef<CloudMe>(),team=shallowRef<CloudTeam>(),studio=ref<InstanceType<typeof NativeStudio>>()
const loading=ref(true),busy=ref(false),error=ref(''),phone=ref(''),password=ref(''),accountOpen=ref(false),membersOpen=ref(false),members=ref<CloudMember[]>([]),invitePhone=ref(''),inviteRole=ref<'admin'|'editor'|'viewer'>('editor'),inviteToken=ref(''),acceptToken=ref(''),teamName=ref('')
const passwordVisible=ref(false),documentationOpen=ref(false),passwordChangeOpen=ref(false),currentPassword=ref(''),newPassword=ref(''),repeatPassword=ref('')
const workspaceOpen=ref(false),createOpen=ref(false),joinOpen=ref(false),accountInfoOpen=ref(false),memberMore=ref(''),dialogElement=ref<HTMLElement>()
const activeDialog=computed(()=>membersOpen.value?'members':createOpen.value?'create':joinOpen.value?'join':accountInfoOpen.value?'account':undefined)
let restoreFocus:HTMLElement|undefined
const roleName=(role:CloudRole)=>({owner:'所有者',admin:'管理员',editor:'编辑者',viewer:'只读成员'}[role])
const initials=(name:string)=>Array.from(name.trim()).slice(0,1).join('').toUpperCase()||'F'
function closeMenus(){workspaceOpen.value=false;accountOpen.value=false;memberMore.value=''}
function closeDialog(){if(busy.value)return;passwordChangeOpen.value=false;currentPassword.value='';newPassword.value='';repeatPassword.value='';membersOpen.value=false;createOpen.value=false;joinOpen.value=false;accountInfoOpen.value=false;inviteToken.value='';invitePhone.value='';acceptToken.value='';teamName.value='';memberMore.value='';error.value=''}
function rememberTrigger(){const active=document.activeElement;restoreFocus=active instanceof Element?active.closest('[data-cloud-menu]')?.querySelector<HTMLElement>('button[aria-haspopup="menu"]')??(active instanceof HTMLElement?active:undefined):undefined}
function openDialog(kind:'create'|'join'|'account'|'password'){rememberTrigger();closeMenus();error.value='';currentPassword.value='';newPassword.value='';repeatPassword.value='';createOpen.value=kind==='create';joinOpen.value=kind==='join';passwordChangeOpen.value=kind==='password';accountInfoOpen.value=kind==='account'||kind==='password'}
function toggleMemberMenu(id:string){const opening=memberMore.value!==id;memberMore.value=opening?id:'';if(opening)void nextTick(()=>document.querySelector<HTMLElement>('.cloud-member-popup button')?.focus())}
function toggleMenu(kind:'workspace'|'account'){const open=kind==='workspace'?!workspaceOpen.value:!accountOpen.value;closeMenus();if(kind==='workspace')workspaceOpen.value=open;else accountOpen.value=open;if(open)void nextTick(()=>document.querySelector<HTMLElement>('.cloud-popup[role="menu"] button')?.focus())}
function outside(event:PointerEvent){if(event.target instanceof Element&&!event.target.closest('[data-cloud-menu]'))closeMenus()}
function keyboard(event:KeyboardEvent){
 if(event.key==='Escape'){if(workspaceOpen.value||accountOpen.value||memberMore.value){const popup=document.querySelector('.cloud-popup[role="menu"]');const trigger=popup?.parentElement?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');closeMenus();trigger?.focus();event.preventDefault();event.stopPropagation()}else if(activeDialog.value){event.preventDefault();event.stopPropagation();closeDialog()}return}
 const menu=document.querySelector<HTMLElement>('.cloud-popup[role="menu"]')
 const container=event.key!=='Tab'&&menu?menu:activeDialog.value?dialogElement.value:menu
 if(!container)return
 const controls=Array.from(container.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')).filter(item=>item.getClientRects().length)
 if(!controls.length)return
 const index=controls.indexOf(document.activeElement as HTMLElement)
 if(event.key==='Tab'&&activeDialog.value){if(event.shiftKey&&index<=0){event.preventDefault();controls.at(-1)?.focus()}else if(!event.shiftKey&&(index===controls.length-1||index<0)){event.preventDefault();controls[0].focus()}}
 else if(menu&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();controls[event.key==='Home'?0:event.key==='End'?controls.length-1:(index+(event.key==='ArrowDown'?1:-1)+controls.length)%controls.length].focus()}
}
watch(activeDialog,async(value,previous)=>{if(value){if(!previous&&!restoreFocus?.isConnected)restoreFocus=document.activeElement instanceof HTMLElement?document.activeElement:undefined;await nextTick();const dialog=dialogElement.value;(dialog?.querySelector<HTMLElement>('input:not(:disabled),select:not(:disabled)')??dialog?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus()}else{await nextTick();if(restoreFocus?.isConnected)restoreFocus.focus();restoreFocus=undefined}})
const context=computed(()=>me.value&&team.value&&identity.value?{key:cloudDraftDatabase(me.value.user.id,team.value.id),repository:new IndexedDbDraftRepository(cloudDraftDatabase(me.value.user.id,team.value.id)),options:{bootstrapSession:false,fetch:identity.value!.fetch(team.value.id)}}:undefined)
const manage=computed(()=>team.value?.role==='owner'||team.value?.role==='admin')
const authorizationId=computed(()=>typeof route.query.authorize==='string'?route.query.authorize:'')
const consentExpired=computed(()=>!consent.value||consent.value.expiresAt<=now.value)
const eligibleTeams=computed(()=>consent.value?cloudConsentTeams(consent.value):[])
let internalNavigation=false,disposed=false
let channel:BroadcastChannel|undefined
function announce(){channel?.postMessage('identity-changed')}
async function loseIdentity(guard:CloudIdentityGuard,cause:Error){
 if(identity.value!==guard||suspended.value)return
 suspended.value=true;currentPassword.value='';newPassword.value='';repeatPassword.value='';passwordChangeOpen.value=false;membersOpen.value=false;createOpen.value=false;joinOpen.value=false;accountInfoOpen.value=false;closeMenus();members.value=[];inviteToken.value='';invitePhone.value='';acceptToken.value='';teamName.value='';consent.value=undefined;error.value=cause.message
 try{await studio.value?.suspendForIdentityChange()}catch(e){error.value+='；本机草稿保存失败：'+(e instanceof Error?e.message:String(e))}
 if(identity.value!==guard||disposed)return
 team.value=undefined;me.value=undefined;identity.value=undefined;api=authApi;suspended.value=false
}
function bind(value:CloudMe){const guard=new CloudIdentityGuard(value.user.id,globalThis.fetch.bind(globalThis),e=>{void loseIdentity(guard,e)});identity.value=guard;api=new CloudClient(guard.fetch());me.value=value}
async function inspectConsent(){consent.value=undefined;if(!authorizationId.value||!identity.value)return;const guard=identity.value,value=await api.inspectAuthorization(authorizationId.value);if(identity.value!==guard||suspended.value)return;consent.value=value;consentTeam.value=eligibleTeams.value[0]?.id??''}
async function decide(approved:boolean){await guarded(async()=>{if(!consent.value||consent.value.expiresAt<=Date.now())throw Error('授权请求已过期，请回到客户端重新发起');if(approved&&!eligibleTeams.value.some(t=>t.id===consentTeam.value))throw Error('请选择有权限的团队');const result=await api.approveAuthorization(authorizationId.value,approved,consentTeam.value);window.location.assign(cloudAuthorizationRedirect(result.redirectUri,window.location.origin))})}
async function recheck(){const guard=identity.value;if(!guard||suspended.value||document.visibilityState==='hidden')return;try{const value=await guard.check(team.value?.id);if(identity.value===guard&&!suspended.value){me.value=value;if(team.value)team.value=value.teams.find(t=>t.id===team.value!.id)}}catch(e){fail(e)}}
const identityTimer=setInterval(()=>{now.value=Date.now();void recheck()},20000)
function visibility(){void recheck()}
onBeforeUnmount(()=>{disposed=true;clearInterval(identityTimer);channel?.close();window.removeEventListener('focus',visibility);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keyboard)})
async function replaceQuery(query:LocationQueryRaw){internalNavigation=true;try{await router.replace({query})}finally{internalNavigation=false}}
function fail(value:unknown){error.value=value instanceof Error?value.message:String(value)}
async function guarded(action:()=>Promise<unknown>){if(busy.value)return;busy.value=true;error.value='';try{await action()}catch(e){fail(e)}finally{busy.value=false}}
async function refreshIdentity(){const guard=identity.value;if(!guard)throw Error('请重新登录');const value=await guard.check(team.value?.id);if(identity.value!==guard||suspended.value)throw Error('登录身份已改变');me.value=value;if(team.value)team.value=value.teams.find(t=>t.id===team.value!.id);return value}
async function selectTeam(id:string){if(id===team.value?.id)return;await guarded(async()=>{const selected=me.value?.teams.find(t=>t.id===id);if(!selected)throw Error('无权访问该团队');if(studio.value&&!await studio.value.prepareLeave())return;team.value=selected;membersOpen.value=false;accountOpen.value=false;const query:LocationQueryRaw={...route.query,team:id};delete query.diagram;await replaceQuery(query)})}
async function login(){await guarded(async()=>{try{await authApi.login(phone.value.trim(),password.value)}finally{password.value='';passwordVisible.value=false}const value=await authApi.me();bind(value);announce();if(authorizationId.value){await inspectConsent();return}const requested=typeof route.query.team==='string'?route.query.team:undefined;team.value=value.teams.find(t=>t.id===requested)??value.teams[0];if(team.value){const query:LocationQueryRaw={...route.query,team:team.value.id};if(requested&&requested!==team.value.id)delete query.diagram;await replaceQuery(query)}})}
async function changePassword(){if(newPassword.value!==repeatPassword.value){error.value='两次输入的新密码不一致';return}if(Array.from(newPassword.value).length<6||!newPassword.value.trim()||new TextEncoder().encode(newPassword.value).length>72){error.value='新密码至少6位，最多72字节，无需混合大小写或符号';return}await guarded(async()=>{if(studio.value&&!await studio.value.prepareLeave())return;const guard=identity.value;const result=await api.changePassword(currentPassword.value,newPassword.value);if(!result.success||!result.reauthenticate)throw Error('密码修改结果未确认，请尝试用新密码重新登录');currentPassword.value='';newPassword.value='';repeatPassword.value='';passwordChangeOpen.value=false;password.value='';announce();if(guard)await loseIdentity(guard,new Error('密码已修改，请用新密码登录；其他设备和MCP需要重新授权'))})}
async function logout(){await guarded(async()=>{if(studio.value&&!await studio.value.prepareLeave())return;await api.logout();announce();team.value=undefined;me.value=undefined;identity.value=undefined;api=authApi;members.value=[];inviteToken.value='';membersOpen.value=false;createOpen.value=false;joinOpen.value=false;accountInfoOpen.value=false;closeMenus();acceptToken.value='';teamName.value='';invitePhone.value='';await replaceQuery({})})}
async function showMembers(){rememberTrigger();closeMenus();await guarded(async()=>{if(!team.value)return;members.value=await api.members(team.value.id);membersOpen.value=true;inviteToken.value=''})}
function canEdit(member:CloudMember){return member.userId!==me.value?.user.id&&manage.value&&member.role!=='owner'&&(team.value?.role==='owner'||member.role!=='admin')}
async function changeRole(member:CloudMember,event:Event){const input=event.target as HTMLSelectElement,next=input.value as Exclude<CloudRole,'owner'>;input.value=member.role;await guarded(async()=>{await api.role(team.value!.id,member.userId,next);members.value=await api.members(team.value!.id)})}
async function removeMember(member:CloudMember){memberMore.value='';if(!confirm('移除此团队成员？'))return;await guarded(async()=>{await api.remove(team.value!.id,member.userId);members.value=await api.members(team.value!.id)})}
async function transfer(member:CloudMember){memberMore.value='';if(!confirm('将团队所有权转交给此成员？'))return;await guarded(async()=>{await api.transfer(team.value!.id,member.userId);await refreshIdentity();members.value=await api.members(team.value!.id)})}
async function invite(){await guarded(async()=>{const value=await api.invite(team.value!.id,invitePhone.value.trim(),inviteRole.value);inviteToken.value=value.inviteToken;invitePhone.value=''})}
async function accept(){await guarded(async()=>{if(studio.value&&!await studio.value.prepareLeave())return;const value=await api.accept(acceptToken.value.trim());await refreshIdentity();team.value=value;await replaceQuery({team:value.id});acceptToken.value='';joinOpen.value=false;closeMenus()})}
async function createTeam(){await guarded(async()=>{if(studio.value&&!await studio.value.prepareLeave())return;const value=await api.createTeam(teamName.value.trim());await refreshIdentity();team.value=value;await replaceQuery({team:value.id});teamName.value='';createOpen.value=false;closeMenus()})}
async function leaveTeam(){if(!confirm('退出当前团队？'))return;await guarded(async()=>{if(studio.value&&!await studio.value.prepareLeave())return;await api.leave(team.value!.id);team.value=undefined;membersOpen.value=false;const value=await refreshIdentity();team.value=value.teams[0];await replaceQuery(team.value?{team:team.value.id}:{})})}
onBeforeRouteUpdate(async(to,from)=>{if(!me.value||to.query.team===from.query.team&&to.query.authorize===from.query.authorize||internalNavigation)return true;if(busy.value)return false;return studio.value?studio.value.prepareLeave():true})
watch(()=>route.query.team,id=>{if(!me.value||id===team.value?.id)return;const selected=me.value.teams.find(t=>t.id===id);if(selected)team.value=selected;else if(id){team.value=undefined;error.value='当前账号无权访问该团队'}})
watch(authorizationId,()=>{if(identity.value)void guarded(inspectConsent)})
onMounted(async()=>{
 if(typeof BroadcastChannel!=='undefined'){channel=new BroadcastChannel('flymind-cloud-auth-v1');channel.onmessage=()=>{if(identity.value)identity.value.invalidate('其他页面已更换登录状态，请重新登录')}}
 window.addEventListener('focus',visibility);document.addEventListener('visibilitychange',visibility)
 document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keyboard)
 try{const value=await authApi.me();bind(value);if(authorizationId.value){await inspectConsent();return}const requested=typeof route.query.team==='string'?route.query.team:undefined;team.value=value.teams.find(t=>t.id===requested)??(!requested?value.teams[0]:undefined);if(requested&&!team.value)error.value='当前账号无权访问该团队';if(team.value&&requested!==team.value.id)await replaceQuery({team:team.value.id})}catch(e){if(!(e instanceof NativeApiError&&e.status===401))fail(e)}finally{loading.value=false}
})
</script>
<template>
<div class="cloud-studio" :data-appearance="readStudioAppearance()">
 <div v-if="loading" class="cloud-login cloud-ui" role="status">读取中</div>
 <main v-else-if="!me" class="cloud-auth cloud-ui">
  <section class="cloud-auth-art" aria-hidden="true">
   <div class="cloud-auth-art-inner">
    <svg class="cloud-auth-illustration" viewBox="0 0 520 360" fill="none">
     <path class="cloud-auth-guide" d="M40 80H480M40 180H480M40 280H480M100 30V330M260 30V330M420 30V330"/>
     <path class="cloud-auth-link" d="M158 178H224Q236 178 236 166V106Q236 94 248 94H320M236 166V250Q236 262 248 262H320"/>
     <circle cx="236" cy="178" r="5" class="cloud-auth-junction"/>
     <rect class="cloud-auth-node" x="58" y="142" width="108" height="72" rx="16"/>
     <rect class="cloud-auth-node" x="320" y="58" width="142" height="72" rx="16"/>
     <rect class="cloud-auth-node" x="320" y="226" width="142" height="72" rx="16"/>
     <g class="cloud-auth-node-icon" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M101 166H123M101 178H123M101 190H115"/><path d="M379 82H389V92H379ZM395 96H405V106H395ZM389 87H400V96"/><path d="M378 250L388 260L406 242"/></g>
     <circle cx="320" cy="94" r="4" class="cloud-auth-junction"/><circle cx="320" cy="262" r="4" class="cloud-auth-junction"/>
    </svg>
    <h2>让思路，清晰可见。</h2><p>从一个想法，连接成一张图。</p>
   </div>
  </section>
  <section class="cloud-auth-entry">
   <form class="cloud-auth-form" :aria-busy="busy" @submit.prevent="login">
    <div class="cloud-auth-brand"><span class="cloud-auth-mark"><Icon name="mindmap" :size="23"/></span><span>FlyMind</span></div>
    <header class="cloud-auth-heading"><h1>欢迎回来</h1><p>登录，继续你的绘图与团队协作。</p></header>
    <label for="cloud-login-phone">手机号<input id="cloud-login-phone" v-model="phone" type="tel" inputmode="tel" autocomplete="username" placeholder="输入手机号" required maxlength="32" :disabled="busy"></label>
    <label for="cloud-login-password">密码<span class="cloud-auth-password"><input id="cloud-login-password" aria-label="密码" v-model="password" :type="passwordVisible?'text':'password'" autocomplete="current-password" placeholder="输入密码" required maxlength="200" :disabled="busy" :aria-invalid="error?true:undefined" :aria-describedby="error?'cloud-login-error':undefined"><button type="button" class="cloud-auth-visibility" :aria-label="passwordVisible?'隐藏密码':'显示密码'" :aria-pressed="passwordVisible" :disabled="busy" @click="passwordVisible=!passwordVisible"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path v-if="passwordVisible" d="M3 3 21 21"/></svg></button></span></label>
    <div class="cloud-auth-feedback" aria-live="polite"><p id="cloud-login-error" class="cloud-form-error">{{error}}</p></div>
    <button class="cloud-primary cloud-auth-submit" :disabled="busy"><span v-if="busy" class="cloud-auth-spinner" aria-hidden="true"/>{{busy?'正在登录…':'登录'}}</button>
   </form>
  </section>
 </main>
 <section v-else-if="authorizationId" class="cloud-login cloud-consent cloud-ui" aria-label="MCP授权">
  <h1>授权 FlyMind</h1><template v-if="consent"><p><strong>{{consent.client.name}}</strong> 请求访问您的团队</p><ul><li v-for="scope in consent.scopes" :key="scope">{{scope==='flymind:write'?'创建和修改图形':scope==='flymind:read'?'读取团队图形':scope}}</li></ul><label>授权团队<select v-model="consentTeam" :disabled="busy||consentExpired"><option v-for="item in eligibleTeams" :key="item.id" :value="item.id">{{item.name}}</option></select></label><p v-if="consentExpired" class="cloud-form-error" role="alert">请求已过期，请回到客户端重新发起</p><div class="cloud-consent-actions"><button :disabled="busy||consentExpired" @click="decide(false)">拒绝</button><button class="cloud-primary" :disabled="busy||consentExpired||!consentTeam" @click="decide(true)">授权</button></div></template><p v-if="error" class="cloud-form-error" role="alert">{{error}}</p><button :disabled="busy" @click="logout">退出登录</button>
 </section>
 <NativeStudio v-else-if="team&&context" :style="suspended?{visibility:'hidden'}:undefined" :key="context.key" ref="studio" :api-base="'/cloud-api/teams/'+encodeURIComponent(team.id)" :client-options="context.options" :draft-repository="context.repository" :interaction-locked="busy||suspended" :collaboration-user-id="me.user.id" :read-only="team.role==='viewer'">
  <template #workspace>
   <div class="cloud-workspace cloud-ui" data-cloud-menu @click.stop>
    <button class="cloud-workspace-trigger" aria-label="切换空间" aria-haspopup="menu" :aria-expanded="workspaceOpen" :disabled="busy" @click.stop="toggleMenu('workspace')"><span class="cloud-space-symbol"><Icon name="folder" :size="16"/></span><span class="cloud-truncate">{{team.name}}</span><Icon name="chevron" :size="14"/></button>
    <div v-if="workspaceOpen" class="cloud-popup" role="menu" aria-label="空间">
     <div class="cloud-menu-label">空间</div><button v-for="item in me.teams" :key="item.id" role="menuitemradio" :aria-checked="item.id===team.id" :disabled="busy" @click="closeMenus();selectTeam(item.id)"><span class="cloud-truncate">{{item.name}}</span><Icon v-if="item.id===team.id" name="check" :size="15"/></button>
     <div class="cloud-menu-divider"/><button role="menuitem" @click="openDialog('create')"><Icon name="plus" :size="15"/>创建团队</button><button role="menuitem" @click="openDialog('join')"><Icon name="connect" :size="15"/>加入团队</button><button role="menuitem" @click="showMembers"><Icon name="group" :size="15"/>团队成员</button>
    </div>
   </div>
  </template>
  <template #sidebar-footer>
   <div class="cloud-account cloud-ui" data-cloud-menu @click.stop>
    <button class="cloud-account-trigger" aria-haspopup="menu" :aria-expanded="accountOpen" :disabled="busy" @click.stop="toggleMenu('account')"><span class="cloud-avatar">{{initials(me.user.name)}}</span><span class="cloud-truncate">{{me.user.name}}</span><Icon name="chevron" :size="14"/></button>
    <div v-if="accountOpen" class="cloud-popup cloud-account-popup" role="menu" aria-label="账号"><button role="menuitem" @click="openDialog('account')">账号信息</button><button role="menuitem" @click="openDialog('password')">修改密码</button><button role="menuitem" :disabled="busy" @click="closeMenus();logout()">退出登录</button></div>
   </div>
  </template>
 </NativeStudio>
 <div v-else class="cloud-login cloud-ui"><h1>FlyMind</h1><p>{{error||'暂无可用团队'}}</p><button :disabled="busy" @click="openDialog('create')">创建团队</button><button :disabled="busy" @click="openDialog('join')">加入团队</button><button :disabled="busy" @click="logout">退出登录</button></div>
 <button v-if="!me||!context||authorizationId" class="cloud-documentation-button" type="button" aria-label="文档" title="文档" @click="documentationOpen=true"><Icon name="book"/></button>
 <FlyMindDocumentation :open="documentationOpen" :appearance="readStudioAppearance()" @close="documentationOpen=false" />
 <div v-if="me&&error&&team&&!activeDialog" class="cloud-error cloud-ui" role="alert">{{error}}<button aria-label="关闭提示" @click="error=''"><Icon name="close" :size="14"/></button></div>
 <div v-if="me&&activeDialog" class="cloud-overlay cloud-ui" @click.self="closeDialog">
  <section ref="dialogElement" class="cloud-dialog" :class="{'cloud-members-dialog':membersOpen}" role="dialog" aria-modal="true" aria-labelledby="cloud-dialog-title">
   <header class="cloud-dialog-heading"><h2 id="cloud-dialog-title">{{membersOpen?'团队成员':createOpen?'创建团队':joinOpen?'加入团队':passwordChangeOpen?'修改密码':'账号信息'}}</h2><button class="cloud-icon-button" aria-label="关闭" :disabled="busy" @click="closeDialog"><Icon name="close" :size="17"/></button></header>
   <template v-if="membersOpen&&team">
    <div class="cloud-section-heading"><span class="cloud-truncate">{{team.name}}</span><span>{{members.length}} 位成员</span></div>
    <div class="cloud-member-list">
     <div v-for="member in members" :key="member.userId" class="cloud-member">
      <span class="cloud-avatar">{{initials(member.name)}}</span><div class="cloud-member-identity"><span class="cloud-truncate">{{member.name}}</span><span v-if="member.userId===me.user.id" class="cloud-muted">你</span></div>
      <select v-if="canEdit(member)" :value="member.role" :disabled="busy" :aria-label="member.name+'的角色'" @change="changeRole(member,$event)"><option v-if="team.role==='owner'||member.role==='admin'" value="admin">管理员</option><option value="editor">编辑者</option><option value="viewer">只读成员</option></select><span v-else class="cloud-role">{{roleName(member.role)}}</span>
      <div v-if="canEdit(member)||team.role==='owner'&&member.role!=='owner'" class="cloud-member-actions" data-cloud-menu><button class="cloud-icon-button" :aria-label="member.name+'的更多操作'" aria-haspopup="menu" :aria-expanded="memberMore===member.userId" :disabled="busy" @click="toggleMemberMenu(member.userId)"><Icon name="more" :size="18"/></button><div v-if="memberMore===member.userId" class="cloud-popup cloud-member-popup" role="menu"><button v-if="team.role==='owner'&&member.role!=='owner'" role="menuitem" @click="transfer(member)">转交所有权</button><button v-if="canEdit(member)" class="cloud-danger" role="menuitem" @click="removeMember(member)">移除成员</button></div></div><span v-else class="cloud-action-placeholder"/>
     </div>
    </div>
    <section v-if="manage" class="cloud-invite-section"><h3>邀请成员</h3><form class="cloud-invite-form" @submit.prevent="invite"><input v-model="invitePhone" placeholder="已有账号手机号" aria-label="邀请手机号" required maxlength="32" :disabled="busy"><select v-model="inviteRole" aria-label="邀请角色" :disabled="busy"><option value="editor">编辑者</option><option value="viewer">只读成员</option><option v-if="team.role==='owner'" value="admin">管理员</option></select><button class="cloud-primary" :disabled="busy||!invitePhone.trim()">邀请</button></form><label v-if="inviteToken" class="cloud-invite-result">邀请令牌<input :value="inviteToken" readonly aria-label="复制邀请令牌" @focus="($event.target as HTMLInputElement).select()"></label></section>
    <footer v-if="team.role!=='owner'" class="cloud-dialog-footer"><button class="cloud-danger" :disabled="busy" @click="leaveTeam">退出团队</button></footer>
   </template>
   <form v-else-if="createOpen" class="cloud-dialog-form" @submit.prevent="createTeam"><label>团队名称<input v-model="teamName" required maxlength="80" :disabled="busy" autocomplete="off"></label><div class="cloud-dialog-footer"><button type="button" :disabled="busy" @click="closeDialog">取消</button><button class="cloud-primary" :disabled="busy||!teamName.trim()">创建团队</button></div></form>
   <form v-else-if="joinOpen" class="cloud-dialog-form" @submit.prevent="accept"><label>邀请令牌<input v-model="acceptToken" required :disabled="busy" autocomplete="off"></label><div class="cloud-dialog-footer"><button type="button" :disabled="busy" @click="closeDialog">取消</button><button class="cloud-primary" :disabled="busy||!acceptToken.trim()">加入团队</button></div></form>
   <form v-else-if="passwordChangeOpen" class="cloud-dialog-form" @submit.prevent="changePassword"><label>当前密码<input v-model="currentPassword" type="password" autocomplete="current-password" required :disabled="busy"></label><label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" required minlength="6" maxlength="72" :disabled="busy" placeholder="至少6位，无需大小写或符号组合"></label><label>确认新密码<input v-model="repeatPassword" type="password" autocomplete="new-password" required :disabled="busy"></label><p class="cloud-muted">仅修改前台密码。修改后需重新登录，并重新授权本地设备和MCP。</p><div class="cloud-dialog-footer"><button type="button" :disabled="busy" @click="closeDialog">取消</button><button class="cloud-primary" :disabled="busy||!currentPassword||!newPassword||!repeatPassword">保存密码</button></div></form>
   <div v-else class="cloud-account-info"><span class="cloud-avatar">{{initials(me.user.name)}}</span><strong>{{me.user.name}}</strong><span class="cloud-muted">账号 {{me.user.id}}</span></div>
   <p v-if="error" class="cloud-form-error" role="alert">{{error}}</p>
  </section>
 </div>
</div>
</template>
