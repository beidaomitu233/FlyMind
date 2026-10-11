<template>
  <div class="studio-root" @click="exportOpen=false">
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
      <div class="studio-side-bottom"><button @click="openImport"><Icon name="import" :size="17"/>导入图形</button><span><i/>本地工作区</span></div>
    </aside>
    <main class="studio-main">
      <header class="studio-header">
        <div class="studio-document-name"><span class="studio-kind"><Icon :name="doc.kind" :size="15"/>{{kindLabels[doc.kind]}}</span><input :value="doc.title" @change="studio.setTitle(($event.target as HTMLInputElement).value)" aria-label="图形标题"/><span class="studio-save-state" :class="{error:studio.storageError}"><Icon :name="studio.storageError?'close':'check'" :size="13"/>{{studio.storageError?'未保存':'已保存'}}</span></div>
        <div class="studio-header-actions"><button class="studio-icon" title="图形数据" aria-label="图形数据" @click="openSource"><Icon name="code"/></button><button class="studio-icon" title="属性面板" aria-label="属性面板" :class="{on:inspectorOpen}" @click="inspectorOpen=!inspectorOpen"><Icon name="panel"/></button><div class="studio-export-wrap" @click.stop><button class="studio-primary" @click="exportOpen=!exportOpen"><Icon name="export" :size="15"/>导出<Icon name="chevron" :size="12"/></button><div v-if="exportOpen" class="studio-menu"><button @click="exportFile('svg')">SVG 矢量图</button><button @click="exportFile('png')">PNG 图片</button><button @click="exportFile('json')">JSON 图形数据</button><button @click="exportFile('drawio')">draw.io 文件</button><button v-if="doc.kind==='mindmap'" @click="exportFile('fmd')">FMD 思维导图</button></div></div></div>
      </header>
      <div v-if="studio.storageError" class="studio-storage-error">{{studio.storageError}}</div>
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
          <DiagramCanvas ref="canvas" :document="doc" :scene="studio.scene" :selected-id="studio.selection?.id||null" :tool="tool" @select="select" @clear="studio.selection=null" @move="studio.moveNode" @connect="connectNode" @edit="editNode"/>
          <div v-if="connectSource" class="studio-connection-state">已选择“{{doc.nodes.find(n=>n.id===connectSource)?.label}}”，请选择终点 <button @click="connectSource=null">取消</button></div>
        </div>
        <aside v-if="inspectorOpen" class="studio-inspector">
          <div class="studio-inspector-heading"><strong>{{node?'节点属性':edge?'连线属性':container?'分组属性':'图形属性'}}</strong><button class="studio-icon" title="关闭属性面板" @click="inspectorOpen=false"><Icon name="close" :size="15"/></button></div>
          <div class="studio-inspector-content">
            <template v-if="node">
              <label class="studio-field">文字<textarea ref="labelField" :key="node.id+node.label" :value="node.label" rows="3" @change="updateNode('label',($event.target as HTMLTextAreaElement).value)"/></label>
              <template v-if="doc.kind==='dataflow'">
                <label class="studio-field">类型<select :value="node.kind" @change="updateNode('kind',($event.target as HTMLSelectElement).value)"><option value="card">卡片</option><option value="note">文字注释</option></select></label>
                <label class="studio-field">说明<textarea :key="node.id+'description'" :value="node.description||''" rows="3" @change="updateNode('description',($event.target as HTMLTextAreaElement).value)"/></label>
                <label class="studio-field">布局行<input type="number" min="0" max="200" :value="node.order||0" @change="updateNode('order',Number(($event.target as HTMLInputElement).value))"/></label>
                <template v-if="node.kind!=='note'">
                  <label class="studio-field">卡片形式<select :value="card.variant" @change="updateCard('variant',($event.target as HTMLSelectElement).value)"><option value="card">左对齐卡片</option><option value="band">居中横幅</option></select></label>
                  <label v-if="card.variant!=='band'" class="studio-field">图标<select :value="card.icon" @change="updateCard('icon',($event.target as HTMLSelectElement).value)"><option value="none">无</option><option value="database">数据库</option><option value="network">分析网络</option><option value="check">确认</option></select></label>
                  <label class="studio-field">卡片配色<div class="studio-segment"><button :class="{active:card.tone==='blue'}" @click="updateCard('tone','blue')">主题色</button><button :class="{active:card.tone==='teal'}" @click="updateCard('tone','teal')">青绿</button></div></label>
                </template>
              </template>
              <label v-if="doc.kind==='swimlane'||doc.kind==='flowchart'" class="studio-field">类型<select :value="node.kind" @change="updateNode('kind',($event.target as HTMLSelectElement).value)"><option value="task">处理步骤</option><option value="decision">判断</option><option value="start">开始</option><option value="end">结束</option></select></label>
              <template v-if="doc.kind==='swimlane'"><label class="studio-field">所属泳道<select :value="node.laneId" @change="updateNode('laneId',($event.target as HTMLSelectElement).value)"><option v-for="lane in doc.lanes" :key="lane.id" :value="lane.id">{{lane.label}}</option></select></label><label v-if="doc.phases.length" class="studio-field">阶段<select :value="node.phaseId" @change="updateNode('phaseId',($event.target as HTMLSelectElement).value)"><option v-for="phase in doc.phases" :key="phase.id" :value="phase.id">{{phase.label}}</option></select></label><label class="studio-field">阶段内顺序<input type="number" min="0" max="200" :value="node.order||0" @change="updateNode('order',Number(($event.target as HTMLInputElement).value))"/></label></template>
              <template v-if="doc.kind==='architecture'"><label class="studio-field">所属分层<select :value="node.groupId" @change="updateNode('groupId',($event.target as HTMLSelectElement).value)"><option v-for="group in doc.groups" :key="group.id" :value="group.id">{{group.label.replaceAll('\n',' ')}}</option></select></label><label class="studio-field">模块条目<textarea :key="node.id+'items'+node.items?.join('')" :value="node.items?.join('\n')||''" rows="6" @change="updateNode('items',($event.target as HTMLTextAreaElement).value.split('\n').filter(x=>x.trim()))" placeholder="每行一个条目"/></label><label class="studio-field">标记<input :value="node.badge||''" @change="updateNode('badge',($event.target as HTMLInputElement).value)" placeholder="例如：1期"/></label></template>
              <label v-if="doc.kind==='mindmap'&&node.parentId" class="studio-field">父主题<select :value="node.parentId" @change="updateNode('parentId',($event.target as HTMLSelectElement).value)"><option v-for="n in doc.nodes.filter(n=>n.id!==node!.id)" :key="n.id" :value="n.id">{{n.label}}</option></select></label>
              <details v-if="doc.kind!=='dataflow'" class="studio-details"><summary>备注</summary><textarea :value="node.description||''" @change="updateNode('description',($event.target as HTMLTextAreaElement).value)" rows="3"/></details>
              <button class="studio-danger-btn" @click="studio.removeSelection"><Icon name="trash" :size="15"/>删除节点</button>
            </template>
            <template v-else-if="edge">
              <label v-if="doc.kind==='dataflow'" class="studio-field">连线类型<select :value="edge.kind||'flow'" @change="studio.commit(d=>{d.edges.find(e=>e.id===edge!.id)!.kind=($event.target as HTMLSelectElement).value as 'flow'|'feedback'})"><option value="flow">数据流向</option><option value="feedback">反馈回流</option></select></label>
              <label class="studio-field">连线文字<input :value="edge.label||''" @change="studio.commit(d=>{d.edges.find(e=>e.id===edge!.id)!.label=($event.target as HTMLInputElement).value})"/></label>
              <label class="studio-field">起点<select :value="edge.source" @change="studio.commit(d=>{d.edges.find(e=>e.id===edge!.id)!.source=($event.target as HTMLSelectElement).value})"><option v-for="n in doc.nodes" :key="n.id" :value="n.id">{{n.label}}</option></select></label>
              <label class="studio-field">终点<select :value="edge.target" @change="studio.commit(d=>{d.edges.find(e=>e.id===edge!.id)!.target=($event.target as HTMLSelectElement).value})"><option v-for="n in doc.nodes" :key="n.id" :value="n.id">{{n.label}}</option></select></label>
              <label class="studio-checkbox"><input type="checkbox" :checked="edge.dashed" @change="studio.commit(d=>{d.edges.find(e=>e.id===edge!.id)!.dashed=($event.target as HTMLInputElement).checked})"/>虚线</label>
              <button class="studio-danger-btn" @click="studio.removeSelection"><Icon name="trash" :size="15"/>删除连线</button>
            </template>
            <template v-else-if="container"><label class="studio-field">名称<input :value="container.label" @change="studio.renameContainer(studio.selection!.type as 'lane'|'phase'|'group',container!.id,($event.target as HTMLInputElement).value)"/></label><button class="studio-danger-btn" @click="studio.removeSelection"><Icon name="trash" :size="15"/>删除分组</button></template>
            <template v-else>
              <label class="studio-field">配色<div class="studio-themes"><button v-for="(p,name) in palette" :key="name" :style="{background:p.brand}" :class="{selected:doc.presentation.theme===name}" :aria-label="{blue:'蓝色',indigo:'靛蓝',forest:'青绿'}[name]" @click="studio.setTheme(name as ThemeName)"><Icon v-if="doc.presentation.theme===name" name="check" :size="16"/></button></div></label>
              <label v-if="doc.kind==='swimlane'||doc.kind==='flowchart'" class="studio-field">流程方向<div class="studio-segment"><button :class="{active:doc.presentation.orientation==='vertical'}" @click="studio.setOrientation('vertical')">纵向</button><button :class="{active:doc.presentation.orientation==='horizontal'}" @click="studio.setOrientation('horizontal')">横向</button></div></label>
              <template v-for="section in structure" :key="section.name"><div class="studio-structure-heading">{{section.name}}</div><button v-for="item in section.items" :key="item.id" class="studio-structure-item" @click="select(section.type,item.id)"><span>{{item.label.replaceAll('\n',' ')}}</span><Icon name="chevron" :size="12"/></button></template>
              <button class="studio-secondary studio-duplicate" @click="duplicate"><Icon name="copy" :size="15"/>复制此图</button>
            </template>
          </div>
        </aside>
      </div>
    </main>
    <div v-if="studio.notice" class="studio-toast" role="status">{{studio.notice}}</div>
    <div v-if="newOpen" class="studio-overlay" @click.self="newOpen=false"><section class="studio-dialog"><div class="studio-dialog-heading"><h2>新建图形</h2><button class="studio-icon" @click="newOpen=false" aria-label="关闭"><Icon name="close"/></button></div><div class="studio-type-grid"><button v-for="kind in kinds" :key="kind" @click="studio.create(kind,useExample);newOpen=false"><div v-html="thumbnail(kind)"/><strong>{{kindLabels[kind]}}</strong></button></div><label class="studio-checkbox"><input v-model="useExample" type="checkbox"/>使用示例数据</label></section></div>
    <div v-if="dataOpen" class="studio-overlay" @click.self="dataOpen=false"><section class="studio-dialog studio-data-dialog"><div class="studio-dialog-heading"><h2>{{dataMode==='source'?'图形数据':'导入图形'}}</h2><button class="studio-icon" @click="dataOpen=false" aria-label="关闭"><Icon name="close"/></button></div><div v-if="dataMode==='import'" class="studio-data-tabs"><button :class="{active:importType==='json'}" @click="importType='json'">JSON / FMD</button><button :class="{active:importType==='markdown'}" @click="importType='markdown'">Markdown 思维导图</button></div><textarea v-model="dataText" class="studio-json-input" spellcheck="false" :placeholder="importType==='json'?'粘贴 Codex 返回的图形 JSON':'# 中心主题\n- 一级主题\n  - 二级主题'" aria-label="图形 JSON 或 Markdown"/><p v-if="dataError" class="studio-data-error" role="alert">{{dataError}}</p><div class="studio-dialog-actions"><button class="studio-secondary" @click="copyPrompt"><Icon name="code" :size="15"/>复制给 Codex</button><button v-if="dataMode==='import'" class="studio-secondary" @click="fileInput?.click()"><Icon name="folder" :size="15"/>选择文件</button><button class="studio-primary" @click="applyData">{{dataMode==='source'?'应用修改':'导入'}}</button></div></section></div>
    <input ref="fileInput" type="file" accept=".json,.fmd,.md,text/markdown,application/json" hidden @change="importFile"/>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useStudio, type Selection } from '../state/studio'
