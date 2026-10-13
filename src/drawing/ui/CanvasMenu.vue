<template>
  <div ref="menu" class="canvas-menu" role="menu" :style="{left:left+'px',top:top+'px'}" @pointerdown.stop @click.stop @keydown="keydown">
    <template v-if="selected">
      <button v-if="!locked&&count===1" role="menuitem" @click="action('edit')">编辑文字<kbd>Enter</kbd></button>
      <button role="menuitem" @click="action('copy')">复制<kbd>Ctrl+C</kbd></button>
      <button v-if="!locked" role="menuitem" @click="action('cut')">剪切<kbd>Ctrl+X</kbd></button>
    </template>
    <button role="menuitem" @click="action('paste')">粘贴<kbd>Ctrl+V</kbd></button>
    <template v-if="selected">
      <button role="menuitem" @click="action('duplicate')">创建副本<kbd>Ctrl+D</kbd></button>
      <hr/>
      <button v-if="!locked&&canGroup" role="menuitem" @click="action('group')">组合<kbd>Ctrl+G</kbd></button>
      <button v-if="!locked&&grouped" role="menuitem" @click="action('ungroup')">取消组合<kbd>Ctrl+Shift+G</kbd></button>
      <button role="menuitem" @click="action(locked?'unlock':'lock')">{{locked?'解锁':'锁定'}}</button>
      <template v-if="!locked">
        <details><summary>图层顺序</summary><button v-for="(label,key) in orderLabels" :key="key" role="menuitem" @click="action(key)">{{label}}</button></details>
        <hr/><button class="danger" role="menuitem" @click="action('delete')">删除<kbd>Delete</kbd></button>
      </template>
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed,ref,onMounted,onUnmounted } from 'vue'
const props=defineProps<{x:number;y:number;selected:boolean;locked:boolean;grouped:boolean;canGroup:boolean;count:number}>()
const emit=defineEmits<{(e:'action',action:string):void;(e:'close'):void}>(),action=(value:string)=>emit('action',value)
const menu=ref<HTMLDivElement>(),height=ref(200)
const left=computed(()=>Math.max(8,Math.min(props.x,window.innerWidth-224))),top=computed(()=>Math.max(8,Math.min(props.y,window.innerHeight-height.value-8)))
const orderLabels={front:'置于顶层',forward:'上移一层',backward:'下移一层',back:'置于底层'}
let observer:ResizeObserver
onMounted(()=>{observer=new ResizeObserver(()=>height.value=menu.value!.offsetHeight);observer.observe(menu.value!);menu.value?.querySelector<HTMLButtonElement>('button')?.focus()})
onUnmounted(()=>observer?.disconnect())
function keydown(e:KeyboardEvent){
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();emit('close');return}
  if(e.key==='Tab'){emit('close');return}
  if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return
  e.preventDefault();e.stopPropagation()
  const items=[...menu.value!.querySelectorAll<HTMLElement>('button,summary')].filter(el=>el.offsetHeight>0),index=items.indexOf(document.activeElement as HTMLElement)
  items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()
}
</script>
