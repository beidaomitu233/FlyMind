import { copy, validateDocument, type DiagramDocument, type DiagramNode, type DiagramEdge, type DiagramLane, type DiagramPhase, type DiagramGroup, type Box, type NodeStyle, type CardStyle, type EdgeStyle, type ThemeName } from './model'
export type Collection='lanes'|'phases'|'groups'
/** null is an update command for optional fields; persisted content omits them. */
export type ContentChanges<T> = { [K in keyof T]?: undefined extends T[K] ? T[K] | null : T[K] }
export type DiagramOperation=
  |{op:'add_node';node:DiagramNode;position?:Partial<Box>;style?:NodeStyle}
  |{op:'update_node';id:string;changes:ContentChanges<Omit<DiagramNode,'id'>>}
  |{op:'remove_node';id:string}
  |{op:'add_edge';edge:DiagramEdge;style?:EdgeStyle}
  |{op:'update_edge';id:string;changes:ContentChanges<Omit<DiagramEdge,'id'>>}
  |{op:'remove_edge';id:string}
  |{op:'set_node_presentation';id:string;position?:Partial<Box>;style?:NodeStyle;card?:CardStyle}
  |{op:'set_edge_presentation';id:string;style:EdgeStyle}
  |{op:'add_container';collection:Collection;item:DiagramLane|DiagramPhase|DiagramGroup;index?:number}
  |{op:'update_container';collection:Collection;id:string;changes:ContentChanges<Omit<DiagramGroup,'id'>>}
  |{op:'remove_container';collection:Collection;id:string;moveTo?:string}
  |{op:'reorder_container';collection:Collection;id:string;index:number}
  |{op:'set_title';title:string}|{op:'set_theme';theme:ThemeName}|{op:'reset_layout'}
