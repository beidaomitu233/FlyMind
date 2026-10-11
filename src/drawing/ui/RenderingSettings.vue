<template>
  <template v-if="node">
    <div v-if="studio.selectedNodeIds.length>1" class="studio-action-grid"><button @click="studio.align('left')">左对齐</button><button @click="studio.align('center')">水平居中</button><button @click="studio.align('top')">顶对齐</button><button @click="studio.align('middle')">垂直居中</button><button @click="studio.align('horizontal')">水平等距</button><button @click="studio.align('vertical')">垂直等距</button></div>
    <label class="studio-field">形状<select aria-label="形状" :value="style.shape||preset.shape" @change="nodeStyle('shape',value($event))"><option value="rectangle">矩形</option><option value="rounded">圆角矩形</option><option value="ellipse">椭圆</option><option value="diamond">菱形</option></select></label>
    <div class="studio-number-grid"><label v-for="key in positionFields" :key="key" class="studio-field">{{{x:'X',y:'Y',width:'宽度',height:'高度'}[key]}}<input type="number" :min="key==='width'||key==='height'?32:0" :value="box?.[key]" @change="position(key,Number(value($event)))"/></label></div>
    <div class="studio-colors"><label>填充<input type="color" :value="hex(box?.fill)" @change="nodeStyle('fill',value($event))"/></label><label>边框<input type="color" :value="hex(box?.color)" @change="nodeStyle('stroke',value($event))"/></label><label>文字<input type="color" :value="hex(box?.textColor)" @change="nodeStyle('textColor',value($event))"/></label></div>
    <label class="studio-field">字号<input type="number" min="10" max="48" :value="style.fontSize||preset.fontSize" @change="nodeStyle('fontSize',Number(value($event)))"/></label>
    <template v-if="doc.kind==='dataflow'&&node.kind==='card'">
      <label class="studio-field">卡片形式<select aria-label="卡片形式" :value="card.variant" @change="cardConfig('variant',value($event))"><option value="card">左对齐</option><option value="band">居中横幅</option></select></label>
      <label class="studio-field">图标<select aria-label="图标" :value="card.icon" @change="cardConfig('icon',value($event))"><option value="none">无</option><option value="database">数据库</option><option value="network">网络</option><option value="check">确认</option></select></label>
      <label class="studio-field">配色<select aria-label="配色" :value="card.tone" @change="cardConfig('tone',value($event))"><option value="blue">主题色</option><option value="teal">青绿</option></select></label>
    </template>
    <button class="studio-secondary" @click="resetNode">恢复标准配置</button>
  </template>
  <template v-else-if="edge">
    <label class="studio-field">走线<select aria-label="走线" :value="edgeStyle.route||line.route" @change="edgeConfig('route',value($event))"><option value="orthogonal">垂直折线</option><option value="straight">直线</option><option value="curved">曲线</option></select></label>
    <label class="studio-checkbox"><input type="checkbox" :checked="edgeStyle.dashed??line.dashed" @change="edgeConfig('dashed',($event.target as HTMLInputElement).checked)"/>虚线</label>
    <label class="studio-field">箭头<select aria-label="箭头" :value="edgeStyle.arrow||line.arrow" @change="edgeConfig('arrow',value($event))"><option value="end">单向</option><option value="both">双向</option><option value="none">无</option></select></label>
    <div class="studio-number-grid"><label class="studio-field">颜色<input type="color" :value="hex(sceneEdge?.color)" @change="edgeConfig('color',value($event))"/></label><label class="studio-field">线宽<input type="number" min="1" max="8" :value="edgeStyle.width||line.width" @change="edgeConfig('width',Number(value($event)))"/></label></div>
    <label v-for="endpoint in ['sourcePort','targetPort'] as const" :key="endpoint" class="studio-field">{{endpoint==='sourcePort'?'起点端口':'终点端口'}}<select :value="edgeStyle[endpoint]||''" @change="edgeConfig(endpoint,value($event)||undefined)"><option value="">自动</option><option value="top">上</option><option value="right">右</option><option value="bottom">下</option><option value="left">左</option></select></label>
    <button class="studio-secondary" @click="resetEdge">恢复自动路径</button>
  </template>
  <template v-else-if="group">
    <label class="studio-field">分层配色<select aria-label="分层配色" :value="doc.presentation.groups?.[group.id]?.tone||'blue'" @change="groupConfig('tone',value($event))"><option value="blue">蓝色</option><option value="green">绿色</option><option value="amber">橙色</option></select></label>
    <label class="studio-field">列数<input type="number" min="1" max="10" :value="doc.presentation.groups?.[group.id]?.columns||''" placeholder="自动" @change="groupConfig('columns',value($event)?Number(value($event)):undefined)"/></label>
  </template>
  <details :open="!node&&!edge&&!group" class="studio-details">
    <summary>标准渲染配置</summary>
    <label class="studio-field">主题<div class="studio-themes"><button v-for="(p,name) in palette" :key="name" :style="{background:p.brand}" :class="{selected:doc.presentation.theme===name}" :aria-label="{blue:'蓝色',indigo:'靛蓝',forest:'青绿'}[name]" @click="studio.setTheme(name as ThemeName)"><Icon v-if="doc.presentation.theme===name" name="check" :size="16"/></button></div></label>
    <label v-if="doc.kind==='swimlane'||doc.kind==='flowchart'" class="studio-field">方向<div class="studio-segment"><button :class="{active:doc.presentation.orientation==='vertical'}" @click="studio.setOrientation('vertical')">纵向</button><button :class="{active:doc.presentation.orientation==='horizontal'}" @click="studio.setOrientation('horizontal')">横向</button></div></label>
    <label class="studio-field">节点标准<select aria-label="节点标准" v-model="presetKind"><option v-for="k in nodeKinds" :key="k" :value="k">{{labels[k]}}</option></select></label>
    <label class="studio-field">默认形状<select aria-label="默认形状" :value="standard.shape" @change="standardConfig('shape',value($event))"><option value="rectangle">矩形</option><option value="rounded">圆角矩形</option><option value="ellipse">椭圆</option><option value="diamond">菱形</option></select></label>
    <div class="studio-number-grid"><label v-for="key in ['width','height','fontSize'] as const" :key="key" class="studio-field">{{{width:'默认宽度',height:'默认高度',fontSize:'默认字号'}[key]}}<input type="number" :min="key==='fontSize'?10:32" :max="key==='fontSize'?48:2000" :value="standard[key]" @change="standardConfig(key,Number(value($event)))"/></label></div>
    <div class="studio-colors"><label>填充<input type="color" :value="standard.fill||'#ffffff'" @change="standardConfig('fill',value($event))"/></label><label>边框<input type="color" :value="standard.stroke||palette[doc.presentation.theme].brand" @change="standardConfig('stroke',value($event))"/></label><label>文字<input type="color" :value="standard.textColor||'#32495d'" @change="standardConfig('textColor',value($event))"/></label></div>
    <label class="studio-field">默认走线<select aria-label="默认走线" :value="line.route" @change="lineConfig('route',value($event))"><option value="orthogonal">垂直折线</option><option value="straight">直线</option><option value="curved">曲线</option></select></label>
    <label class="studio-field">默认线宽<input type="number" min="1" max="8" :value="line.width" @change="lineConfig('width',Number(value($event)))"/></label>
    <button class="studio-secondary" @click="resetStandards">恢复标准渲染配置</button>
  </details>
