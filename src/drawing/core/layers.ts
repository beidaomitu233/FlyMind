import { copy, newId, validateDocument, type DiagramContent, type DiagramDocument } from './model'
import { defaultRendering, type RenderingConfig } from './render-config'
import { applyOperations, type DiagramOperation } from './operations'
import { assertLockedObjects } from './objects'

const contentKeys=['schemaVersion','id','title','kind','nodes','edges','lanes','phases','groups']
const nodeKeys=['id','label','kind','color','description','items','badge','laneId','phaseId','groupId','parentId']
const edgeKeys=['id','source','target','label','kind']
const groupKeys=['id','label','kind','color']
function checkKeys(value:unknown,allowed:string[],name:string,rendering=false){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${name}应为对象`)
  for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error(rendering?`${name}的 ${key} 不属于渲染层；业务内容请使用内容编辑入口`:`${name}的 ${key} 不属于内容层；坐标、布局行、尺寸、形状、字体、图标和线型请交给渲染层`)
}
export function extractContent(d:DiagramDocument):DiagramContent {
  return copy(Object.fromEntries(contentKeys.map(k=>[k,(d as any)[k]]))) as DiagramContent
}
export function validateContent(input:unknown):DiagramContent {
  checkKeys(input,contentKeys,'图形内容')
  const raw=copy(input) as any;raw.schemaVersion??=1;raw.id??=newId('diagram')
  if(typeof raw.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(raw.id))throw new Error('图形 ID 仅支持 1–100 位字母、数字、下划线、短横线')
  if(Array.isArray(raw.nodes))raw.nodes.forEach((n:unknown)=>checkKeys(n,nodeKeys,'节点'))
  for(const key of ['edges','lanes','phases','groups']){raw[key]??=[];if(Array.isArray(raw[key]))raw[key].forEach((x:unknown)=>checkKeys(x,key==='edges'?edgeKeys:key==='groups'?groupKeys:['id','label'],key))}
  return extractContent(validateDocument({...raw,presentation:defaultRendering(raw.kind),updatedAt:Date.now()}))
}
export function composeDocument(content:unknown,rendering?:RenderingConfig):DiagramDocument {
  const c=validateContent(content)
  return validateDocument({...c,presentation:rendering?copy(rendering):defaultRendering(c.kind),updatedAt:Date.now()})
}
export function replaceContent(d:DiagramDocument,input:unknown):DiagramDocument {
  const c=validateContent(input),rendering=copy(d.presentation)
  if(c.kind!==d.kind){const next=composeDocument({...c,id:d.id});assertLockedObjects(d,next,false);return next}
  for(const n of c.nodes){const old=d.nodes.find(x=>x.id===n.id);if(old&&['laneId','phaseId','groupId','parentId'].some(k=>(old as any)[k]!== (n as any)[k]))delete rendering.positions[n.id]}
  const next=composeDocument({...c,id:d.id},rendering);assertLockedObjects(d,next,false);return next
}
export function projectDocument(d:DiagramDocument){return {schemaVersion:2 as const,content:extractContent(d),rendering:copy(d.presentation),updatedAt:d.updatedAt,...(d.createdAt!==undefined?{createdAt:d.createdAt}:{})}}
export function applyContentOperations(d:DiagramDocument,operations:unknown):DiagramDocument {
  if(!Array.isArray(operations)||!operations.length||operations.length>500)throw new Error('需要 1–500 个内容操作')
  const parameters:Record<string,string[]>={add_node:['node'],update_node:['id','changes'],remove_node:['id'],add_edge:['edge'],update_edge:['id','changes'],remove_edge:['id'],add_container:['collection','item','index'],update_container:['collection','id','changes'],remove_container:['collection','id','moveTo'],reorder_container:['collection','id','index'],set_title:['title']}
  for(const o of operations){if(!o||!parameters[o.op])throw new Error('内容修改工具不接受渲染操作，请使用 configure_rendering');checkKeys(o,['op',...parameters[o.op]],'内容操作');if(o.collection&&!['lanes','phases','groups'].includes(o.collection))throw new Error('容器类型无效');if(o.node)checkKeys(o.node,nodeKeys,'节点');if(o.edge)checkKeys(o.edge,edgeKeys,'连接');if(o.changes)checkKeys(o.changes,o.op==='update_node'?nodeKeys.filter(k=>k!=='id'):o.op==='update_edge'?edgeKeys.filter(k=>k!=='id'):o.collection==='groups'?groupKeys.filter(k=>k!=='id'):['label'],'修改字段');if(o.item)checkKeys(o.item,o.collection==='groups'?groupKeys:['id','label'],'容器')}
  const result=applyOperations(d,operations as DiagramOperation[])
  validateContent(extractContent(result));assertLockedObjects(d,result,false);return result
}
export function replaceRendering(d:DiagramDocument,input:unknown):DiagramDocument {
  checkKeys(input,['theme','orientation','nodeDefaults','edgeDefaults','positions','ranks','groups','cards','styles','edges','objects'],'渲染配置',true)
  const config=copy(input) as RenderingConfig
  if(config.theme&&!['blue','indigo','forest'].includes(config.theme))throw new Error('主题无效')
  if(config.orientation&&!['vertical','horizontal'].includes(config.orientation))throw new Error('方向无效')
  for(const [name,fields] of Object.entries({nodeDefaults:['width','height','fontSize','shape','fill','stroke','textColor'],edgeDefaults:['route','color','width','arrow','dashed'],positions:['x','y','width','height'],groups:['tone','columns'],cards:['icon','tone','variant'],styles:['fill','stroke','textColor','fontSize','shape'],edges:['color','width','sourcePort','targetPort','points','labelPosition','arrow','dashed','route']})){
    const value=(config as any)[name];if(value===undefined)continue
    if(name==='edgeDefaults')checkKeys(value,fields,name,true)
    else {if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${name} 应为对象`);for(const entry of Object.values(value))checkKeys(entry,fields,name,true)}
  }
  return composeDocument(extractContent(d),{...defaultRendering(d.kind),...config})
}
