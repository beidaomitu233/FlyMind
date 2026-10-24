<script setup lang="ts">
import {onMounted,ref} from 'vue';
import {Page} from '@vben/common-ui';
import {ElMessage,ElMessageBox} from 'element-plus';
import {listTeams,teamMembers,setTeamStatus,type TeamRow,type MemberRow} from '#/api/system/flymind';
const rows=ref<TeamRow[]>([]),members=ref<MemberRow[]>([]),loading=ref(false),membersOpen=ref(false),memberTitle=ref('');
async function load(){loading.value=true;try{rows.value=await listTeams()}finally{loading.value=false}}
async function showMembers(row:TeamRow){members.value=await teamMembers(row.id);memberTitle.value=row.name;membersOpen.value=true}
async function change(row:TeamRow){const next=row.status===1?0:1;try{await ElMessageBox.confirm(next?'启用此团队？':'停用后团队成员将失去访问权限，确认停用？','团队状态',{type:'warning'});}catch{return}await setTeamStatus(row.id,next);ElMessage.success('状态已更新');await load()}
onMounted(()=>void load());
</script>
<template><Page title="团队管理"><el-card><div class="mb-4 flex justify-between"><span>FlyMind 团队</span><el-button @click="load">刷新</el-button></div><el-table v-loading="loading" :data="rows"><el-table-column prop="name" label="团队名称"/><el-table-column label="类型"><template #default="{row}">{{row.type==='personal'?'个人空间':'团队'}}</template></el-table-column><el-table-column label="状态"><template #default="{row}"><el-tag :type="row.status===1?'success':'info'">{{row.status===1?'启用':'停用'}}</el-tag></template></el-table-column><el-table-column label="操作"><template #default="{row}"><el-button link @click="showMembers(row)">查看成员</el-button><el-button link @click="change(row)">{{row.status===1?'停用':'启用'}}</el-button></template></el-table-column></el-table></el-card><el-dialog v-model="membersOpen" :title="memberTitle+' · 成员'" width="600px"><el-table :data="members"><el-table-column prop="name" label="姓名"/><el-table-column prop="userCode" label="用户ID"/><el-table-column prop="role" label="角色"/></el-table></el-dialog></Page></template>
