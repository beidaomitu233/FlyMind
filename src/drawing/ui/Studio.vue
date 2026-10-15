<template>
  <div class="studio-root" @pointerdown="context=null" @click="exportOpen=false">
    <aside class="studio-sidebar">
      <div class="studio-brand"><span class="studio-logo"><Icon name="mindmap" :size="23"/></span><b>FlyMind</b><span>Studio</span></div>
      <button class="studio-new" @click="newOpen=true"><Icon name="plus"/>新建图形</button>
      <div class="studio-side-label">我的图形 <button class="studio-icon" title="搜索图形" @click="searchOpen=!searchOpen"><Icon name="search" :size="15"/></button></div>
      <input v-if="searchOpen" v-model="search" class="studio-search" placeholder="搜索图形" aria-label="搜索图形"/>
      <div class="studio-files">
        <div v-for="d in files" :key="d.id" class="studio-file" :class="{active:d.id===studio.activeId}">
          <button class="studio-file-open" @click="studio.open(d.id)"><span class="studio-file-icon"><Icon :name="d.kind" :size="19"/></span><span><strong>{{d.title}}</strong><small>{{kindLabels[d.kind]}}</small></span></button>
          <button class="studio-file-delete studio-icon" title="删除图形" @click="removeFile(d.id)"><Icon name="trash" :size="14"/></button>
        </div>
        <p v-if="!files.length" class="studio-no-files">没有匹配的图形</p>
      </div>
      <div class="studio-side-bottom"><button @click="openImport"><Icon name="import" :size="17"/>导入图形</button><button @click="helpOpen=true"><Icon name="code" :size="17"/>AI 绘图说明</button><span><i/>{{studio.shared?'共享工作区':'本地备份'}}</span></div>
    </aside>
    <main class="studio-main">
      <header class="studio-header">
        <div class="studio-document-name"><span class="studio-kind"><Icon :name="doc.kind" :size="15"/>{{kindLabels[doc.kind]}}</span><input :value="doc.title" @change="studio.setTitle(($event.target as HTMLInputElement).value)" aria-label="图形标题"/><span class="studio-save-state" :class="{error:studio.storageError}"><Icon :name="studio.storageError?'close':'check'" :size="13"/>{{studio.loading?'读取中':studio.pending?'保存中':studio.storageError?'待同步':studio.shared?'已保存':'本地备份'}}</span></div>
        <div class="studio-header-actions"><button class="studio-icon" title="图形数据" aria-label="图形数据" @click="openSource"><Icon name="code"/></button><button class="studio-icon" title="属性面板" aria-label="属性面板" :class="{on:inspectorOpen}" @click="inspectorOpen=!inspectorOpen"><Icon name="panel"/></button><div class="studio-export-wrap" @click.stop><button class="studio-primary" @click="exportOpen=!exportOpen"><Icon name="export" :size="15"/>导出<Icon name="chevron" :size="12"/></button><div v-if="exportOpen" class="studio-menu"><button @click="exportFile('svg')">SVG 矢量图</button><button @click="exportFile('png')">PNG 图片</button><button @click="exportFile('json')">JSON 内容数据</button><button @click="exportFile('project')">工作区文件</button><button @click="exportFile('drawio')">draw.io 文件</button><button v-if="doc.kind==='mindmap'" @click="exportFile('fmd')">FMD 思维导图</button></div></div></div>
      </header>
      <div v-if="studio.storageError" class="studio-storage-error">{{studio.storageError}}<template v-if="studio.conflictId"><button @click="studio.resolveConflict(false)">载入最新</button><button @click="studio.resolveConflict(true)">本地修改另存副本</button></template><button v-else @click="studio.retrySync">重试同步</button></div>
      <div class="studio-workarea">
        <div class="studio-canvas-area">
          <div class="studio-toolbar">
            <div class="studio-tool-group"><button class="studio-icon" :class="{on:tool==='select'}" title="选择（V）" aria-label="选择" @click="setTool('select')"><Icon name="select"/></button><button class="studio-icon" :class="{on:tool==='pan'}" title="移动画布（H）" aria-label="移动画布" @click="setTool('pan')"><Icon name="pan"/></button><button v-if="doc.kind!=='mindmap'" class="studio-icon" :class="{on:tool==='connect'}" title="连线（C）" aria-label="连线" @click="setTool('connect')"><Icon name="connect"/></button></div>
            <i class="studio-divider"/>
            <button class="studio-text-btn" @click="studio.addNode"><Icon name="plus" :size="16"/>{{doc.kind==='architecture'?'模块':doc.kind==='mindmap'?'主题':doc.kind==='dataflow'?'卡片':'节点'}}</button>
            <template v-if="doc.kind==='swimlane'"><button class="studio-text-btn" @click="addContainer('lane')">＋ 泳道</button><button class="studio-text-btn" @click="addContainer('phase')">＋ 阶段</button></template>
            <button v-if="doc.kind==='architecture'" class="studio-text-btn" @click="addContainer('group')">＋ 分层</button>
            <i class="studio-divider"/>
            <button class="studio-icon" title="撤销（Ctrl+Z）" aria-label="撤销" :disabled="!studio.canUndo" @click="studio.undo"><Icon name="undo" :size="17"/></button><button class="studio-icon" title="重做（Ctrl+Shift+Z）" aria-label="重做" :disabled="!studio.canRedo" @click="studio.redo"><Icon name="redo" :size="17"/></button>
            <div class="studio-toolbar-end"><button class="studio-text-btn" @click="reLayout"><Icon name="layout" :size="16"/>自动布局</button></div>
          </div>
          <DiagramCanvas ref="canvas" :document="doc" :scene="studio.scene" :selected-id="studio.selection?.id||null" :selected-ids="studio.selectedNodeIds" :tool="tool" @select="select" @select-many="studio.selectMany" @clear="studio.clearSelection" @context-menu="openContext" @move-many="studio.moveNodes" @connect="connectNode" @wire="wire" @reconnect="reconnect" @edge-style="edgeStyle" @label="(id,text)=>studio.updateNode(id,{label:text})"/>
          <div v-if="connectSource" class="studio-connection-state">已选择“{{doc.nodes.find(n=>n.id===connectSource)?.label}}”，请选择终点 <button @click="connectSource=null">取消</button></div>
        </div>
        <aside v-if="inspectorOpen" class="studio-inspector">
          <div class="studio-inspector-heading"><strong>{{studio.selectedNodeIds.length>1?`已选 ${studio.selectedNodeIds.length} 个节点`:node?'节点属性':edge?'连线属性':container?'分组属性':'图形属性'}}</strong><button class="studio-icon" title="关闭属性面板" @click="inspectorOpen=false"><Icon name="close" :size="15"/></button></div>
          <div class="studio-layer-tabs studio-data-tabs"><button :class="{active:inspectorLayer==='content'}" @click="inspectorLayer='content'">内容</button><button :class="{active:inspectorLayer==='rendering'}" @click="inspectorLayer='rendering'">渲染</button></div>
          <div class="studio-inspector-content"><div v-if="selectionLocked" class="studio-lock-row">已锁定<button class="studio-text-btn" @click="studio.lockSelection(false)">解锁</button></div>
            <fieldset class="studio-inspector-fields" :disabled="selectionLocked">
            <RenderingSettings v-if="inspectorLayer==='rendering'"/>
            <template v-else-if="studio.selectedNodeIds.length>1"><button class="studio-secondary" @click="studio.duplicateNodes"><Icon name="copy" :size="15"/>复制节点</button><button class="studio-danger-btn" @click="studio.removeSelection"><Icon name="trash" :size="15"/>删除选中节点</button></template>
            <template v-else-if="node">
              <label class="studio-field">文字<textarea ref="labelField" :key="node.id+node.label" :value="node.label" rows="3" @change="updateNode('label',($event.target as HTMLTextAreaElement).value)"/></label>
              <template v-if="doc.kind==='dataflow'">
                <label class="studio-field">类型<select :value="node.kind" @change="updateNode('kind',($event.target as HTMLSelectElement).value)"><option value="card">卡片</option><option value="note">文字注释</option></select></label>
                <label class="studio-field">说明<textarea :key="node.id+'description'" :value="node.description||''" rows="3" @change="updateNode('description',($event.target as HTMLTextAreaElement).value)"/></label>
              </template>
              <label v-if="doc.kind==='swimlane'||doc.kind==='flowchart'" class="studio-field">类型<select :value="node.kind" @change="updateNode('kind',($event.target as HTMLSelectElement).value)"><option value="task">处理步骤</option><option value="decision">判断</option><option value="start">开始</option><option value="end">结束</option></select></label>
              <template v-if="doc.kind==='swimlane'"><label class="studio-field">所属泳道<select :value="node.laneId" @change="updateNode('laneId',($event.target as HTMLSelectElement).value)"><option v-for="lane in doc.lanes" :key="lane.id" :value="lane.id">{{lane.label}}</option></select></label><label v-if="doc.phases.length" class="studio-field">阶段<select :value="node.phaseId" @change="updateNode('phaseId',($event.target as HTMLSelectElement).value)"><option v-for="phase in doc.phases" :key="phase.id" :value="phase.id">{{phase.label}}</option></select></label></template>
              <template v-if="doc.kind==='architecture'"><label class="studio-field">所属分层<select :value="node.groupId" @change="updateNode('groupId',($event.target as HTMLSelectElement).value)"><option v-for="group in doc.groups" :key="group.id" :value="group.id">{{group.label.replaceAll('\n',' ')}}</option></select></label><label class="studio-field">模块条目<textarea :key="node.id+'items'+node.items?.join('')" :value="node.items?.join('\n')||''" rows="6" @change="updateNode('items',($event.target as HTMLTextAreaElement).value.split('\n').filter(x=>x.trim()))" placeholder="每行一个条目"/></label><label class="studio-field">标记<input :value="node.badge||''" @change="updateNode('badge',($event.target as HTMLInputElement).value)" placeholder="例如：1期"/></label></template>
              <label v-if="doc.kind==='mindmap'&&node.parentId" class="studio-field">父主题<select :value="node.parentId" @change="updateNode('parentId',($event.target as HTMLSelectElement).value)"><option v-for="n in doc.nodes.filter(n=>n.id!==node!.id)" :key="n.id" :value="n.id">{{n.label}}</option></select></label>

              <details v-if="doc.kind!=='dataflow'" class="studio-details"><summary>备注</summary><textarea :value="node.description||''" @change="updateNode('description',($event.target as HTMLTextAreaElement).value)" rows="3"/></details>
              <div class="studio-action-grid" style="margin-top:22px"><button @click="studio.duplicateNodes"><Icon name="copy" :size="15"/>复制节点</button><button @click="studio.removeSelection"><Icon name="trash" :size="15"/>删除节点</button></div>
            </template>
            <template v-else-if="edge">
              <label v-if="doc.kind==='dataflow'" class="studio-field">连线类型<select :value="edge.kind||'flow'" @change="studio.commit(d=>{d.edges.find(e=>e.id===edge!.id)!.kind=($event.target as HTMLSelectElement).value as 'flow'|'feedback'})"><option value="flow">数据流向</option><option value="feedback">反馈回流</option></select></label>
              <label class="studio-field">连线文字<input :value="edge.label||''" @change="studio.commit(d=>{d.edges.find(e=>e.id===edge!.id)!.label=($event.target as HTMLInputElement).value})"/></label>
              <label class="studio-field">起点<select :value="edge.source" @change="studio.commit(d=>{d.edges.find(e=>e.id===edge!.id)!.source=($event.target as HTMLSelectElement).value})"><option v-for="n in doc.nodes" :key="n.id" :value="n.id">{{n.label}}</option></select></label>
              <label class="studio-field">终点<select :value="edge.target" @change="studio.commit(d=>{d.edges.find(e=>e.id===edge!.id)!.target=($event.target as HTMLSelectElement).value})"><option v-for="n in doc.nodes" :key="n.id" :value="n.id">{{n.label}}</option></select></label>
              <button class="studio-danger-btn" @click="studio.removeSelection"><Icon name="trash" :size="15"/>删除连线</button>
            </template>
            <template v-else-if="container"><label class="studio-field">名称<input :value="container.label" @change="studio.renameContainer(studio.selection!.type as 'lane'|'phase'|'group',container!.id,($event.target as HTMLInputElement).value)"/></label><div class="studio-action-grid"><button :disabled="containerIndex===0" @click="studio.containerOp(containerCollection,container!.id,containerIndex-1)">向前移动</button><button :disabled="containerIndex===containerList.length-1" @click="studio.containerOp(containerCollection,container!.id,containerIndex+1)">向后移动</button></div><label v-if="containerMembers" class="studio-field">删除时将节点移至<select v-model="moveTo"><option value="">选择目标</option><option v-for="c in containerList.filter(c=>c.id!==container!.id)" :key="c.id" :value="c.id">{{c.label.replaceAll('\n',' ')}}</option></select></label><button class="studio-danger-btn" :disabled="!!containerMembers&&!moveTo" @click="studio.containerOp(containerCollection,container!.id,undefined,moveTo||undefined)"><Icon name="trash" :size="15"/>删除分组</button></template>
            <template v-else>
              <template v-for="section in structure" :key="section.name"><div class="studio-structure-heading">{{section.name}}</div><button v-for="item in section.items" :key="item.id" class="studio-structure-item" @click="select(section.type,item.id)"><span>{{item.label.replaceAll('\n',' ')}}</span><Icon name="chevron" :size="12"/></button></template>
              <button class="studio-secondary studio-duplicate" @click="duplicate"><Icon name="copy" :size="15"/>复制此图</button>
            </template>
            </fieldset>
          </div>
        </aside>
      </div>
    </main>
    <div v-if="studio.notice" class="studio-toast" role="status">{{studio.notice}}</div>
    <div v-if="newOpen" class="studio-overlay" @click.self="newOpen=false"><section class="studio-dialog"><div class="studio-dialog-heading"><h2>新建图形</h2><button class="studio-icon" @click="newOpen=false" aria-label="关闭"><Icon name="close"/></button></div><div class="studio-type-grid"><button v-for="kind in kinds" :key="kind" @click="studio.create(kind,useExample);newOpen=false"><div v-html="thumbnail(kind)"/><strong>{{kindLabels[kind]}}</strong></button></div><label class="studio-checkbox"><input v-model="useExample" type="checkbox"/>使用示例数据</label></section></div>
    <div v-if="dataOpen" class="studio-overlay" @click.self="dataOpen=false"><section class="studio-dialog studio-data-dialog"><div class="studio-dialog-heading"><h2>{{dataMode==='source'?'图形数据':'导入图形'}}</h2><button class="studio-icon" @click="dataOpen=false" aria-label="关闭"><Icon name="close"/></button></div><div v-if="dataMode==='import'" class="studio-data-tabs"><button :class="{active:importType==='json'}" @click="importType='json'">JSON / FMD</button><button :class="{active:importType==='markdown'}" @click="importType='markdown'">Markdown 思维导图</button></div><div v-if="dataMode==='source'" class="studio-data-tabs"><button :class="{active:sourceLayer==='content'}" @click="switchSource('content')">内容数据</button><button :class="{active:sourceLayer==='rendering'}" @click="switchSource('rendering')">渲染配置</button></div><textarea v-model="dataText" class="studio-json-input" spellcheck="false" :placeholder="importType==='json'?'粘贴 Codex 返回的图形 JSON':'# 中心主题\n- 一级主题\n  - 二级主题'" aria-label="图形 JSON 或 Markdown"/><p v-if="dataError" class="studio-data-error" role="alert">{{dataError}}</p><div class="studio-dialog-actions"><button class="studio-secondary" @click="copyPrompt"><Icon name="code" :size="15"/>复制给 Codex</button><button v-if="dataMode==='import'" class="studio-secondary" @click="fileInput?.click()"><Icon name="folder" :size="15"/>选择文件</button><button class="studio-primary" @click="applyData">{{dataMode==='source'?'应用修改':'导入'}}</button></div></section></div>
    <CanvasMenu v-if="context" :x="context.screen.x" :y="context.screen.y" :selected="studio.selectedNodeIds.length>0" :count="studio.selectedNodeIds.length" :locked="selectionLocked" :grouped="selectionGrouped" :can-group="selectionCanGroup" @action="menuAction" @close="context=null"/>
    <input ref="fileInput" type="file" accept=".json,.fmd,.md,text/markdown,application/json" hidden @change="importFile"/>
    <div v-if="helpOpen" class="studio-overlay" @click.self="helpOpen=false"><section class="studio-dialog studio-data-dialog"><div class="studio-dialog-heading"><h2>AI 绘图说明</h2><button class="studio-icon" aria-label="关闭" @click="helpOpen=false"><Icon name="close"/></button></div><pre style="white-space:pre-wrap;font:12px/1.9 'Segoe UI','Microsoft YaHei',sans-serif">{{drawingGuide}}</pre></section></div>
  </div>
