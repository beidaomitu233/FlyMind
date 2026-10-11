import { copy, validateDocument, type DiagramDocument, type DiagramNode, type DiagramEdge, type DiagramLane, type DiagramPhase, type DiagramGroup, type Box, type NodeStyle, type CardStyle, type EdgeStyle, type ThemeName } from './model'
export type Collection='lanes'|'phases'|'groups'
export type DiagramOperation=
  |{op:'add_node';node:DiagramNode;position?:Partial<Box>;style?:NodeStyle}
  |{op:'update_node';id:string;changes:Partial<Omit<DiagramNode,'id'>>}
  |{op:'remove_node';id:string}
  |{op:'add_edge';edge:DiagramEdge;style?:EdgeStyle}
  |{op:'update_edge';id:string;changes:Partial<Omit<DiagramEdge,'id'>>}
  |{op:'remove_edge';id:string}
  |{op:'set_node_presentation';id:string;position?:Partial<Box>;style?:NodeStyle;card?:CardStyle}
  |{op:'set_edge_presentation';id:string;style:EdgeStyle}
  |{op:'add_container';collection:Collection;item:DiagramLane|DiagramPhase|DiagramGroup;index?:number}
  |{op:'update_container';collection:Collection;id:string;changes:Partial<DiagramGroup>}
  |{op:'remove_container';collection:Collection;id:string;moveTo?:string}
  |{op:'reorder_container';collection:Collection;id:string;index:number}
  |{op:'set_title';title:string}|{op:'set_theme';theme:ThemeName}|{op:'reset_layout'}
function exists<T extends {id:string}>(list:T[],id:string){const item=list.find(x=>x.id===id);if(!item)throw new Error(`对象 ${id} 不存在`);return item}
function resetRoutes(d:DiagramDocument){for(const s of Object.values(d.presentation.edges||{})){delete s.points;delete s.sourcePort;delete s.targetPort;delete s.labelPosition}}
export function removeNodes(d:DiagramDocument,ids:string[]){
  const removed=new Set(ids);if(d.kind==='mindmap'){let count=0;while(count!==removed.size){count=removed.size;d.nodes.filter(n=>n.parentId&&removed.has(n.parentId)).forEach(n=>removed.add(n.id))}}
  if(d.nodes.every(n=>removed.has(n.id)))throw new Error('请保留至少一个节点')
  d.nodes=d.nodes.filter(n=>!removed.has(n.id));const edges=d.edges.filter(e=>removed.has(e.source)||removed.has(e.target));d.edges=d.edges.filter(e=>!edges.includes(e))
  for(const id of removed){delete d.presentation.positions[id];if(d.presentation.styles)delete d.presentation.styles[id];if(d.presentation.cards)delete d.presentation.cards[id]}
  edges.forEach(e=>{if(d.presentation.edges)delete d.presentation.edges[e.id]})
}
export function applyOperations(input:DiagramDocument,ops:DiagramOperation[]):DiagramDocument {
  const d=copy(input)
  if(!Array.isArray(ops)||!ops.length||ops.length>500)throw new Error('一次修改需要 1–500 个操作')
  for(const o of ops){switch(o.op){
    case 'add_node':d.nodes.push(copy(o.node));if(o.position)d.presentation.positions[o.node.id]=copy(o.position);if(o.style)(d.presentation.styles??={})[o.node.id]=copy(o.style);break
    case 'update_node':Object.assign(exists(d.nodes,o.id),o.changes,{id:o.id});if(['laneId','phaseId','groupId','parentId','order','kind'].some(k=>Object.hasOwn(o.changes,k)))delete d.presentation.positions[o.id];break
    case 'remove_node':exists(d.nodes,o.id);removeNodes(d,[o.id]);break
    case 'add_edge':d.edges.push(copy(o.edge));if(o.style)(d.presentation.edges??={})[o.edge.id]=copy(o.style);break
    case 'update_edge':Object.assign(exists(d.edges,o.id),o.changes,{id:o.id});break
    case 'remove_edge':exists(d.edges,o.id);d.edges=d.edges.filter(e=>e.id!==o.id);if(d.presentation.edges)delete d.presentation.edges[o.id];break
    case 'set_node_presentation':exists(d.nodes,o.id);if(o.position)d.presentation.positions[o.id]={...d.presentation.positions[o.id],...o.position};if(o.style)(d.presentation.styles??={})[o.id]={...d.presentation.styles?.[o.id],...o.style};if(o.card)(d.presentation.cards??={})[o.id]={...d.presentation.cards?.[o.id],...o.card};break
    case 'set_edge_presentation':exists(d.edges,o.id);(d.presentation.edges??={})[o.id]={...d.presentation.edges?.[o.id],...o.style};break
    case 'add_container':d[o.collection].splice(o.index??d[o.collection].length,0,copy(o.item));break
    case 'update_container':Object.assign(exists(d[o.collection],o.id),o.changes,{id:o.id});break
    case 'reorder_container':{const item=exists(d[o.collection],o.id);if(!Number.isInteger(o.index)||o.index<0||o.index>=d[o.collection].length)throw new Error('分组顺序无效');d[o.collection]=d[o.collection].filter(x=>x.id!==o.id);d[o.collection].splice(o.index,0,item);d.presentation.positions={};resetRoutes(d);break}
    case 'remove_container':{
      exists(d[o.collection],o.id);const key=o.collection==='lanes'?'laneId':o.collection==='phases'?'phaseId':'groupId',members=d.nodes.filter(n=>n[key]===o.id)
      if(members.length&&!o.moveTo)throw new Error('分组中还有节点，请指定 moveTo 迁移节点')
      if(o.moveTo){if(o.moveTo===o.id)throw new Error('迁移目标不能是当前分组');exists(d[o.collection],o.moveTo);members.forEach(n=>{n[key]=o.moveTo;delete d.presentation.positions[n.id]})}
      d[o.collection]=d[o.collection].filter(x=>x.id!==o.id);d.presentation.positions={};resetRoutes(d);break
    }
    case 'set_title':d.title=o.title;break
    case 'set_theme':d.presentation.theme=o.theme;break
    case 'reset_layout':d.presentation.positions={};resetRoutes(d);break
    default:throw new Error('不支持的修改操作')
  }}
  d.updatedAt=Date.now();return validateDocument(d)
}
