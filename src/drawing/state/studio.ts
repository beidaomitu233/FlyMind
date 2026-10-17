import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { copy, newId, validateDocument, type DiagramDocument, type DiagramKind, type DiagramNode, type ThemeName, type Box, type Port } from '../core/model'
import { projectDocument } from '../core/layers'
import { sharedWorkspace } from '../services/shared'
import { duplicateNodes as duplicate, alignNodes, placeNodes,pinScene,vacantPosition, type AlignMode } from '../core/editor'
import { applyOperations, removeNodes, type Collection } from '../core/operations'
import { layoutDocument } from '../core/layout'
import { blankDocument, samples, sampleFor } from '../core/samples'
import { expandGroups,editableSelection,isLocked,assertLockedObjects,freezeNewLocks,groupObjects,ungroupObjects,lockObjects,reorderObjects } from '../core/objects'
import { createFragment,pasteFragment,type SelectionFragment } from '../core/clipboard'
import type { Point } from '../core/model'
import {nodeDimensions} from '../core/render-config'
import {resizeSwimlanePhase} from '../core/phase-editing'
import {floatingTextMetrics} from '../core/floating-text'
const KEY='flymind-drawing-studio-v1'

export type Selection={type:'node'|'edge'|'label'|'lane'|'phase'|'group';id:string}|null
export const useStudio=defineStore('drawing-studio',()=>{
  const documents=ref<DiagramDocument[]>([]),activeId=ref(''),selection=ref<Selection>(null),selectedNodeIds=ref<string[]>([]),storageError=ref(''),notice=ref('')
  const histories=new Map<string,{items:string[];index:number}>(),recoveryRequired=ref(false);let hasLocalState=false
  try{const stored=localStorage.getItem(KEY);if(stored){const data=JSON.parse(stored);if(!Array.isArray(data.documents))throw new Error('存档格式无效');documents.value=data.documents.map(validateDocument);activeId.value=data.activeId;hasLocalState=true}}catch{try{localStorage.setItem(`${KEY}-recovery-${Date.now()}`,localStorage.getItem(KEY)||'');storageError.value='原始存档已备份；可重新导入 JSON 备份继续编辑。'}catch{recoveryRequired.value=true;storageError.value='本地存档未能读取；原始存档仍保留。请先导出当前图形备份。'}}
  if(!hasLocalState)documents.value=copy(samples)
  if(!documents.value.some(d=>d.id===activeId.value))activeId.value=documents.value[0]?.id||''
  const current=computed(()=>documents.value.find(d=>d.id===activeId.value)!),scene=computed(()=>current.value?layoutDocument(current.value):{width:0,height:0,nodes:[],edges:[],containers:[]})
  function history(){let h=histories.get(activeId.value);if(!h){h={items:[JSON.stringify(current.value)],index:0};histories.set(activeId.value,h)}return h}
  const historyVersion=ref(0),canUndo=computed(()=>{historyVersion.value;return !!current.value&&history().index>0}),canRedo=computed(()=>{historyVersion.value;if(!current.value)return false;const h=history();return h.index<h.items.length-1})
  let noticeTimer:ReturnType<typeof setTimeout>
  function notify(message:string){notice.value=message;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>notice.value='',3200)}
  const remote=sharedWorkspace({documents,activeId,current,storageError,notify,reset:()=>{histories.clear();clearSelection();historyVersion.value++}})
  function persist(save=true){if(save&&!current.value)return false;if(save)remote.markDirty(current.value.id);try{if(recoveryRequired.value)throw new Error('原始存档待恢复，当前操作暂留在内存中，请导出备份');localStorage.setItem(KEY,JSON.stringify({documents:documents.value.map(projectDocument),activeId:activeId.value}));if(save&&remote.shared.value)remote.save(current.value);if(!remote.shared.value)storageError.value='';return true}catch(e){storageError.value=(e as Error).message||'保存失败，请导出备份';return false}}
  function commit(change:(d:DiagramDocument)=>void){let d=copy(current.value);try{pinScene(d,scene.value);change(d);d.updatedAt=Date.now();d=validateDocument(d);assertLockedObjects(current.value,d);freezeNewLocks(d,current.value)}catch(e){notify((e as Error).message);return false}const h=history();h.items=h.items.slice(0,h.index+1);h.items.push(JSON.stringify(d));if(h.items.length>60)h.items.shift();h.index=h.items.length-1;documents.value=documents.value.map(x=>x.id===d.id?d:x);historyVersion.value++;persist();return true}
  function clearSelection(){selection.value=null;selectedNodeIds.value=[]}
  function selectMany(ids:string[]){ids=expandGroups(current.value,ids);selectedNodeIds.value=ids;selection.value=ids.length?{type:'node',id:ids.at(-1)!}:null}
  function select(type:NonNullable<Selection>['type'],id:string,additive=false){if(type==='node'){const members=expandGroups(current.value,[id]);if(additive)selectMany(selectedNodeIds.value.includes(id)?selectedNodeIds.value.filter(x=>!members.includes(x)):[...selectedNodeIds.value,...members]);else if(!selectedNodeIds.value.includes(id))selectMany(members);else selection.value={type,id}}else{selectedNodeIds.value=[];selection.value={type,id}}}
  function open(id:string){activeId.value=id;clearSelection();historyVersion.value++;persist(false)}
  function addDocument(d:DiagramDocument){try{const next=validateDocument(d);next.id=newId('diagram');next.updatedAt=Date.now();next.createdAt=next.updatedAt;documents.value.push(next);remote.markNew(next.id);open(next.id);if(remote.shared.value)remote.save(next);return true}catch(e){notify((e as Error).message);return false}}
  function create(kind:DiagramKind,example=false){addDocument(example?sampleFor(kind):blankDocument(kind))}
  function undo(){const h=history();if(h.index<=0)return;h.index--;documents.value=documents.value.map(d=>d.id===activeId.value?JSON.parse(h.items[h.index]):d);clearSelection();historyVersion.value++;persist()}
  function redo(){const h=history();if(h.index>=h.items.length-1)return;h.index++;documents.value=documents.value.map(d=>d.id===activeId.value?JSON.parse(h.items[h.index]):d);clearSelection();historyVersion.value++;persist()}
  function updateNode(id:string,changes:Partial<DiagramNode>){commit(d=>{const node=d.nodes.find(n=>n.id===id);if(node)Object.assign(node,changes)})}
  function setTitle(title:string){if(current.value?.title!==title.trim())commit(d=>{d.title=title.trim()})}
  function setTheme(theme:ThemeName){commit(d=>{d.presentation.theme=theme})}
  function renameDocument(id:string,title:string){if(id===activeId.value){setTitle(title);return}const old=documents.value.find(d=>d.id===id);if(!old||old.title===title.trim())return;try{const next=validateDocument({...copy(old),title:title.trim(),updatedAt:Date.now()});documents.value=documents.value.map(d=>d.id===id?next:d);remote.markDirty(id);persist(false);if(remote.shared.value)remote.save(next)}catch(e){notify((e as Error).message)}}
  function setOrientation(orientation:'vertical'|'horizontal'){commit(d=>{d.presentation.orientation=orientation;Object.assign(d,applyOperations(d,[{op:'reset_layout'}]))})}
  function autoLayout(){if(commit(d=>{d.presentation.positions=Object.fromEntries(Object.entries(d.presentation.positions).filter(([id])=>isLocked(d,id)||d.nodes.some(n=>n.id===id&&n.kind==='note')));d.presentation.ranks=Object.fromEntries(Object.entries(d.presentation.ranks||{}).filter(([id])=>isLocked(d,id)));delete d.presentation.phases;for(const s of Object.values(d.presentation.edges||{})){delete s.points;delete s.sourcePort;delete s.targetPort;delete s.labelPosition}}))notify('已按节点关系重新排布')}
  function resizePhase(id:string,size:number){commit(d=>{resizeSwimlanePhase(d,scene.value,id,size)})}
  function addNode(){const d=current.value,n:DiagramNode={id:newId(),label:d.kind==='architecture'?'新模块':d.kind==='mindmap'?'新主题':'新步骤',kind:d.kind==='architecture'?'module':d.kind==='mindmap'?'topic':'task'}
    const selected=d.nodes.find(n=>n.id===selection.value?.id&&n.kind!=='note')
    if(d.kind==='swimlane'){n.laneId=selection.value?.type==='lane'?selection.value.id:selected?.laneId||d.lanes[0].id;n.phaseId=selection.value?.type==='phase'?selection.value.id:selected?.phaseId||d.phases[0]?.id}
    if(d.kind==='architecture'){n.groupId=selection.value?.type==='group'?selection.value.id:selected?.groupId||d.groups[0].id;n.items=['功能条目']}
    if(d.kind==='mindmap')n.parentId=selected?.id||d.nodes.find(x=>!x.parentId)!.id
    if(d.kind==='dataflow'){n.kind='card';n.label='新卡片';n.description=''}
    const before=scene.value,anchor=before.nodes.find(b=>b.node.id===selected?.id),horizontal=d.presentation.orientation==='horizontal',size=nodeDimensions(d,n),position=vacantPosition(before,{x:anchor?(horizontal?anchor.x+anchor.width+64:anchor.x):80,y:anchor?(horizontal?anchor.y:anchor.y+anchor.height+64):80,width:size.width,height:size.height},horizontal);if(commit(x=>{x.nodes.push(n);x.presentation.positions[n.id]=position;if(selected&&d.kind==='flowchart'&&selected.kind!=='note')x.edges.push({id:newId('edge'),source:selected.id,target:n.id})}))selectMany([n.id])
  }
  function moveNode(id:string,x:number,y:number){if(isLocked(current.value,id)||!scene.value.nodes.some(n=>n.node.id===id))return;commit(d=>placeNodes(d,scene.value,{[id]:{x:Math.max(16,x),y:Math.max(16,y)}}))}
  function addText(point:Point){const n:DiagramNode={id:newId('text'),label:'说明文字',kind:'note'},m=floatingTextMetrics(current.value,n),p=vacantPosition(scene.value,{x:Math.max(16,point.x-40),y:Math.max(16,point.y-17),width:m.width,height:m.height},false,true);if(commit(d=>{d.nodes.push(n);d.presentation.positions[n.id]={x:p.x,y:p.y};(d.presentation.texts??={})[n.id]={fontSize:17}}))selectMany([n.id])}
  function moveNodes(boxes:Record<string,Partial<Box>>){const next=Object.fromEntries(Object.entries(boxes).filter(([id])=>!isLocked(current.value,id)));if(Object.keys(next).length)commit(d=>placeNodes(d,scene.value,next))}
  function duplicateNodes(){const ids=selectedNodeIds.value.length?selectedNodeIds.value:selection.value?.type==='node'?[selection.value.id]:[];if(!ids.length)return;let next:string[]=[];if(commit(d=>{next=duplicate(d,scene.value,ids)}))selectMany(next)}
  function align(mode:AlignMode){commit(d=>alignNodes(d,scene.value,selectedNodeIds.value,mode))}
  function fragment(){return createFragment(current.value,scene.value,selectedNodeIds.value)}
  function paste(fragment:SelectionFragment,point:Point){let ids:string[]=[];if(commit(d=>{ids=pasteFragment(d,fragment,point,selection.value?.type==='node'?selection.value.id:undefined)})){selectMany(ids);return ids}return []}
  function groupSelection(){if(commit(d=>groupObjects(d,selectedNodeIds.value)))selectMany(selectedNodeIds.value)}
  function ungroupSelection(){commit(d=>ungroupObjects(d,selectedNodeIds.value))}
  function lockSelection(lock:boolean){commit(d=>lockObjects(d,scene.value,selectedNodeIds.value,lock))}
  function reorderSelection(direction:'front'|'back'|'forward'|'backward'){commit(d=>reorderObjects(d,selectedNodeIds.value,direction))}
  function connect(source:string,target:string,sourcePort?:Port,targetPort?:Port){if(source===target){notify('请选择另一个节点作为终点');return false}if(current.value.edges.some(e=>e.source===source&&e.target===target)){notify('这两个节点已经有连线');return false}const id=newId('edge');return commit(d=>{d.edges.push({id,source,target});if(sourcePort||targetPort)(d.presentation.edges??={})[id]={sourcePort,targetPort}})}
  function containerOp(collection:Collection,id:string,index?:number,moveTo?:string){const ok=commit(d=>Object.assign(d,applyOperations(d,index===undefined?[{op:'remove_container',collection,id,moveTo}]:[{op:'reorder_container',collection,id,index}])));if(ok)clearSelection()}
  function addContainer(type:'lane'|'phase'|'group'){commit(d=>{const list=type==='lane'?d.lanes:type==='phase'?d.phases:d.groups;list.push({id:newId(type),label:`${type==='lane'?'角色':type==='phase'?'阶段':'分层'} ${list.length+1}`})})}
  function renameContainer(type:'lane'|'phase'|'group',id:string,label:string){commit(d=>{const item=(type==='lane'?d.lanes:type==='phase'?d.phases:d.groups).find(x=>x.id===id);if(item)item.label=label})}
  function removeSelection(){const s=selection.value;if(!s)return false
    const success=commit(d=>{
      if(s.type==='node'){const ids=editableSelection(d,selectedNodeIds.value.length?selectedNodeIds.value:[s.id]);if(!ids.length)throw new Error('请先解锁所选节点');removeNodes(d,ids)}
      else if(s.type==='label'){const edge=d.edges.find(e=>e.id===s.id);if(edge)delete edge.label;if(d.presentation.edges?.[s.id])delete d.presentation.edges[s.id].labelPosition}
      else if(s.type==='edge'){d.edges=d.edges.filter(e=>e.id!==s.id);if(d.presentation.edges)delete d.presentation.edges[s.id]}
      else {const key=s.type==='lane'?'laneId':s.type==='phase'?'phaseId':'groupId';if(d.nodes.some(n=>n[key]===s.id))throw new Error('请先移动该分组中的节点，再删除分组');const field=s.type==='lane'?'lanes':s.type==='phase'?'phases':'groups';d[field]=d[field].filter(x=>x.id!==s.id)}
    });if(success)clearSelection();return success
  }
  function deleteDocument(id:string){remote.remove(id);documents.value=documents.value.filter(d=>d.id!==id);histories.delete(id);if(id===activeId.value)activeId.value=documents.value[0]?.id||'';clearSelection();historyVersion.value++;persist(false)}
  return {...remote,documents,activeId,current,scene,selection,selectedNodeIds,storageError,notice,canUndo,canRedo,commit,open,create,addDocument,undo,redo,updateNode,setTitle,renameDocument,setTheme,setOrientation,autoLayout,resizePhase,addNode,addText,moveNode,moveNodes,duplicateNodes,align,fragment,paste,groupSelection,ungroupSelection,lockSelection,reorderSelection,connect,addContainer,renameContainer,containerOp,select,selectMany,clearSelection,removeSelection,deleteDocument,notify,persist}
})
