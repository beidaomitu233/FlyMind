<template>
  <div ref="viewport" class="drawing-canvas" :data-diagram-id="document.id" :class="{'hand-tool':tool==='pan'||space,panning:gesture?.type==='pan','connect-tool':tool==='connect'}" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancel" @wheel.prevent="wheel" @dblclick="doubleClick">
    <div class="drawing-world" :style="{transform:`translate(${pan.x}px, ${pan.y}px) scale(${scale})`}">
      <div class="drawing-svg" v-html="svg"/>
      <svg class="drawing-handles" :width="liveScene.width" :height="liveScene.height" :viewBox="`0 0 ${liveScene.width} ${liveScene.height}`">
        <rect v-if="selectedBounds&&selectedNodes.length>1" :x="selectedBounds.x" :y="selectedBounds.y" :width="selectedBounds.width" :height="selectedBounds.height" fill="none" stroke="#7768df" :stroke-width="1/scale" :stroke-dasharray="4/scale+' '+3/scale"/>
        <line v-for="(guide,i) in guides" :key="'guide'+i" data-alignment-guide :x1="guide.axis==='x'?guide.value:guide.from" :y1="guide.axis==='y'?guide.value:guide.from" :x2="guide.axis==='x'?guide.value:guide.to" :y2="guide.axis==='y'?guide.value:guide.to" stroke="#e56ca0" :stroke-width="1/scale" :stroke-dasharray="4/scale+' '+3/scale"/>
        <g v-for="n in selectedNodes" :key="n.node.id">
          <template v-if="selectedNodes.length===1"><rect v-for="h in resizeHandles" :key="h" :data-resize="n.node.id" :data-resize-direction="h" :x="resizeHandlePoint(n,h).x-handleSize/2" :y="resizeHandlePoint(n,h).y-handleSize/2" :width="handleSize" :height="handleSize" fill="white" stroke="#7768df" :stroke-width="1.5/scale" class="resize-handle" :style="{cursor:resizeCursor(h)}"/></template>
          <template v-if="document.kind!=='mindmap'&&selectedNodes.length===1"><circle v-for="port in ports" :key="port" :data-port-node="n.node.id" :data-port="port" :cx="visiblePort(n,port).x" :cy="visiblePort(n,port).y" :r="handleSize/2" fill="white" stroke="#7768df" :stroke-width="1.5/scale" class="port-handle"/></template>
        </g>
        <g v-if="selectedEdge&&document.kind!=='mindmap'">
          <circle v-for="(p,i) in selectedEdge.points" :key="i" :data-edge-handle="selectedEdge.edge.id" :data-index="i" :cx="p.x" :cy="p.y" :r="handleSize/2" :fill="i===0||i===selectedEdge.points!.length-1?'#7768df':'white'" stroke="#7768df" :stroke-width="1.5/scale" class="edge-handle"/>
          <rect v-if="selectedEdge.points?.length===2" :data-edge-handle="selectedEdge.edge.id" data-index="-1" :x="(selectedEdge.points[0].x+selectedEdge.points[1].x)/2-handleSize/2" :y="(selectedEdge.points[0].y+selectedEdge.points[1].y)/2-handleSize/2" :width="handleSize" :height="handleSize" fill="white" stroke="#7768df" :stroke-width="1.5/scale" class="edge-handle"/>
        </g>
        <path v-if="wire" :d="`M ${wire.start.x} ${wire.start.y} L ${wire.end.x} ${wire.end.y}`" fill="none" stroke="#7768df" :stroke-width="2/scale" stroke-dasharray="6 4"/>
        <rect v-if="marquee" :x="marquee.x" :y="marquee.y" :width="marquee.width" :height="marquee.height" fill="#7768df" fill-opacity=".08" stroke="#7768df" :stroke-width="1/scale"/>
      </svg>
      <textarea v-if="editing" ref="inlineField" v-model="editing.text" class="drawing-inline-editor" aria-label="编辑节点文字" :style="{left:editing.box.x+'px',top:editing.box.y+'px',width:editing.box.width+'px',height:Math.max(64,editing.box.height)+'px',fontSize:(document.presentation.styles?.[editing.id]?.fontSize||nodePreset(document,document.nodes.find(n=>n.id===editing!.id)!.kind).fontSize)+'px'}" @pointerdown.stop @dblclick.stop @keydown.stop="editKey" @blur="finishEdit"/>
    </div>
    <div class="canvas-zoom" @pointerdown.stop><button :title="ids.length?'适应所选 · Shift+2':'适应画布 · Shift+1'" :aria-label="ids.length?'适应所选':'适应画布'" @click="ids.length?fitSelection():fit()"><Icon name="fit" :size="16"/></button><i/><button title="缩小" aria-label="缩小" @click="zoom(scale-.1)">−</button><button class="zoom-value" title="恢复 100%" @click="zoom(1)">{{Math.round(scale*100)}}%</button><button title="放大" aria-label="放大" @click="zoom(scale+.1)">＋</button></div>
    <span class="canvas-hint">{{tool==='connect'?'依次选择起点与终点':tool==='pan'||space?'拖动画布 · Ctrl + 滚轮缩放':'框选 / Shift 多选 · 空格拖动画布 · 双击编辑'}}</span>
  </div>