function exists<T extends {id:string}>(list:T[],id:string){const item=list.find(x=>x.id===id);if(!item)throw new Error(`对象 ${id} 不存在`);return item}
function applyChanges(target:object,changes:object,required:string[],optional:string[]){
  if(!changes||typeof changes!=='object'||Array.isArray(changes))throw new Error('修改字段应为对象')
  for(const [key,value] of Object.entries(changes)){
    if(!required.includes(key)&&!optional.includes(key))throw new Error(`不支持的修改字段 ${key}`)
    if(value===null||value===undefined){if(required.includes(key))throw new Error(`必填字段 ${key} 不能清除`);delete (target as any)[key]}
    else (target as any)[key]=value
  }
}
function assertNoNullFields(value:object){if(Object.values(value).some(v=>v===null))throw new Error('内容字段不接受 null；仅 update 操作可用 null 清除可选字段')}
function resetRoutes(d:DiagramDocument){for(const s of Object.values(d.presentation.edges||{})){delete s.points;delete s.sourcePort;delete s.targetPort;delete s.labelPosition}}
export function removeNodes(d:DiagramDocument,ids:string[]){
  const removed=new Set(ids);if(d.kind==='mindmap'){let count=0;while(count!==removed.size){count=removed.size;d.nodes.filter(n=>n.parentId&&removed.has(n.parentId)).forEach(n=>removed.add(n.id))}}
  if(d.nodes.every(n=>removed.has(n.id)))throw new Error('请保留至少一个节点')
  d.nodes=d.nodes.filter(n=>!removed.has(n.id));const edges=d.edges.filter(e=>removed.has(e.source)||removed.has(e.target));d.edges=d.edges.filter(e=>!edges.includes(e))
  for(const id of removed){delete d.presentation.positions[id];if(d.presentation.ranks)delete d.presentation.ranks[id];if(d.presentation.styles)delete d.presentation.styles[id];if(d.presentation.cards)delete d.presentation.cards[id];if(d.presentation.texts)delete d.presentation.texts[id]}
  edges.forEach(e=>{if(d.presentation.edges)delete d.presentation.edges[e.id]})
}
export function applyOperations(input:DiagramDocument,ops:DiagramOperation[]):DiagramDocument {
  const d=copy(input)
  if(!Array.isArray(ops)||!ops.length||ops.length>500)throw new Error('一次修改需要 1–500 个操作')
  for(const o of ops){switch(o.op){
    case 'add_node':assertNoNullFields(o.node);d.nodes.push(copy(o.node));if(o.position)d.presentation.positions[o.node.id]=copy(o.position);if(o.style)(d.presentation.styles??={})[o.node.id]=copy(o.style);break
    case 'update_node':applyChanges(exists(d.nodes,o.id),o.changes,['label','kind'],['laneId','phaseId','groupId','parentId','color','description','items','badge']);if(['laneId','phaseId','groupId','parentId','kind'].some(k=>Object.hasOwn(o.changes,k)))delete d.presentation.positions[o.id];break
    case 'remove_node':exists(d.nodes,o.id);removeNodes(d,[o.id]);break
    case 'add_edge':assertNoNullFields(o.edge);d.edges.push(copy(o.edge));if(o.style)(d.presentation.edges??={})[o.edge.id]=copy(o.style);break
    case 'update_edge':applyChanges(exists(d.edges,o.id),o.changes,['source','target'],['label','kind']);break
    case 'remove_edge':exists(d.edges,o.id);d.edges=d.edges.filter(e=>e.id!==o.id);if(d.presentation.edges)delete d.presentation.edges[o.id];break
    case 'set_node_presentation':exists(d.nodes,o.id);if(o.position)d.presentation.positions[o.id]={...d.presentation.positions[o.id],...o.position};if(o.style)(d.presentation.styles??={})[o.id]={...d.presentation.styles?.[o.id],...o.style};if(o.card)(d.presentation.cards??={})[o.id]={...d.presentation.cards?.[o.id],...o.card};break
    case 'set_edge_presentation':exists(d.edges,o.id);(d.presentation.edges??={})[o.id]={...d.presentation.edges?.[o.id],...o.style};break
    case 'add_container':assertNoNullFields(o.item);d[o.collection].splice(o.index??d[o.collection].length,0,copy(o.item));break
    case 'update_container':applyChanges(exists(d[o.collection],o.id),o.changes,['label'],o.collection==='groups'?['kind','color']:[]);break
    case 'reorder_container':{const item=exists(d[o.collection],o.id);if(!Number.isInteger(o.index)||o.index<0||o.index>=d[o.collection].length)throw new Error('分组顺序无效');d[o.collection]=d[o.collection].filter(x=>x.id!==o.id);d[o.collection].splice(o.index,0,item);d.presentation.positions={};resetRoutes(d);break}
    case 'remove_container':{
      exists(d[o.collection],o.id);const key=o.collection==='lanes'?'laneId':o.collection==='phases'?'phaseId':'groupId',members=d.nodes.filter(n=>n[key]===o.id)
      if(members.length&&!o.moveTo)throw new Error('分组中还有节点，请指定 moveTo 迁移节点')
      if(o.moveTo){if(o.moveTo===o.id)throw new Error('迁移目标不能是当前分组');exists(d[o.collection],o.moveTo);members.forEach(n=>{n[key]=o.moveTo;delete d.presentation.positions[n.id]})}
      d[o.collection]=d[o.collection].filter(x=>x.id!==o.id);d.presentation.positions={};resetRoutes(d);break
    }
    case 'set_title':d.title=o.title;break
    case 'set_theme':d.presentation.theme=o.theme;break
    case 'reset_layout':d.presentation.positions=Object.fromEntries(Object.entries(d.presentation.positions).filter(([id])=>d.nodes.some(n=>n.id===id&&n.kind==='note')));d.presentation.ranks={};delete d.presentation.phases;resetRoutes(d);break
    default:throw new Error('不支持的修改操作')
  }}
  d.updatedAt=Date.now();return validateDocument(d)
}
