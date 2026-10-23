<script setup lang="ts">
defineProps<{readOnly?:boolean;disabled?:boolean}>()
defineEmits<{create:[];connect:[];team:[]}>()
</script>
<template><section class="flymind-welcome" aria-label="开始使用 FlyMind"><div class="flymind-welcome-grid">
 <article class="flymind-welcome-card"><svg class="welcome-art welcome-art-create" viewBox="0 0 200 108" aria-hidden="true"><path d="M43 54h114M100 26v56"/><rect x="18" y="38" width="50" height="32" rx="8"/><rect x="132" y="38" width="50" height="32" rx="8"/><rect x="75" y="12" width="50" height="28" rx="8"/><rect x="75" y="70" width="50" height="28" rx="8"/></svg><h2>创建第一个图形</h2><button class="studio-primary" :disabled="disabled||readOnly" @click="$emit('create')">{{readOnly?'当前空间为只读':'新建图形'}}</button></article>
 <article class="flymind-welcome-card"><svg class="welcome-art welcome-art-connect" viewBox="0 0 200 108" aria-hidden="true"><rect x="25" y="18" width="150" height="72" rx="10"/><path d="m49 43 13 11-13 11M78 65h27M119 45h31M119 57h22M119 69h28"/></svg><h2>安装到 Codex / WorkBuddy</h2><button class="studio-secondary" :disabled="disabled" @click="$emit('connect')">连接 Agent</button></article>
 <article class="flymind-welcome-card"><svg class="welcome-art welcome-art-team" viewBox="0 0 200 108" aria-hidden="true"><path d="M57 70h86M100 33v37"/><circle cx="100" cy="25" r="15"/><circle cx="49" cy="71" r="15"/><circle cx="151" cy="71" r="15"/><path d="M76 104v-9a24 24 0 0 1 48 0v9"/></svg><h2>团队协作</h2><button class="studio-secondary" :disabled="disabled" @click="$emit('team')">打开团队</button></article>
 </div></section></template>
