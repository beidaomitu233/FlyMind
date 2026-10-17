import type {DrawingProjectV3,DrawioProjectionResult,ProjectionDiagnostic} from '../types'
import {DRAWIO_ADAPTER_VERSION} from '../constants'
import {projectDrawio} from './index'
import {attr,fail,parseNative,serialize,type NativeCell} from './xml'
import {ancestorIntersection,assertNativeLocks,baseState,businessKey,businessType,mainEntries,primary,removeEntry,unlocked} from './state'
import {restoreControlledAcknowledgements,rebindControlledCopies,normalizeControlledDeletions} from './controlled'

const kinds=new Set(['task','decision','start','end','module','topic','card','note'])
function fresh(type:string,used:Set<string>){let id:string;do{id=`${type}_${globalThis.crypto.randomUUID().replaceAll('-','')}`}while(used.has(id));used.add(id);return id}
/** Normalize explicit native editing intent before applying strict projection. */
export async function normalizeDrawioEdits(xml:string,input:DrawingProjectV3):Promise<DrawioProjectionResult>{
  const {base,content,native:original}=await baseState(input),native=parseNative(xml,{allowDanglingEdgeEndpoints:true}),diagnostics:ProjectionDiagnostic[]=[]
  // A late user snapshot may predate the metadata acknowledgement from the
  // previous save. Native cell identity is authoritative for confirmed IDs;
  // never merge an older document's labels, geometry or endpoints into it.
  for(const previous of mainEntries(original)){
    const incoming=native.cells.get(previous.id)
    if(!incoming)continue
    const type=attr(incoming.object,'fmType'),oldType=businessType(previous)
    if(type&&businessType(incoming)!==oldType)fail('IDENTITY_CHANGED','已确认业务对象不能隐式转成其他类型')
    const oldId=attr(previous.object,'fmId')!
    if(attr(incoming.object,'fmId')!==oldId)diagnostics.push({code:'CONFIRMED_ID_RESTORED',message:'按原生 cell 身份恢复已确认的业务 ID，保留本轮编辑正文',cellId:incoming.id,businessId:oldId})
    for(const key of ['fmId','fmType','fmRole','fmAdapter','fmIndex']){const value=attr(previous.object,key);if(value!==undefined)incoming.object.setAttribute(key,value)}
    if(!incoming.object.hasAttribute('fmKind')&&previous.object.hasAttribute('fmKind'))incoming.object.setAttribute('fmKind',attr(previous.object,'fmKind')!)
    if(!incoming.object.hasAttribute('fmLabelPresent')&&previous.object.hasAttribute('fmLabelPresent'))incoming.object.setAttribute('fmLabelPresent',attr(previous.object,'fmLabelPresent')!)
  }
  restoreControlledAcknowledgements(native,original);assertNativeLocks(native,original,true)
  const oldByKey=new Map(mainEntries(original).map(e=>[businessKey(businessType(e)!,attr(e.object,'fmId')!),e]))
  const used=new Map<string,Set<string>>(),maxIndex=new Map<string,number>()
  for(const entry of mainEntries(native)){const type=businessType(entry)!,id=attr(entry.object,'fmId');if(id){const set=used.get(type)??new Set();set.add(id);used.set(type,set)}}
  for(const [type,list] of [['node',content.nodes],['edge',content.edges],['lane',content.lanes],['phase',content.phases],['layer',content.groups]] as const){maxIndex.set(type,Math.max(list.length,...mainEntries(original).filter(e=>businessType(e)===type).map(e=>Number(attr(e.object,'fmIndex')??0)+1)));const set=used.get(type)??new Set();for(const item of list)set.add(item.id);used.set(type,set)}
  const nextIndex=(type:string)=>{const value=maxIndex.get(type)??0;maxIndex.set(type,value+1);return value}
  const occupiedIndices=new Map<string,Set<number>>();for(const e of mainEntries(original)){const type=businessType(e)!,set=occupiedIndices.get(type)??new Set<number>();set.add(Number(attr(e.object,'fmIndex')));occupiedIndices.set(type,set)}
  const seen=new Set<string>(),nodeByCell=new Map<string,NativeCell>()
  for(const entry of mainEntries(original)){
    const incoming=native.cells.get(entry.id)
    if(incoming&&(!primary(incoming)||businessType(incoming)!==businessType(entry)||attr(incoming.object,'fmId')!==attr(entry.object,'fmId')))fail('IDENTITY_CHANGED','原业务 cell 的稳定身份被改变，不能猜测替代关系')
  }
  // Real cell IDs identify originals. A clone keeps its own native endpoints,
  // receives a fresh business ID, and cannot overwrite the original binding.
  for(const entry of mainEntries(native)){
    const type=businessType(entry)!,kind=attr(entry.object,'fmKind'),oldId=attr(entry.object,'fmId'),previous=oldId?oldByKey.get(businessKey(type,oldId)):undefined
    if(type==='node'&&!kinds.has(kind??''))fail('MISSING_BUSINESS_KIND','新业务节点须声明受支持的 fmKind')
    if(!['node','edge','lane','phase','layer'].includes(type))fail('UNKNOWN_BINDING','未知业务类型')
    const isOriginal=previous?.id===entry.id
    if(!isOriginal&&attr(entry.object,'fmAdapter')!==undefined&&attr(entry.object,'fmAdapter')!==DRAWIO_ADAPTER_VERSION)fail('UNSUPPORTED_ADAPTER','新对象绑定版本不支持')
    let id=oldId
    if(!id||previous&&!isOriginal||id&&seen.has(businessKey(type,id))){
      if(type==='lane'||type==='phase'||type==='layer')fail('AMBIGUOUS_CONTAINER_COPY','暂不推断复制角色或阶段的业务含义')
      id=fresh(type,used.get(type)??new Set());entry.object.setAttribute('fmId',id)
      diagnostics.push({code:oldId?'COPY_ID_ASSIGNED':'BUSINESS_ID_ASSIGNED',message:oldId?'已为原生副本分配新业务身份':'已为显式业务节点分配身份',cellId:entry.id,businessId:id})
    }
    if(isOriginal){const list=type==='node'?content.nodes:type==='edge'?content.edges:type==='lane'?content.lanes:type==='layer'?content.groups:content.phases;entry.object.setAttribute('fmIndex',attr(previous!.object,'fmIndex')??String(list.findIndex(x=>x.id===id)))}else{const restored=Number(attr(entry.object,'fmIndex')),indices=occupiedIndices.get(type)??new Set<number>(),useRestored=!!oldId&&!previous&&attr(entry.object,'fmAdapter')===DRAWIO_ADAPTER_VERSION&&attr(entry.object,'fmIndex')!==undefined&&Number.isInteger(restored)&&restored>=0&&!indices.has(restored),index=useRestored?restored:nextIndex(type);entry.object.setAttribute('fmIndex',String(index));indices.add(index);occupiedIndices.set(type,indices)}
    seen.add(businessKey(type,id!));entry.object.setAttribute('fmAdapter',DRAWIO_ADAPTER_VERSION);entry.object.setAttribute('fmRole','main')
    if(type==='node'){
      entry.object.setAttribute('fmType',kind==='note'?'annotation':'node')
      const intersection=ancestorIntersection(native,entry)
      if(content.kind==='swimlane'&&!intersection&&kind!=='note')fail('UNASSIGNED_NODE','新建或移动业务节点须进入明确交叉容器')
      if(content.kind==='architecture'&&kind!=='note'){let parent=attr(entry.cell,'parent'),layer:NativeCell|undefined;while(parent){const p=native.cells.get(parent)!;if(businessType(p)==='layer'){layer=p;break}parent=attr(p.cell,'parent')}if(!layer)fail('UNASSIGNED_NODE','架构模块须进入明确分层');entry.object.setAttribute('fmGroupId',attr(layer.object,'fmId')!)}
      if(content.kind==='swimlane'&&intersection){for(const field of ['fmLaneId','fmPhaseId']){const value=attr(intersection.object,field);if(value)entry.object.setAttribute(field,value);else entry.object.removeAttribute(field)}}
      nodeByCell.set(entry.id,entry)
    }
  }
  const removed=new Set(mainEntries(original).filter(e=>businessType(e)==='node'&&!native.cells.has(e.id)).map(e=>e.id))

  for(const entry of [...native.cells.values()])if(attr(entry.cell,'edge')==='1'){
    const source=attr(entry.cell,'source'),target=attr(entry.cell,'target'),previous=original.cells.get(entry.id)
    const missing=(['source','target'] as const).filter(key=>{const ref=attr(entry.cell,key);return !ref||!native.cells.has(ref)})
    if(missing.length){
      const deletedIncident=missing.every(key=>{const ref=attr(entry.cell,key),oldRef=previous?attr(previous.cell,key):undefined;return !!(ref&&removed.has(ref)||!ref&&oldRef&&removed.has(oldRef))})
      if(deletedIncident)fail('NATIVE_DELETE_INCOMPLETE','原生Delete保留了关联悬空线；请原生撤销后使用Ctrl+Delete删除节点及关联线，草稿已保留')
      if(attr(entry.object,'fmType')==='edge'||source&&nodeByCell.has(source)||target&&nodeByCell.has(target))fail('DISCONNECTED_BUSINESS_EDGE','业务边断开或端点缺失，保留为待恢复草稿')
      if(source&&!native.cells.has(source)||target&&!native.cells.has(target))fail('BROKEN_REFERENCE','原生连线引用不存在')
      continue
    }
    if(content.kind==='mindmap'&&attr(entry.object,'fmRole')==='parent-edge'){const child=target?nodeByCell.get(target):undefined,parent=source?nodeByCell.get(source):undefined;if(!child||!parent)fail('DISCONNECTED_PARENT_EDGE','脑图父子线端点不完整');entry.object.setAttribute('fmChildId',attr(child.object,'fmId')!);child.object.setAttribute('fmParentId',attr(parent.object,'fmId')!)}
    if(!attr(entry.object,'fmType')&&source&&target&&nodeByCell.has(source)&&nodeByCell.has(target)){
      const id=fresh('edge',used.get('edge')!);for(const [key,value] of Object.entries({fmType:'edge',fmKind:'flow',fmId:id,fmRole:'main',fmAdapter:DRAWIO_ADAPTER_VERSION,fmIndex:String(nextIndex('edge'))}))entry.object.setAttribute(key,value)
      diagnostics.push({code:'BUSINESS_EDGE_ASSIGNED',message:'两业务节点间的原生连接已标记业务 flow',cellId:entry.id,businessId:id})
    }
  }
  rebindControlledCopies(native);normalizeControlledDeletions(native,original)
  const normalized=serialize(native.document),projection=await projectDrawio(normalized,base.content)
  return {...projection,diagnostics:[...diagnostics,...projection.diagnostics]}
}
