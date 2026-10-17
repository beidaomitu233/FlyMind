import type {DiagramContent} from '../../src/drawing/core/model'
import type {DiagramOperation} from '../../src/drawing/core/operations'
import {canonicalContentJson} from '../../src/drawing/engine/content-hash'
import {StoreError} from '../store'

const equal=(a:unknown,b:unknown)=>canonicalContentJson(a as any)===canonicalContentJson(b as any)
function changes(before:Record<string,any>,after:Record<string,any>){const result:Record<string,any>={};for(const k of new Set([...Object.keys(before),...Object.keys(after)]))if(k!=='id'&&!equal(before[k]??null,after[k]??null))result[k]=Object.hasOwn(after,k)?after[k]:null;return result}

/** Stable business IDs drive local XML patching; full update never recompiles. */
export function diffNativeContent(before:DiagramContent,next:DiagramContent):DiagramOperation[]{
  if(next.id!==before.id||next.kind!==before.kind)throw new StoreError('完整更新不能改变图形 ID 或 kind',400,undefined,'CONTENT_IDENTITY_MISMATCH')
  const operations:DiagramOperation[]=[]
  for(const collection of ['lanes','phases','groups'] as const)for(const item of next[collection])if(!before[collection].some(x=>x.id===item.id))operations.push({op:'add_container',collection,item})
  for(const node of next.nodes)if(!before.nodes.some(x=>x.id===node.id))operations.push({op:'add_node',node})
  for(const node of next.nodes){const old=before.nodes.find(x=>x.id===node.id);if(old){const update=changes(old,node);if(Object.keys(update).length)operations.push({op:'update_node',id:node.id,changes:update})}}
  // Reconnect retained edges before node deletion, otherwise remove_node would
  // legitimately delete the old incident edge before its identity can be reused.
  for(const edge of next.edges){const old=before.edges.find(x=>x.id===edge.id);if(old){const update=changes(old,edge);if(Object.keys(update).length)operations.push({op:'update_edge',id:edge.id,changes:update})}}
  for(const edge of before.edges)if(!next.edges.some(x=>x.id===edge.id))operations.push({op:'remove_edge',id:edge.id})
  for(const edge of next.edges)if(!before.edges.some(x=>x.id===edge.id))operations.push({op:'add_edge',edge})
  for(const node of before.nodes)if(!next.nodes.some(x=>x.id===node.id))operations.push({op:'remove_node',id:node.id})
  for(const collection of ['lanes','phases','groups'] as const){
    for(const item of before[collection])if(!next[collection].some(x=>x.id===item.id))operations.push({op:'remove_container',collection,id:item.id})
    for(const item of next[collection]){const old=before[collection].find(x=>x.id===item.id);if(old){const update=changes(old,item);if(Object.keys(update).length)operations.push({op:'update_container',collection,id:item.id,changes:update})}}
    const order=[...before[collection].filter(old=>next[collection].some(item=>item.id===old.id)),...next[collection].filter(item=>!before[collection].some(old=>old.id===item.id))].map(x=>x.id)
    next[collection].forEach((item,index)=>{const from=order.indexOf(item.id);if(from!==index){operations.push({op:'reorder_container',collection,id:item.id,index});order.splice(from,1);order.splice(index,0,item.id)}})
  }
  if(next.title!==before.title)operations.push({op:'set_title',title:next.title})
  if(operations.length>500)throw new StoreError('完整更新需要超过500项增量操作，请分批修改',400,undefined,'TOO_MANY_OPERATIONS')
  return operations
}
