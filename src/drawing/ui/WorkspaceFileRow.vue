<template>
  <div class="workspace-file" :class="{active,renaming:renameValue!==undefined}" :data-diagram-id="document.id" role="listitem" :draggable="!readOnly&&renameValue===undefined" @dragstart="startDrag" @dragend="emit('dragEnd')" @contextmenu.prevent="emit('menu',document.id,$event)" @keydown.f2.prevent="!readOnly&&emit('rename',document.id,document.title)">
    <input v-if="renameValue!==undefined" class="workspace-rename" :value="renameValue" aria-label="修改图形名称" maxlength="160" @input="emit('updateRename',($event.target as HTMLInputElement).value)" @blur="emit('finishRename')" @keydown.enter="emit('finishRename')" @keydown.esc="emit('cancelRename')"/>
    <button v-else class="workspace-file-open" :title="`${document.title}\n创建：${date(document.createdAt)}\n修改：${date(document.updatedAt)}${groupName?'\n分组：'+groupName:''}`" @click="emit('open',document.id)" @dblclick="emit('rename',document.id,document.title)"><span class="workspace-file-name">{{document.title}}<small v-if="document.statusLabel" class="workspace-file-status">{{document.statusLabel}}</small></span><time :datetime="document.createdAt?new Date(document.createdAt).toISOString():undefined" :aria-label="'创建 '+date(document.createdAt)">{{shortDate(document.createdAt)}}</time></button>
    <button class="workspace-row-menu workspace-menu-trigger" :aria-label="`图形操作 ${document.title}`" @click.stop="emit('menu',document.id,$event)"><Icon name="more" :size="16"/></button>
  </div>
</template>
<script setup lang="ts">
import type {SidebarFile} from '../services/sidebar-adapter'
import Icon from './Icon.vue'
const props=defineProps<{document:SidebarFile;active:boolean;renameValue?:string;groupName?:string;readOnly?:boolean}>()
const emit=defineEmits<{(e:'open',id:string):void;(e:'rename',id:string,title:string):void;(e:'menu',id:string,event:MouseEvent):void;(e:'updateRename',value:string):void;(e:'finishRename'):void;(e:'cancelRename'):void;(e:'dragStart'):void;(e:'dragEnd'):void}>()
function startDrag(e:DragEvent){e.dataTransfer?.setData('application/x-flymind-diagram',props.document.id);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';emit('dragStart')}
function date(time?:number){return time?new Date(time).toLocaleString('zh-CN',{hour12:false}):'—'}
function shortDate(time?:number){return time?new Date(time).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}):''}
</script>
<style scoped>
.workspace-file-status{display:block;font-size:10px;font-weight:400;color:#969daa}.workspace-file{position:relative;border-radius:6px;min-height:34px;margin:1px 0}.workspace-file:hover{background:#eceef4}.workspace-file.active{background:#eae8f7;color:#5449b0}.workspace-file-open{width:100%;min-height:34px;display:flex;align-items:center;justify-content:flex-start!important;text-align:left;padding:7px 43px 7px 12px!important;gap:8px!important}.workspace-file-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;line-height:1.55;overflow-wrap:anywhere;font-weight:500}.workspace-file-open time{position:absolute;right:9px;top:11px;font-size:9px;color:#a1a9b6;font-variant-numeric:tabular-nums}.workspace-row-menu{position:absolute;right:4px;top:3px;width:27px;height:28px;padding:0!important;color:#8d96a5;opacity:0;pointer-events:none}.workspace-file:hover .workspace-row-menu,.workspace-row-menu:focus-visible{opacity:1;pointer-events:auto}.workspace-file:hover time,.workspace-file:focus-within time{opacity:0}.workspace-rename{width:100%;min-width:0;border:1px solid #b6a9ec;border-radius:5px;padding:6px 8px;background:#fff;font-size:12px}
</style>
<style scoped>
.workspace-file.renaming{display:flex;align-items:center;min-height:36px;padding:0 4px;box-sizing:border-box}.workspace-file.renaming>.workspace-rename{box-sizing:border-box;width:100%;height:30px;padding:4px 8px;outline:none;border-color:var(--ui-accent,#5b5bd6);box-shadow:0 0 0 2px var(--ui-active,#f0f1fe);color:var(--ui-text,#1c2024);background:var(--ui-input,#fff);font:inherit;font-size:13px;line-height:20px}.workspace-file.renaming>.workspace-row-menu{display:none}
</style>