</template>
<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch,nextTick} from 'vue'
import {copy,type DiagramDocument,type DiagramScene,type Point,type Box,type Port,type EdgeStyle} from '../core/model'
import {portPoint,nearestPort} from '../core/geometry'
import {selectionBounds,snapMovement,resizeBox,resizeHandles,resizeHandlePoint,marqueeSelection,type ResizeHandle,type AlignmentGuide} from '../core/canvas-geometry'
import {layoutDocument} from '../core/layout'
import {nodePreset} from '../core/render-config'
import {renderScene} from '../core/render'
import Icon from './Icon.vue'
const props=defineProps<{document:DiagramDocument;scene:DiagramScene;selectedId:string|null;selectedIds?:string[];tool:'select'|'pan'|'connect'}>()
const emit=defineEmits<{(e:'select',type:string,id:string,additive?:boolean):void;(e:'select-many',ids:string[]):void;(e:'clear'):void;(e:'move-many',boxes:Record<string,Partial<Box>>):void;(e:'connect',id:string):void;(e:'wire',source:string,target:string,sourcePort:Port,targetPort:Port):void;(e:'reconnect',id:string,endpoint:'source'|'target',nodeId:string,port:Port):void;(e:'edge-style',id:string,style:EdgeStyle):void;(e:'label',id:string,text:string):void}>()
type Gesture={type:'pan'|'move'|'resize'|'connect'|'reconnect'|'route'|'label'|'marquee';px:number;py:number;origin:Point;moved:boolean;id?:string;ids?:string[];port?:Port;endpoint?:'source'|'target';index?:number;base?:Box;points?:Point[];handle?:ResizeHandle}
const viewport=ref<HTMLDivElement>(),scale=ref(.75),pan=ref({x:50,y:50}),gesture=ref<Gesture|null>(null),positions=ref<Record<string,Partial<Box>>>({}),edgePreview=ref<{id:string;style:EdgeStyle}|null>(null),wire=ref<{start:Point;end:Point}|null>(null),marquee=ref<Box|null>(null),space=ref(false),editing=ref<{id:string;text:string;box:Box}|null>(null),inlineField=ref<HTMLTextAreaElement>()
const guides=ref<AlignmentGuide[]>([])
const ports:Port[]=['top','right','bottom','left'],handleSize=computed(()=>10/scale.value)
let lastPress:{id:string;time:number;point:Point}|undefined
const ids=computed(()=>props.selectedIds?.length?props.selectedIds:props.scene.nodes.some(n=>n.node.id===props.selectedId)?[props.selectedId!]:[])
const liveScene=computed(()=>{if(!Object.keys(positions.value).length&&!edgePreview.value)return props.scene;const d=copy(props.document);for(const [id,p] of Object.entries(positions.value))d.presentation.positions[id]={...d.presentation.positions[id],...p};if(edgePreview.value)(d.presentation.edges??={})[edgePreview.value.id]={...d.presentation.edges?.[edgePreview.value.id],...edgePreview.value.style};return layoutDocument(d)})
const svg=computed(()=>renderScene(liveScene.value,props.document,ids.value.length>1?ids.value:props.selectedId)),selectedNodes=computed(()=>liveScene.value.nodes.filter(n=>ids.value.includes(n.node.id))),selectedEdge=computed(()=>liveScene.value.edges.find(e=>e.edge.id===props.selectedId))
const selectedBounds=computed(()=>selectionBounds(selectedNodes.value))
function resizeCursor(h:ResizeHandle){return ['nw','se'].includes(h)?'nwse-resize':['ne','sw'].includes(h)?'nesw-resize':['n','s'].includes(h)?'ns-resize':'ew-resize'}
function visiblePort(b:Box,port:Port){const p=portPoint(b,port),gap=18/scale.value;return {x:p.x+(port==='left'?-gap:port==='right'?gap:0),y:p.y+(port==='top'?-gap:port==='bottom'?gap:0)}}
function world(e:{clientX:number;clientY:number}):Point{const r=viewport.value!.getBoundingClientRect();return {x:(e.clientX-r.left-pan.value.x)/scale.value,y:(e.clientY-r.top-pan.value.y)/scale.value}}
function zoom(value:number,x?:number,y?:number){const el=viewport.value;if(!el)return;const r=el.getBoundingClientRect(),cx=x??r.width/2,cy=y??r.height/2,prev=scale.value;scale.value=Math.min(3,Math.max(.12,value));pan.value={x:cx-(cx-pan.value.x)*scale.value/prev,y:cy-(cy-pan.value.y)*scale.value/prev}}
function fit(){const el=viewport.value;if(!el)return;const {width,height}=el.getBoundingClientRect();scale.value=Math.min(1.2,Math.max(.12,Math.min((width-96)/props.scene.width,(height-96)/props.scene.height)));pan.value={x:(width-props.scene.width*scale.value)/2,y:(height-props.scene.height*scale.value)/2}}
function fitSelection(){const b=selectionBounds(props.scene.nodes.filter(n=>ids.value.includes(n.node.id))),el=viewport.value;if(!b||!el)return;const {width,height}=el.getBoundingClientRect();scale.value=Math.min(2,Math.max(.12,Math.min((width-120)/b.width,(height-120)/b.height)));pan.value={x:width/2-(b.x+b.width/2)*scale.value,y:height/2-(b.y+b.height/2)*scale.value}}
function down(e:PointerEvent){if(e.button!==0&&e.button!==1||editing.value)return;const t=e.target as Element;if(t.closest('.canvas-zoom'))return;const p=world(e),g:Gesture={type:'marquee',px:e.clientX,py:e.clientY,origin:p,moved:false},node=t.closest('[data-node-id]'),edge=t.closest('[data-edge-id]'),resize=t.closest('[data-resize]'),port=t.closest('[data-port-node]'),edgeHandle=t.closest('[data-edge-handle]'),label=t.closest('[data-label-id]')
  if(props.tool==='pan'||space.value||e.button===1){g.type='pan';g.origin={...pan.value}}
  else if(resize){g.type='resize';g.id=resize.getAttribute('data-resize')!;g.base={...props.scene.nodes.find(n=>n.node.id===g.id)!};g.handle=resize.getAttribute('data-resize-direction') as ResizeHandle}
  else if(port){g.type='connect';g.id=port.getAttribute('data-port-node')!;g.port=port.getAttribute('data-port') as Port;const n=props.scene.nodes.find(n=>n.node.id===g.id)!;wire.value={start:portPoint(n,g.port),end:p}}
  else if(edgeHandle){g.id=edgeHandle.getAttribute('data-edge-handle')!;g.index=Number(edgeHandle.getAttribute('data-index'));g.points=copy(props.scene.edges.find(x=>x.edge.id===g.id)!.points||[]);if(g.index===0||g.index===g.points.length-1){g.type='reconnect';g.endpoint=g.index===0?'source':'target';wire.value={start:g.points[g.index===0?g.points.length-1:0],end:p}}else{g.type='route';if(g.index===-1){g.points.splice(1,0,p);g.index=1}}}
  else if(node){const id=node.getAttribute('data-node-id')!;if(props.tool==='connect'){emit('connect',id);return}const additive=e.shiftKey||e.ctrlKey||e.metaKey;if(!additive&&lastPress?.id===id&&Date.now()-lastPress.time<350&&Math.hypot(p.x-lastPress.point.x,p.y-lastPress.point.y)<8){lastPress=undefined;cancel();beginEdit(id);e.preventDefault();return}lastPress={id,time:Date.now(),point:p};emit('select','node',id,additive);g.type='move';g.ids=additive?(ids.value.includes(id)?ids.value.filter(x=>x!==id):[...ids.value,id]):ids.value.includes(id)?[...ids.value]:[id]}
  else if(label&&props.document.kind!=='mindmap'){g.type='label';g.id=label.getAttribute('data-label-id')!;emit('select','edge',g.id)}
  else if(edge&&props.document.kind!=='mindmap'){emit('select','edge',edge.getAttribute('data-edge-id')!);return}
  else {const c=props.scene.containers.find(c=>c.id===t.closest('[data-container-id]')?.getAttribute('data-container-id'));const header=c&&(c.kind==='layer'||c.kind==='governance'||c.kind==='phase'||c.kind==='lane'&&(c.vertical?p.y<c.y+56:p.x<c.x+120));if(header&&c!.id){emit('select',c!.kind==='layer'||c!.kind==='governance'?'group':c!.kind,c!.id);return}g.ids=e.shiftKey?[...ids.value]:[];if(!e.shiftKey)emit('clear')}
  gesture.value=g;viewport.value?.setPointerCapture(e.pointerId);e.preventDefault()
}
function move(e:PointerEvent){const g=gesture.value;if(!g)return;const dx=e.clientX-g.px,dy=e.clientY-g.py;if(Math.hypot(dx,dy)>3)g.moved=true;const p=world(e),wx=dx/scale.value,wy=dy/scale.value
  if(g.type==='pan')pan.value={x:g.origin.x+dx,y:g.origin.y+dy}
  if(!g.moved)return
  if(g.type==='move'){const boxes=props.scene.nodes.filter(n=>g.ids?.includes(n.node.id)),targets=props.scene.nodes.filter(n=>!g.ids?.includes(n.node.id)),snapped=snapMovement(boxes,targets,{x:wx,y:wy},scale.value,e.altKey);guides.value=snapped.guides;positions.value=Object.fromEntries(boxes.map(b=>[b.node.id,{x:b.x+snapped.delta.x,y:b.y+snapped.delta.y}]))}
  if(g.type==='resize')positions.value={[g.id!]:resizeBox(g.base!,g.handle!,{x:wx,y:wy},e.shiftKey)}
  if(g.type==='connect'||g.type==='reconnect')wire.value={...wire.value!,end:p}
  if(g.type==='route'){const points=copy(g.points!);points[g.index!]=p;edgePreview.value={id:g.id!,style:{points:points.slice(1,-1)}}}
  if(g.type==='label')edgePreview.value={id:g.id!,style:{labelPosition:p}}
  if(g.type==='marquee')marquee.value={x:Math.min(g.origin.x,p.x),y:Math.min(g.origin.y,p.y),width:Math.abs(p.x-g.origin.x),height:Math.abs(p.y-g.origin.y)}
}
function up(e:PointerEvent){const g=gesture.value;if(!g)return;const p=world(e)
  if(g.moved)lastPress=undefined
  if(g.moved&&(g.type==='move'||g.type==='resize'))emit('move-many',positions.value)
  if(g.moved&&(g.type==='route'||g.type==='label')&&edgePreview.value)emit('edge-style',g.id!,edgePreview.value.style)
  if(g.moved&&(g.type==='connect'||g.type==='reconnect')){const target=[...props.scene.nodes].reverse().find(n=>p.x>=n.x-8&&p.x<=n.x+n.width+8&&p.y>=n.y-8&&p.y<=n.y+n.height+8);if(target){const port=nearestPort(target,p);if(g.type==='connect')emit('wire',g.id!,target.node.id,g.port!,port);else emit('reconnect',g.id!,g.endpoint!,target.node.id,port)}}
  if(g.moved&&g.type==='marquee'&&marquee.value){emit('select-many',marqueeSelection(props.scene.nodes,marquee.value,g.ids))}
  cancel();if(viewport.value?.hasPointerCapture(e.pointerId))viewport.value.releasePointerCapture(e.pointerId)
}
function cancel(){guides.value=[];gesture.value=null;positions.value={};edgePreview.value=null;wire.value=null;marquee.value=null}
function wheel(e:WheelEvent){const r=viewport.value!.getBoundingClientRect();if(e.ctrlKey||e.metaKey)zoom(scale.value*Math.exp(-e.deltaY*.002),e.clientX-r.left,e.clientY-r.top);else pan.value={x:pan.value.x-(e.shiftKey?e.deltaY:e.deltaX),y:pan.value.y-(e.shiftKey?0:e.deltaY)}}
function doubleClick(e:MouseEvent){const t=e.target as Element,node=t.closest('[data-node-id]');if(node){beginEdit(node.getAttribute('data-node-id')!);return}const edge=t.closest('[data-edge-id]');if(edge&&props.document.kind!=='mindmap'){const id=edge.getAttribute('data-edge-id')!,s=props.scene.edges.find(e=>e.edge.id===id)!,p=world(e),points=s.points||[];let index=1,best=Infinity;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],len=(b.x-a.x)**2+(b.y-a.y)**2,u=len?Math.max(0,Math.min(1,((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/len)):0,dist=Math.hypot(p.x-a.x-u*(b.x-a.x),p.y-a.y-u*(b.y-a.y));if(dist<best){best=dist;index=i}}const all=copy(points);all.splice(index,0,p);emit('edge-style',id,{points:all.slice(1,-1)});emit('select','edge',id)}}
function beginEdit(id:string){const n=props.scene.nodes.find(n=>n.node.id===id);if(!n)return;emit('select','node',id);editing.value={id,text:n.node.label,box:{x:n.x+8,y:n.y+8,width:n.width-16,height:props.document.kind==='architecture'||props.document.kind==='dataflow'?66:n.height-16}};nextTick(()=>{inlineField.value?.focus();inlineField.value?.select()})}
function finishEdit(){if(!editing.value)return;const {id,text}=editing.value;editing.value=null;if(text.trim())emit('label',id,text.trim())}
function editKey(e:KeyboardEvent){if(e.key==='Escape'){editing.value=null;e.preventDefault()}else if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();finishEdit()}}
function spaceDown(e:KeyboardEvent){if(e.key==='Escape'){cancel();space.value=false;return}if(e.shiftKey&&!(e.target as Element).closest('input,textarea,select,[contenteditable]')){if(e.code==='Digit1'){fit();e.preventDefault()}if(e.code==='Digit2'){fitSelection();e.preventDefault()}}if(e.code==='Space'&&!(e.target as Element).closest('input,textarea,select,[contenteditable]')){space.value=true;e.preventDefault()}}
function spaceUp(e:KeyboardEvent){if(e.code==='Space')space.value=false}
watch(()=>[props.document.id,props.document.presentation.orientation],()=>{editing.value=null;cancel();nextTick(fit)})
let observer:ResizeObserver,viewportSize:{width:number;height:number}|undefined
function releaseSpace(){space.value=false;cancel()}
onMounted(()=>{fit();viewportSize={width:viewport.value!.clientWidth,height:viewport.value!.clientHeight};observer=new ResizeObserver(([entry])=>{const {width,height}=entry.contentRect;if(viewportSize){pan.value={x:pan.value.x+(width-viewportSize.width)/2,y:pan.value.y+(height-viewportSize.height)/2}}viewportSize={width,height}});observer.observe(viewport.value!);window.addEventListener('keydown',spaceDown);window.addEventListener('keyup',spaceUp);window.addEventListener('blur',releaseSpace)})
onUnmounted(()=>{observer?.disconnect();window.removeEventListener('keydown',spaceDown);window.removeEventListener('keyup',spaceUp);window.removeEventListener('blur',releaseSpace)})
defineExpose({fit,fitSelection,zoom,beginEdit})
</script>