</template>
<script setup lang="ts">
import { computed,ref,watch } from 'vue'
import { useStudio } from '../state/studio'
import { cardStyle,palette,type NodeKind,type ThemeName } from '../core/model'
import { nodePreset,edgePreset } from '../core/render-config'
import Icon from './Icon.vue'
const studio=useStudio(),doc=computed(()=>studio.current),node=computed(()=>studio.selection?.type==='node'?doc.value.nodes.find(n=>n.id===studio.selection!.id):undefined),edge=computed(()=>studio.selection?.type==='edge'?doc.value.edges.find(e=>e.id===studio.selection!.id):undefined),group=computed(()=>studio.selection?.type==='group'?doc.value.groups.find(g=>g.id===studio.selection!.id):undefined)
const box=computed(()=>studio.scene.nodes.find(n=>n.node.id===node.value?.id)),sceneEdge=computed(()=>studio.scene.edges.find(e=>e.edge.id===edge.value?.id)),style=computed(()=>doc.value.presentation.styles?.[node.value?.id||'']||{}),edgeStyle=computed(()=>doc.value.presentation.edges?.[edge.value?.id||'']||{}),preset=computed(()=>nodePreset(doc.value,node.value?.kind||'task')),card=computed(()=>cardStyle(doc.value,node.value?.id||'')),line=computed(()=>edgePreset(doc.value))
const labels:Record<NodeKind,string>={task:'步骤',decision:'判断',start:'开始',end:'结束',module:'模块',topic:'主题',card:'卡片',note:'注释'}
const selectedIds=computed(()=>studio.selectedNodeIds.length?studio.selectedNodeIds:node.value?[node.value.id]:[]),positionFields=computed(()=>selectedIds.value.length>1?['width','height'] as const:['x','y','width','height'] as const)
const nodeKinds=computed<NodeKind[]>(()=>doc.value.kind==='architecture'?['module']:doc.value.kind==='mindmap'?['topic']:doc.value.kind==='dataflow'?['card','note']:['task','decision','start','end']),presetKind=ref<NodeKind>('task'),standard=computed(()=>nodePreset(doc.value,nodeKinds.value.includes(presetKind.value)?presetKind.value:nodeKinds.value[0]))
watch(nodeKinds,k=>{if(!k.includes(presetKind.value))presetKind.value=k[0]},{immediate:true})
const value=(e:Event)=>(e.target as HTMLInputElement).value,hex=(v?:string)=>v?.length===4?'#'+v.slice(1).split('').map(x=>x+x).join(''):v||'#ffffff'
function nodeStyle(key:string,value:unknown){if(node.value)studio.commit(d=>{for(const id of selectedIds.value)(d.presentation.styles??={})[id]={...d.presentation.styles?.[id],[key]:value}})}
function position(key:string,value:number){if(node.value)studio.moveNodes(Object.fromEntries(selectedIds.value.map(id=>[id,{[key]:value}])))}
function cardConfig(key:string,value:unknown){if(node.value)studio.commit(d=>{const id=node.value!.id;(d.presentation.cards??={})[id]={...d.presentation.cards?.[id],[key]:value}})}
function edgeConfig(key:string,value:unknown){if(edge.value)studio.commit(d=>{const id=edge.value!.id,s=(d.presentation.edges??={})[id]??={};Object.assign(s,{[key]:value});if(key==='route'){delete s.points;delete s.sourcePort;delete s.targetPort}})}
function groupConfig(key:string,value:unknown){if(group.value)studio.commit(d=>{const id=group.value!.id;(d.presentation.groups??={})[id]={...d.presentation.groups?.[id],[key]:value}})}
function resetNode(){if(node.value)studio.commit(d=>{for(const id of selectedIds.value){delete d.presentation.positions[id];if(d.presentation.styles)delete d.presentation.styles[id];if(d.presentation.cards)delete d.presentation.cards[id];if(d.presentation.ranks)delete d.presentation.ranks[id]}})}
function resetEdge(){if(edge.value)studio.commit(d=>{const s=d.presentation.edges?.[edge.value!.id];if(s){delete s.points;delete s.sourcePort;delete s.targetPort;delete s.labelPosition}})}
function standardConfig(key:string,value:unknown){const kind=nodeKinds.value.includes(presetKind.value)?presetKind.value:nodeKinds.value[0];studio.commit(d=>{(d.presentation.nodeDefaults??={})[kind]={...d.presentation.nodeDefaults?.[kind],[key]:value}})}
function lineConfig(key:string,value:unknown){studio.commit(d=>{d.presentation.edgeDefaults={...d.presentation.edgeDefaults,[key]:value}})}
function resetStandards(){studio.commit(d=>{delete d.presentation.nodeDefaults;delete d.presentation.edgeDefaults})}
</script>
