<template>
  <div ref="viewport" class="drawing-canvas" :class="{panning:gesture?.type==='pan', 'hand-tool':tool==='pan', 'connect-tool':tool==='connect'}" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @wheel.prevent="wheel" @dblclick="doubleClick">
    <div class="drawing-world" :style="{transform:`translate(${pan.x}px, ${pan.y}px) scale(${scale})`}" v-html="svg"/>
    <div class="canvas-zoom" @pointerdown.stop>
      <button title="适应画布" aria-label="适应画布" @click="fit"><Icon name="fit" :size="16"/></button><i/>
      <button title="缩小" aria-label="缩小" @click="zoom(scale-.1)">−</button>
      <button class="zoom-value" title="恢复 100%" @click="zoom(1)">{{Math.round(scale*100)}}%</button>
      <button title="放大" aria-label="放大" @click="zoom(scale+.1)">＋</button>
    </div>
    <span class="canvas-hint">{{tool==='connect'?'依次选择起点与终点':tool==='pan'?'拖动画布 · Ctrl + 滚轮缩放':'双击节点编辑 · 拖拽调整位置'}}</span>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import type { DiagramDocument, DiagramScene } from '../core/model'
import { copy } from '../core/model'
import { layoutDocument } from '../core/layout'
import { renderScene } from '../core/render'
import Icon from './Icon.vue'
const props=defineProps<{document:DiagramDocument;scene:DiagramScene;selectedId:string|null;tool:'select'|'pan'|'connect'}>()
const emit=defineEmits<{(e:'select',type:string,id:string):void;(e:'clear'):void;(e:'move',id:string,x:number,y:number):void;(e:'connect',id:string):void;(e:'edit',id:string):void}>()
const viewport=ref<HTMLDivElement>(),scale=ref(.75),pan=ref({x:50,y:50}),drag=ref<{id:string;x:number;y:number}|null>(null)
const gesture=ref<{type:'pan'|'node';id?:string;px:number;py:number;x:number;y:number;moved:boolean}|null>(null)
const liveScene=computed(()=>{if(!drag.value)return props.scene;const d=copy(props.document);d.presentation.positions[drag.value.id]={...d.presentation.positions[drag.value.id],x:drag.value.x,y:drag.value.y};return layoutDocument(d)})
const svg=computed(()=>renderScene(liveScene.value,props.document,props.selectedId))
function zoom(value:number,x?:number,y?:number){const el=viewport.value;if(!el)return;const rect=el.getBoundingClientRect(),cx=x??rect.width/2,cy=y??rect.height/2,previous=scale.value;scale.value=Math.min(3,Math.max(.12,value));pan.value={x:cx-(cx-pan.value.x)*scale.value/previous,y:cy-(cy-pan.value.y)*scale.value/previous}}
function fit(){const el=viewport.value;if(!el)return;const {width,height}=el.getBoundingClientRect();scale.value=Math.min(1.2,Math.max(.12,Math.min((width-96)/props.scene.width,(height-96)/props.scene.height)));pan.value={x:(width-props.scene.width*scale.value)/2,y:(height-props.scene.height*scale.value)/2}}
function down(e:PointerEvent){if(e.button!==0&&e.button!==1)return;const target=e.target as Element,node=target.closest('[data-node-id]'),edge=target.closest('[data-edge-id]'),container=target.closest('[data-container-id]');if(target.closest('.canvas-zoom'))return
  if(props.tool==='connect'&&node){emit('connect',node.getAttribute('data-node-id')!);return}
  if(node&&props.tool!=='pan'&&e.button!==1){const id=node.getAttribute('data-node-id')!,box=props.scene.nodes.find(n=>n.node.id===id)!;emit('select','node',id);gesture.value={type:'node',id,px:e.clientX,py:e.clientY,x:box.x,y:box.y,moved:false}}
  else if(edge&&props.tool!=='pan'){emit('select','edge',edge.getAttribute('data-edge-id')!);return}
  else {if(container&&props.tool!=='pan'){const c=props.scene.containers.find(c=>c.id===container.getAttribute('data-container-id'));if(c&&c.kind!=='title'&&c.id)emit('select',c.kind==='layer'||c.kind==='governance'?'group':c.kind,c.id)}else if(props.tool!=='pan')emit('clear');gesture.value={type:'pan',px:e.clientX,py:e.clientY,x:pan.value.x,y:pan.value.y,moved:false}}
  viewport.value?.setPointerCapture(e.pointerId);e.preventDefault()
}
function move(e:PointerEvent){const g=gesture.value;if(!g)return;const dx=e.clientX-g.px,dy=e.clientY-g.py;if(Math.hypot(dx,dy)>3)g.moved=true;if(g.type==='pan')pan.value={x:g.x+dx,y:g.y+dy};else if(g.moved)drag.value={id:g.id!,x:Math.max(16,g.x+dx/scale.value),y:Math.max(16,g.y+dy/scale.value)}}
function up(e:PointerEvent){if(gesture.value?.type==='node'&&gesture.value.moved&&drag.value)emit('move',drag.value.id,drag.value.x,drag.value.y);gesture.value=null;drag.value=null;if(viewport.value?.hasPointerCapture(e.pointerId))viewport.value.releasePointerCapture(e.pointerId)}
function cancel(){gesture.value=null;drag.value=null}
function wheel(e:WheelEvent){const rect=viewport.value!.getBoundingClientRect();if(e.ctrlKey||e.metaKey)zoom(scale.value*Math.exp(-e.deltaY*.002),e.clientX-rect.left,e.clientY-rect.top);else pan.value={x:pan.value.x-(e.shiftKey?e.deltaY:e.deltaX),y:pan.value.y-(e.shiftKey?0:e.deltaY)}}
function doubleClick(e:MouseEvent){const node=(e.target as Element).closest('[data-node-id]');if(node)emit('edit',node.getAttribute('data-node-id')!)}
watch(()=>[props.document.id,props.document.presentation.orientation],()=>nextTick(fit))
let observer:ResizeObserver
onMounted(()=>{fit();observer=new ResizeObserver(()=>{if(!gesture.value)fit()});observer.observe(viewport.value!)})
onUnmounted(()=>observer?.disconnect())
defineExpose({fit,zoom})
</script>