import { cardStyle, kindLabels, palette, type DiagramKind, type ThemeName, type DiagramNode, type CardStyle } from '../core/model'
import { parseDocument, fromMarkdown, codexPrompt } from '../core/adapters'
import { sampleFor } from '../core/samples'
import { layoutDocument } from '../core/layout'
import { renderScene } from '../core/render'
import { exportDocument } from '../services/exports'
import DiagramCanvas from './DiagramCanvas.vue'
import Icon from './Icon.vue'
import './studio.css'
const studio=useStudio(),doc=computed(()=>studio.current),files=computed(()=>studio.documents.filter(d=>d.title.toLowerCase().includes(search.value.toLowerCase())))
const kinds:DiagramKind[]=['swimlane','flowchart','architecture','mindmap','dataflow']
const searchOpen=ref(false),search=ref(''),inspectorOpen=ref(true),newOpen=ref(false),useExample=ref(false),exportOpen=ref(false),dataOpen=ref(false),dataMode=ref<'source'|'import'>('import'),dataText=ref(''),dataError=ref(''),importType=ref<'json'|'markdown'>('json'),connectSource=ref<string|null>(null),tool=ref<'select'|'pan'|'connect'>('select'),fileInput=ref<HTMLInputElement>(),labelField=ref<HTMLTextAreaElement>(),canvas=ref<InstanceType<typeof DiagramCanvas>>()
const node=computed(()=>studio.selection?.type==='node'?doc.value.nodes.find(n=>n.id===studio.selection!.id):undefined),edge=computed(()=>studio.selection?.type==='edge'?doc.value.edges.find(e=>e.id===studio.selection!.id):undefined)
const card=computed(()=>cardStyle(doc.value,node.value?.id||''))
const container=computed(()=>{const s=studio.selection;if(!s||s.type==='node'||s.type==='edge')return;return(s.type==='lane'?doc.value.lanes:s.type==='phase'?doc.value.phases:doc.value.groups).find(x=>x.id===s.id)})
const structure=computed(()=>doc.value.kind==='swimlane'?[{name:'泳道',type:'lane',items:doc.value.lanes},{name:'阶段',type:'phase',items:doc.value.phases}]:doc.value.kind==='architecture'?[{name:'架构分层',type:'group',items:doc.value.groups}]:[])
const thumbnails=new Map<DiagramKind,string>()
function thumbnail(kind:DiagramKind){if(!thumbnails.has(kind)){const d=sampleFor(kind);thumbnails.set(kind,renderScene(layoutDocument(d),d))}return thumbnails.get(kind)!}
function select(type:string,id:string){studio.selection={type:type as NonNullable<Selection>['type'],id}}
function setTool(value:'select'|'pan'|'connect'){tool.value=value;connectSource.value=null}
function connectNode(id:string){studio.selection={type:'node',id};if(!connectSource.value){connectSource.value=id;return}if(studio.connect(connectSource.value,id)){connectSource.value=null;tool.value='select';studio.notify('连线已创建')}}
function editNode(id:string){studio.selection={type:'node',id};inspectorOpen.value=true;nextTick(()=>{labelField.value?.focus();labelField.value?.select()})}
function updateNode(key:keyof DiagramNode,value:unknown){if(!node.value)return;const id=node.value.id;studio.commit(d=>{const n=d.nodes.find(n=>n.id===id)!;Object.assign(n,{[key]:value});if(['laneId','phaseId','groupId','parentId','order','kind'].includes(key))delete d.presentation.positions[id]})}
function updateCard(key:keyof CardStyle,value:string){if(!node.value)return;const id=node.value.id;studio.commit(d=>{d.presentation.cards??={};d.presentation.cards[id]={...d.presentation.cards[id],[key]:value}})}
async function addContainer(type:'lane'|'phase'|'group'){studio.addContainer(type);await nextTick();canvas.value?.fit()}
async function reLayout(){studio.autoLayout();await nextTick();canvas.value?.fit()}
function duplicate(){const d=JSON.parse(JSON.stringify(doc.value));d.title+=' · 副本';studio.addDocument(d)}
function removeFile(id:string){const name=studio.documents.find(d=>d.id===id)!.title;if(window.confirm(`删除“${name}”？`))studio.deleteDocument(id)}
function openImport(){dataMode.value='import';dataText.value='';dataError.value='';importType.value='json';dataOpen.value=true}
function openSource(){dataMode.value='source';dataText.value=JSON.stringify(doc.value,null,2);dataError.value='';importType.value='json';dataOpen.value=true}
function applyData(){try{const parsed=importType.value==='markdown'?fromMarkdown(dataText.value):parseDocument(dataText.value);if(dataMode.value==='source'){const id=doc.value.id;if(!studio.commit(d=>Object.assign(d,parsed,{id})))return;studio.selection=null}else if(!studio.addDocument(parsed))return;dataOpen.value=false;studio.notify(dataMode.value==='source'?'图形数据已更新':'图形已导入')}catch(e){dataError.value=(e as Error).message}}
async function importFile(e:Event){const input=e.target as HTMLInputElement,file=input.files?.[0];if(!file)return;try{if(file.size>2_000_000)throw new Error('请选择 2 MB 以内的图形文件');const text=await file.text();const parsed=file.name.endsWith('.md')?fromMarkdown(text):parseDocument(text);if(studio.addDocument(parsed)){dataOpen.value=false;studio.notify('图形已导入')}}catch(e){dataError.value=(e as Error).message;studio.notify(dataError.value)}finally{input.value=''}}
async function copyPrompt(){const text=codexPrompt(doc.value);try{await navigator.clipboard.writeText(text);studio.notify('生成指令与图形结构已复制，可粘贴到 Codex 对话')}catch{dataText.value=text;studio.notify('剪贴板不可用，请选中并复制指令')}}
async function exportFile(format:'svg'|'png'|'json'|'drawio'|'fmd'){exportOpen.value=false;try{await exportDocument(doc.value,studio.scene,format);studio.notify('已导出当前图形')}catch(e){studio.notify((e as Error).message)}}
function keydown(e:KeyboardEvent){if(dataOpen.value||newOpen.value||(e.target as Element).closest('input,textarea,select,[contenteditable]'))return;const key=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&key==='z'){e.preventDefault();e.shiftKey?studio.redo():studio.undo();return}if((e.ctrlKey||e.metaKey)&&key==='s'){e.preventDefault();studio.persist();studio.notify(studio.storageError||'已保存');return}if(e.ctrlKey||e.metaKey||e.altKey)return;if(key==='delete'||key==='backspace'){e.preventDefault();studio.removeSelection()}if(key==='escape'){studio.selection=null;setTool('select')}if(key==='v')setTool('select');if(key==='h')setTool('pan');if(key==='c'&&doc.value.kind!=='mindmap')setTool('connect');if(key==='enter'&&node.value)editNode(node.value.id)}
watch(()=>studio.activeId,()=>{setTool('select');exportOpen.value=false})
onMounted(()=>window.addEventListener('keydown',keydown))
onUnmounted(()=>window.removeEventListener('keydown',keydown))
</script>
