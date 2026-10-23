<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref,shallowRef,computed} from 'vue'
import {onBeforeRouteLeave,useRoute} from 'vue-router'
import NativeStudio from './NativeStudio.vue'
import Icon from './Icon.vue'
import FlyMindDocumentation from './FlyMindDocumentation.vue'
import {readStudioAppearance} from '../state/studio-appearance'
import {IndexedDbDraftRepository} from '../services/native-drafts'
type Principal={user:{id:string;name:string};team:{id:string;name:string;role:string};session:{id:string}}
type Status={loginRequired:boolean;provider:string;dataRootId:string;principal?:Principal}
const documentationOpen=ref(false)
const route=useRoute(),status=shallowRef<Status>(),studio=ref<InstanceType<typeof NativeStudio>>(),busy=ref(true),error=ref(''),phone=ref(''),password=ref(''),selection=ref(''),team=ref(''),teams=ref<Array<{id:string;name:string}>>([])
let disposed=false,timer:ReturnType<typeof setInterval>|undefined,losing:Promise<void>|undefined
const authorized=computed(()=>status.value?.loginRequired===false&&!!status.value.principal)
const repository=computed(()=>{const s=status.value;if(!s?.principal)return undefined;return new IndexedDbDraftRepository('flymind-local-'+[s.dataRootId,s.principal.user.id,s.principal.team.id].map(encodeURIComponent).join(':'))})
async function api(path:string,body?:unknown){const r=await fetch('/studio-api/local-auth'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(data.error??'授权请求未完成');return data}
async function hide(message:string){if(losing)return losing;losing=(async()=>{error.value=message;const old=studio.value;status.value=status.value?{...status.value,loginRequired:true,principal:undefined}:undefined;try{await old?.suspendForIdentityChange()}catch{error.value+='；本机恢复数据未确认，请保留此页面'}finally{losing=undefined}})();return losing}
const guardedFetch:typeof fetch=async(input,init)=>{const response=await globalThis.fetch(input,init);if(response.status===401||response.status===403){void hide('登录或权限已失效，请重新登录')}return response}
const options={fetch:guardedFetch}
async function check(){try{const next=await api('/status') as Status;if(disposed)return;const before=status.value;if(authorized.value&&(next.loginRequired||next.principal?.user.id!==before?.principal?.user.id||next.principal?.team.id!==before?.principal?.team.id)){await hide('本地授权已失效');return}status.value=next}catch(e){if(authorized.value)await hide('暂时无法确认账号授权，已停止访问');else error.value=e instanceof Error?e.message:String(e)}}
async function login(){busy.value=true;error.value='';try{const result=selection.value?await api('/device-grant',{selectionId:selection.value,teamId:team.value}):await api('/login',{phone:phone.value,password:password.value});password.value='';if(result.selectionRequired){selection.value=result.selectionId;teams.value=result.teams;team.value=result.teams[0]?.id??''}else{selection.value='';teams.value=[];await check()}}catch(e){password.value='';error.value=e instanceof Error?e.message:String(e)}finally{busy.value=false}}
async function logout(){if(studio.value&&!await studio.value.prepareLeave())return;busy.value=true;try{await api('/logout',{});await hide('');selection.value='';teams.value=[];await check()}catch(e){await hide(e instanceof Error?e.message:String(e))}finally{busy.value=false}}
onMounted(async()=>{await check();busy.value=false;if(route.query.authorization==='logout'&&authorized.value)await logout();timer=setInterval(()=>{if(document.visibilityState==='visible'&&!busy.value)void check()},15000)})
onBeforeUnmount(()=>{disposed=true;if(timer)clearInterval(timer)})
onBeforeRouteLeave(async()=>!authorized.value||await studio.value?.prepareLeave()===true)
</script>

<template>
  <div v-if="authorized" class="local-authorized">
    <button class="local-account" type="button" :disabled="busy" @click="logout">{{ status?.principal?.user.name }} · 退出</button>
    <NativeStudio ref="studio" :key="status!.principal!.session.id" :draft-repository="repository" :client-options="options" :read-only="status?.principal?.team.role==='viewer'" />
  </div>
  <main v-else class="local-authorization">
    <button class="local-documentation-button" type="button" aria-label="文档" title="文档" @click="documentationOpen=true"><Icon name="book"/></button>
    <form @submit.prevent="login">
      <h1>登录 FlyMind</h1>
      <p v-if="status">{{ status.provider }}</p>
      <template v-if="!selection"><label>手机号<input v-model="phone" type="tel" autocomplete="username" required :disabled="busy"></label><label>密码<input v-model="password" type="password" autocomplete="current-password" required :disabled="busy"></label></template>
      <label v-else>团队<select v-model="team" :disabled="busy"><option v-for="item in teams" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
      <p v-if="error" role="alert">{{ error }}</p>
      <button :disabled="busy||!status||!!selection&&!team">{{ busy?'正在确认…':selection?'授权本地工作区':'登录' }}</button>
    </form>
  </main>
  <FlyMindDocumentation :open="documentationOpen" :appearance="readStudioAppearance()" @close="documentationOpen=false" />
</template>

<style scoped>
.local-authorization .local-documentation-button{position:fixed;top:24px;right:24px;width:36px;height:36px;padding:0;display:grid;place-items:center;border:1px solid #dddde5;border-radius:8px;background:#fff;color:#666;cursor:pointer}.local-documentation-button:focus-visible{outline:2px solid #7567e8;outline-offset:3px}
.local-authorized{height:100vh}.local-account{position:fixed;right:70px;top:9px;z-index:90;border:1px solid #d9d9e2;border-radius:6px;padding:5px 9px;background:#fff;color:#333;font-size:12px}.local-authorization{min-height:100vh;display:grid;place-items:center;background:#f5f6fa;color:#292932;font:14px system-ui}.local-authorization form{width:300px;display:grid;gap:16px}.local-authorization h1{font-size:22px;margin:0}.local-authorization p{margin:0}.local-authorization label{display:grid;gap:7px}.local-authorization input,.local-authorization select,.local-authorization button{padding:10px;border:1px solid #d4d4df;border-radius:6px;font:inherit}.local-authorization button{background:#7567e8;color:white;cursor:pointer}.local-authorization [role=alert]{color:#ad3030}
</style>
