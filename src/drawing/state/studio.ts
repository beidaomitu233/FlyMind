import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { copy, newId, validateDocument, type DiagramDocument, type DiagramKind, type DiagramNode, type ThemeName } from '../core/model'
import { layoutDocument } from '../core/layout'
import { blankDocument, samples, sampleFor } from '../core/samples'
const KEY='flymind-drawing-studio-v1'
const DATAFLOW_SEED=KEY+'-dataflow-example'
export type Selection={type:'node'|'edge'|'lane'|'phase'|'group';id:string}|null
export const useStudio=defineStore('drawing-studio',()=>{
  const documents=ref<DiagramDocument[]>([]),activeId=ref(''),selection=ref<Selection>(null),storageError=ref(''),notice=ref('')
  const histories=new Map<string,{items:string[];index:number}>(),recoveryRequired=ref(false)
  try{const stored=localStorage.getItem(KEY);if(stored){const data=JSON.parse(stored);if(!Array.isArray(data.documents))throw new Error('存档格式无效');documents.value=data.documents.map(validateDocument);activeId.value=data.activeId}}catch{try{localStorage.setItem(`${KEY}-recovery-${Date.now()}`,localStorage.getItem(KEY)||'');storageError.value='原始存档已备份；可重新导入 JSON 备份继续编辑。'}catch{recoveryRequired.value=true;storageError.value='本地存档未能读取；原始存档仍保留。请先导出当前图形备份。'}}
  if(!documents.value.length)documents.value=copy(samples)
  let seedDataflow=false
  try{if(!localStorage.getItem(DATAFLOW_SEED)){if(!documents.value.some(d=>d.kind==='dataflow'))documents.value.push(sampleFor('dataflow'));seedDataflow=true}}catch{}
  if(!documents.value.some(d=>d.id===activeId.value))activeId.value=documents.value[0].id
  const current=computed(()=>documents.value.find(d=>d.id===activeId.value)!),scene=computed(()=>layoutDocument(current.value))
  function history(){let h=histories.get(activeId.value);if(!h){h={items:[JSON.stringify(current.value)],index:0};histories.set(activeId.value,h)}return h}
  const historyVersion=ref(0),canUndo=computed(()=>{historyVersion.value;return history().index>0}),canRedo=computed(()=>{historyVersion.value;const h=history();return h.index<h.items.length-1})
  let noticeTimer:ReturnType<typeof setTimeout>
  function notify(message:string){notice.value=message;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.value='',3200)}
  function persist(){try{if(recoveryRequired.value)throw new Error('原始存档待恢复，当前操作暂留在内存中，请导出备份');localStorage.setItem(KEY,JSON.stringify({documents:documents.value,activeId:activeId.value}));storageError.value='';return true}catch(e){storageError.value=(e as Error).message||'保存失败，请导出备份';return false}}
  function commit(change:(d:DiagramDocument)=>void){const d=copy(current.value);try{change(d);d.updatedAt=Date.now();validateDocument(d)}catch(e){notify((e as Error).message);return false}const h=history();h.items=h.items.slice(0,h.index+1);h.items.push(JSON.stringify(d));if(h.items.length>60)h.items.shift();h.index=h.items.length-1;documents.value=documents.value.map(x=>x.id===d.id?d:x);historyVersion.value++;persist();return true}
  function open(id:string){activeId.value=id;selection.value=null;historyVersion.value++;persist()}
  function addDocument(d:DiagramDocument){try{const next=validateDocument(d);next.id=newId('diagram');next.updatedAt=Date.now();documents.value.push(next);open(next.id);return true}catch(e){notify((e as Error).message);return false}}
  function create(kind:DiagramKind,example=false){addDocument(example?sampleFor(kind):blankDocument(kind))}
  function undo(){const h=history();if(h.index<=0)return;h.index--;documents.value=documents.value.map(d=>d.id===activeId.value?JSON.parse(h.items[h.index]):d);selection.value=null;historyVersion.value++;persist()}
  function redo(){const h=history();if(h.index>=h.items.length-1)return;h.index++;documents.value=documents.value.map(d=>d.id===activeId.value?JSON.parse(h.items[h.index]):d);selection.value=null;historyVersion.value++;persist()}
  function updateNode(id:string,changes:Partial<DiagramNode>){commit(d=>{const node=d.nodes.find(n=>n.id===id);if(node)Object.assign(node,changes)})}
  function setTitle(title:string){commit(d=>{d.title=title.trim()})}
  function setTheme(theme:ThemeName){commit(d=>{d.presentation.theme=theme})}
  function setOrientation(orientation:'vertical'|'horizontal'){commit(d=>{d.presentation.orientation=orientation;d.presentation.positions={}})}
  function autoLayout(){commit(d=>{d.presentation.positions={}});notify('已按节点关系重新排布')}
  function addNode(){const d=current.value,n:DiagramNode={id:newId(),label:d.kind==='architecture'?'新模块':d.kind==='mindmap'?'新主题':'新步骤',kind:d.kind==='architecture'?'module':d.kind==='mindmap'?'topic':'task'}
    const selected=d.nodes.find(n=>n.id===selection.value?.id)
    if(d.kind==='swimlane'){n.laneId=selection.value?.type==='lane'?selection.value.id:selected?.laneId||d.lanes[0].id;n.phaseId=selection.value?.type==='phase'?selection.value.id:selected?.phaseId||d.phases[0]?.id;n.order=(selected?.order??Math.max(-1,...d.nodes.filter(x=>x.laneId===n.laneId&&x.phaseId===n.phaseId).map(x=>x.order||0)))+1}
    if(d.kind==='architecture'){n.groupId=selection.value?.type==='group'?selection.value.id:selected?.groupId||d.groups[0].id;n.items=['功能条目']}
    if(d.kind==='mindmap')n.parentId=selected?.id||d.nodes.find(x=>!x.parentId)!.id
    if(d.kind==='flowchart'&&selected)n.order=(selected.order??0)+1
    if(d.kind==='dataflow'){n.kind='card';n.label='新卡片';n.description='';n.order=selected?.order??Math.max(0,...d.nodes.map(n=>n.order||0))}
    if(commit(x=>{x.nodes.push(n);if(selected&&d.kind==='flowchart')x.edges.push({id:newId('edge'),source:selected.id,target:n.id})}))selection.value={type:'node',id:n.id}
  }
  function moveNode(id:string,x:number,y:number){const box=scene.value.nodes.find(n=>n.node.id===id);if(!box)return;const cx=x+box.width/2,cy=y+box.height/2;commit(d=>{
    d.presentation.positions[id]={...d.presentation.positions[id],x:Math.max(16,x),y:Math.max(16,y)}
    const node=d.nodes.find(n=>n.id===id)!
    if(d.kind==='swimlane'){const vertical=d.presentation.orientation==='vertical',lanes=scene.value.containers.filter(c=>c.kind==='lane'),phases=scene.value.containers.filter(c=>c.kind==='phase');const lane=lanes.find(l=>vertical?cx>=l.x&&cx<=l.x+l.width:cy>=l.y&&cy<=l.y+l.height);const phase=phases.find(p=>vertical?cy>=p.y&&cy<=p.y+p.height:cx>=p.x&&cx<=p.x+p.width);if(lane)node.laneId=lane.id;if(phase){node.phaseId=phase.id||undefined;node.order=Math.max(0,Math.round(((vertical?cy-phase.y:cx-phase.x)-62)/(vertical?116:224)))}}
    if(d.kind==='architecture'){const group=scene.value.containers.find(c=>c.kind==='layer'&&cy>=c.y&&cy<=c.y+c.height);if(group)node.groupId=group.id}
  })}
  function connect(source:string,target:string){if(source===target){notify('请选择另一个节点作为终点');return false}if(current.value.edges.some(e=>e.source===source&&e.target===target)){notify('这两个节点已经有连线');return false}return commit(d=>d.edges.push({id:newId('edge'),source,target}))}
  function addContainer(type:'lane'|'phase'|'group'){commit(d=>{const list=type==='lane'?d.lanes:type==='phase'?d.phases:d.groups;list.push({id:newId(type),label:`${type==='lane'?'角色':type==='phase'?'阶段':'分层'} ${list.length+1}`})})}
  function renameContainer(type:'lane'|'phase'|'group',id:string,label:string){commit(d=>{const item=(type==='lane'?d.lanes:type==='phase'?d.phases:d.groups).find(x=>x.id===id);if(item)item.label=label})}
  function removeSelection(){const s=selection.value;if(!s)return
    const success=commit(d=>{
      if(s.type==='node'){const removed=new Set([s.id]);if(d.kind==='mindmap'){let size=0;while(size!==removed.size){size=removed.size;d.nodes.filter(n=>n.parentId&&removed.has(n.parentId)).forEach(n=>removed.add(n.id))}}if(d.nodes.length===removed.size)throw new Error('请保留至少一个节点');d.nodes=d.nodes.filter(n=>!removed.has(n.id));d.edges=d.edges.filter(e=>!removed.has(e.source)&&!removed.has(e.target));removed.forEach(id=>{delete d.presentation.positions[id];if(d.presentation.cards)delete d.presentation.cards[id]})}
      else if(s.type==='edge')d.edges=d.edges.filter(e=>e.id!==s.id)
      else {const key=s.type==='lane'?'laneId':s.type==='phase'?'phaseId':'groupId';if(d.nodes.some(n=>n[key]===s.id))throw new Error('请先移动该分组中的节点，再删除分组');const field=s.type==='lane'?'lanes':s.type==='phase'?'phases':'groups';d[field]=d[field].filter(x=>x.id!==s.id)}
    });if(success)selection.value=null
  }
  function deleteDocument(id:string){documents.value=documents.value.filter(d=>d.id!==id);if(!documents.value.length)documents.value.push(blankDocument('swimlane'));if(id===activeId.value)open(documents.value[0].id);persist()}
  if(seedDataflow&&persist())try{localStorage.setItem(DATAFLOW_SEED,'1')}catch{}
  return {documents,activeId,current,scene,selection,storageError,notice,canUndo,canRedo,commit,open,create,addDocument,undo,redo,updateNode,setTitle,setTheme,setOrientation,autoLayout,addNode,moveNode,connect,addContainer,renameContainer,removeSelection,deleteDocument,notify,persist}
})