</template>
<script setup lang="ts">
import { extractContent,replaceContent,replaceRendering } from '../core/layers'
import RenderingSettings from './RenderingSettings.vue'
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useStudio, type Selection } from '../state/studio'
import { cardStyle, kindLabels, palette, type DiagramKind, type ThemeName, type DiagramNode, type CardStyle, type EdgeStyle, type Port, type Box, type NodeStyle, type DiagramGroup } from '../core/model'
import type { Collection } from '../core/operations'
import drawingGuide from '../../../docs/AI_DRAWING_GUIDE.md?raw'
import { parseDocument, fromMarkdown, codexPrompt } from '../core/adapters'
import { sampleFor } from '../core/samples'
import { layoutDocument } from '../core/layout'
import { renderScene } from '../core/render'
import { exportDocument } from '../services/exports'
import DiagramCanvas from './DiagramCanvas.vue'
import Icon from './Icon.vue'
import CanvasMenu from './CanvasMenu.vue'
import {byCreationNewest} from '../core/metadata'
import {isLocked} from '../core/objects'
import {writeFragment,readFragment,rememberFragment} from '../services/clipboard'
import {parseFragment} from '../core/clipboard'
import type {Point} from '../core/model'
import './studio.css'
const route=useRoute(),studio=useStudio(),doc=computed(()=>studio.current),files=computed(()=>studio.documents.filter(d=>d.title.toLowerCase().includes(search.value.toLowerCase())).sort(byCreationNewest))
const context=ref<{screen:Point;point:Point}|null>(null),selectionLocked=computed(()=>studio.selectedNodeIds.some(id=>isLocked(doc.value,id))),selectionGrouped=computed(()=>Object.values(doc.value.presentation.objects?.groups||{}).some(m=>m.some(id=>studio.selectedNodeIds.includes(id))))
const selectionCanGroup=computed(()=>studio.selectedNodeIds.length>1&&!Object.values(doc.value.presentation.objects?.groups||{}).some(m=>m.length===studio.selectedNodeIds.length&&m.every(id=>studio.selectedNodeIds.includes(id))))
let pasteSequence=0
const inspectorLayer=ref<'content'|'rendering'>('content'),sourceLayer=ref<'content'|'rendering'>('content')
const kinds:DiagramKind[]=['swimlane','flowchart','architecture','mindmap','dataflow']
const searchOpen=ref(false),search=ref(''),inspectorOpen=ref(true),newOpen=ref(false),useExample=ref(false),exportOpen=ref(false),dataOpen=ref(false),dataMode=ref<'source'|'import'>('import'),dataText=ref(''),dataError=ref(''),importType=ref<'json'|'markdown'>('json'),connectSource=ref<string|null>(null),tool=ref<'select'|'pan'|'connect'>('select'),fileInput=ref<HTMLInputElement>(),labelField=ref<HTMLTextAreaElement>(),canvas=ref<InstanceType<typeof DiagramCanvas>>()
const node=computed(()=>studio.selection?.type==='node'?doc.value.nodes.find(n=>n.id===studio.selection!.id):undefined),edge=computed(()=>studio.selection?.type==='edge'?doc.value.edges.find(e=>e.id===studio.selection!.id):undefined)
const helpOpen=ref(false),moveTo=ref('')
const container=computed(()=>{const s=studio.selection;if(!s||s.type==='node'||s.type==='edge')return;return(s.type==='lane'?doc.value.lanes:s.type==='phase'?doc.value.phases:doc.value.groups).find(x=>x.id===s.id)})
const containerCollection=computed<Collection>(()=>studio.selection?.type==='lane'?'lanes':studio.selection?.type==='phase'?'phases':'groups'),containerList=computed(()=>doc.value[containerCollection.value]),containerIndex=computed(()=>containerList.value.findIndex(c=>c.id===container.value?.id)),containerMembers=computed(()=>doc.value.nodes.filter(n=>n[containerCollection.value==='lanes'?'laneId':containerCollection.value==='phases'?'phaseId':'groupId']===container.value?.id).length)
const structure=computed(()=>doc.value.kind==='swimlane'?[{name:'泳道',type:'lane',items:doc.value.lanes},{name:'阶段',type:'phase',items:doc.value.phases}]:doc.value.kind==='architecture'?[{name:'架构分层',type:'group',items:doc.value.groups}]:[])
const thumbnails=new Map<DiagramKind,string>()
function thumbnail(kind:DiagramKind){if(!thumbnails.has(kind)){const d=sampleFor(kind);thumbnails.set(kind,renderScene(layoutDocument(d),d))}return thumbnails.get(kind)!}
function select(type:string,id:string,additive=false){studio.select(type as NonNullable<Selection>['type'],id,additive);moveTo.value=''}
function setTool(value:'select'|'pan'|'connect'){tool.value=value;connectSource.value=null}
function connectNode(id:string){studio.select('node',id);if(!connectSource.value){connectSource.value=id;return}if(studio.connect(connectSource.value,id)){connectSource.value=null;tool.value='select';studio.notify('连线已创建')}}
function editNode(id:string){canvas.value?.beginEdit(id)}
function wire(source:string,target:string,sourcePort:Port,targetPort:Port){if(studio.connect(source,target,sourcePort,targetPort))studio.notify('连线已创建')}
function edgeStyle(id:string,style:EdgeStyle){studio.commit(d=>{(d.presentation.edges??={})[id]={...d.presentation.edges?.[id],...style}})}
function reconnect(id:string,endpoint:'source'|'target',nodeId:string,port:Port){studio.commit(d=>{const e=d.edges.find(e=>e.id===id)!;if(e[endpoint==='source'?'target':'source']===nodeId)throw new Error('连线两端不能为同一节点');e[endpoint]=nodeId;const s=(d.presentation.edges??={})[id]??={};s[endpoint==='source'?'sourcePort':'targetPort']=port;delete s.points})}
function updateNode(key:keyof DiagramNode,value:unknown){if(!node.value)return;const id=node.value.id;studio.commit(d=>{const n=d.nodes.find(n=>n.id===id)!;Object.assign(n,{[key]:value});if(['laneId','phaseId','groupId','parentId','kind'].includes(key))delete d.presentation.positions[id]})}
async function addContainer(type:'lane'|'phase'|'group'){studio.addContainer(type);await nextTick();canvas.value?.fit()}
async function reLayout(){studio.autoLayout();await nextTick();canvas.value?.initialView()}
function duplicate(){const d=JSON.parse(JSON.stringify(doc.value));d.title+=' · 副本';studio.addDocument(d)}
function removeFile(id:string){const name=studio.documents.find(d=>d.id===id)!.title;if(window.confirm(`删除“${name}”？`))studio.deleteDocument(id)}
function openImport(){dataMode.value='import';dataText.value='';dataError.value='';importType.value='json';dataOpen.value=true}
function switchSource(layer:'content'|'rendering'){sourceLayer.value=layer;dataText.value=JSON.stringify(layer==='content'?extractContent(doc.value):doc.value.presentation,null,2);dataError.value=''}
function openSource(){dataMode.value='source';switchSource('content');importType.value='json';dataOpen.value=true}
function applyData(){try{if(dataMode.value==='source'){const input=JSON.parse(dataText.value);const parsed=sourceLayer.value==='content'?replaceContent(doc.value,input):replaceRendering(doc.value,input);if(!studio.commit(d=>Object.assign(d,parsed)))return;studio.clearSelection()}else{const parsed=importType.value==='markdown'?fromMarkdown(dataText.value):parseDocument(dataText.value);if(!studio.addDocument(parsed))return}dataOpen.value=false;studio.notify(dataMode.value==='source'?'已应用修改':'图形已导入')}catch(e){dataError.value=(e as Error).message}}
async function importFile(e:Event){const input=e.target as HTMLInputElement,file=input.files?.[0];if(!file)return;try{if(file.size>2_000_000)throw new Error('请选择 2 MB 以内的图形文件');const text=await file.text();const parsed=file.name.endsWith('.md')?fromMarkdown(text):parseDocument(text);if(studio.addDocument(parsed)){dataOpen.value=false;studio.notify('图形已导入')}}catch(e){dataError.value=(e as Error).message;studio.notify(dataError.value)}finally{input.value=''}}
async function copyPrompt(){const text=studio.shared?`使用 FlyMind MCP，先 get_drawing_guide，然后 get_diagram 读取图形 ${doc.value.id} 的最新版本。根据下面补充的业务需求，通过 patch_diagram 增量修改，保留人工编辑，返回图片与编辑链接。\n\n补充需求：`:codexPrompt(doc.value);try{await navigator.clipboard.writeText(text);studio.notify('绘图指令已复制，可粘贴到 Codex 对话')}catch{dataText.value=text;studio.notify('剪贴板不可用，请选中并复制指令')}}
async function exportFile(format:'svg'|'png'|'json'|'drawio'|'fmd'|'project'){exportOpen.value=false;try{await exportDocument(doc.value,studio.scene,format);studio.notify('已导出当前图形')}catch(e){studio.notify((e as Error).message)}}
function openContext(screen:Point,point:Point){context.value={screen,point}}
async function clipboardAction(action:'copy'|'cut'|'paste',point?:Point){try{if(action==='paste'){const fragment=await readFragment(),center=point||canvas.value?.centerPoint()||{x:400,y:300};const offset=point?0:(pasteSequence++%8)*24;studio.paste(fragment,{x:center.x+offset,y:center.y+offset})}else{const fragment=studio.fragment();if(!await writeFragment(fragment))throw new Error('剪贴板不可用，原节点已保留');pasteSequence=0;if(action==='cut'&&!studio.removeSelection())return;studio.notify(action==='cut'?'已剪切':'已复制')}}catch(e){studio.notify((e as Error).message)}}
function menuAction(action:string){const point=context.value?.point;context.value=null;if(['copy','cut','paste'].includes(action)){clipboardAction(action as 'copy'|'cut'|'paste',point);return}if(action==='edit'&&node.value)canvas.value?.beginEdit(node.value.id);if(action==='duplicate')studio.duplicateNodes();if(action==='group')studio.groupSelection();if(action==='ungroup')studio.ungroupSelection();if(action==='lock'||action==='unlock')studio.lockSelection(action==='lock');if(['front','back','forward','backward'].includes(action))studio.reorderSelection(action as 'front'|'back'|'forward'|'backward');if(action==='delete')studio.removeSelection()}
function clipboardEvent(e:ClipboardEvent){if(dataOpen.value||newOpen.value||helpOpen.value||(e.target as Element)?.closest?.('input,textarea,select,[contenteditable]'))return;try{if(e.type==='paste'){const text=e.clipboardData?.getData('text/plain')||'';if(!text)return;e.preventDefault();const fragment=parseFragment(text),center=canvas.value?.centerPoint()||{x:400,y:300},offset=(pasteSequence++%8)*24;studio.paste(fragment,{x:center.x+offset,y:center.y+offset})}else if(studio.selectedNodeIds.length){const fragment=studio.fragment();e.clipboardData?.setData('text/plain',JSON.stringify(fragment));rememberFragment(fragment);e.preventDefault();pasteSequence=0;if(e.type==='cut')studio.removeSelection()}}catch(error){e.preventDefault();studio.notify((error as Error).message)}}
function keydown(e:KeyboardEvent){if(dataOpen.value||newOpen.value||helpOpen.value||(e.target as Element).closest('input,textarea,select,[contenteditable]'))return;const key=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&key==='z'){e.preventDefault();e.shiftKey?studio.redo():studio.undo();return}if((e.ctrlKey||e.metaKey)&&key==='s'){e.preventDefault();studio.persist();studio.notify(studio.storageError||'正在保存');return}if((e.ctrlKey||e.metaKey)&&key==='a'){e.preventDefault();studio.selectMany(doc.value.nodes.filter(n=>!isLocked(doc.value,n.id)).map(n=>n.id));return}if((e.ctrlKey||e.metaKey)&&key==='g'){e.preventDefault();e.shiftKey?studio.ungroupSelection():studio.groupSelection();return}if((e.ctrlKey||e.metaKey)&&key==='l'){e.preventDefault();studio.lockSelection(!selectionLocked.value);return}if((e.ctrlKey||e.metaKey)&&key==='d'){e.preventDefault();studio.duplicateNodes();return}if(e.ctrlKey||e.metaKey||e.altKey)return;if(key==='delete'||key==='backspace'){e.preventDefault();studio.removeSelection()}if(key==='escape'){context.value=null;studio.clearSelection();setTool('select')}if(key==='v')setTool('select');if(key==='h')setTool('pan');if(key==='c'&&doc.value.kind!=='mindmap')setTool('connect');if(key==='enter'&&node.value)editNode(node.value.id);if(e.key.startsWith('Arrow')&&studio.selectedNodeIds.length){e.preventDefault();const step=e.shiftKey?10:1,boxes=Object.fromEntries(studio.scene.nodes.filter(n=>studio.selectedNodeIds.includes(n.node.id)).map(n=>[n.node.id,{x:Math.max(16,n.x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0)),y:Math.max(16,n.y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0))}]));studio.moveNodes(boxes)}}
watch(()=>studio.activeId,()=>{setTool('select');exportOpen.value=false})
watch(()=>route.query.diagram,async id=>{if(typeof id!=='string')return;if(await studio.ensureDocument(id))studio.open(id)})
let refreshTimer:ReturnType<typeof setInterval>
onMounted(()=>{window.addEventListener('keydown',keydown);for(const name of ['copy','cut','paste'])window.addEventListener(name,clipboardEvent as EventListener);studio.initialize();refreshTimer=setInterval(()=>studio.refreshRemote(),2000)})
onUnmounted(()=>{window.removeEventListener('keydown',keydown);for(const name of ['copy','cut','paste'])window.removeEventListener(name,clipboardEvent as EventListener);clearInterval(refreshTimer)})
</script>
