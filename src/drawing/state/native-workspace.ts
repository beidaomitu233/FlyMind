/** Metadata only. Canvas documents do not need a fake business kind/content. */
export interface WorkspaceMetadata {
  id:string
  title:string
  createdAt:number
  updatedAt:number
  workspaceGroupId?:string|null
  kind?:string
  mode?:string
  revision?:number
  deletedAt?:number|null
}
export interface WorkspaceGroupMetadata {id:string;name:string;createdAt:number}
export type WorkspaceSort='updatedAt'|'createdAt'
export interface WorkspaceViewPreferences {
  sort?:WorkspaceSort
  search?:string
  /** Pagination expansion, not a document/organization mutation. Null = ungrouped. */
  expandedGroupIds?:readonly (string|null)[]
}
export interface WorkspaceOrderSnapshot {
  sections:ReadonlyArray<{groupId:string|null;itemIds:readonly string[]}>
  searchQuery:string
  searchItemIds:readonly string[]
}
export interface WorkspaceRow<T extends WorkspaceMetadata=WorkspaceMetadata> {
  item:T
  /** Effective display location. An unresolved group is never silently created. */
  groupId:string|null
  groupName:string
  unavailableGroupId?:string
  current:boolean
  matchesSearch:boolean
}
export interface WorkspaceSection<T extends WorkspaceMetadata=WorkspaceMetadata> {
  groupId:string|null
  name:string
  total:number
  expanded:boolean
  rows:WorkspaceRow<T>[]
  hiddenCount:number
}
export interface NativeWorkspaceView<T extends WorkspaceMetadata=WorkspaceMetadata> {
  sections:WorkspaceSection<T>[]
  /** Flat, unique cross-group matches, with an explicit location on each row. */
  searchRows:WorkspaceRow<T>[]
  searching:boolean
  order:WorkspaceOrderSnapshot
  /** Current ownership/deletion wins over frozen visual order. UI can explain it. */
  relocatedEditingIds:string[]
  removedEditingIds:string[]
}
export interface WorkspaceViewInput<T extends WorkspaceMetadata=WorkspaceMetadata> {
  items:readonly T[]
  groups:readonly WorkspaceGroupMetadata[]
  currentId?:string
  preferences?:WorkspaceViewPreferences
  editingIds?:readonly string[]
  previousOrder?:WorkspaceOrderSnapshot
}
const compareId=(a:string,b:string)=>a<b?-1:a>b?1:0
const query=(value:string)=>value.trim().toLowerCase()

/** During an inline edit/menu interaction keep existing sibling slots stable.
 * New records append in the requested sort order; deleted/moved records never
 * linger in an incorrect group. On the next call without editingIds, sort anew. */
function stableOrder<T extends WorkspaceMetadata>(items:readonly T[],sort:WorkspaceSort,previous:readonly string[]|undefined,freeze:boolean):T[] {
  const sorted=[...items].sort((a,b)=>b[sort]-a[sort]||compareId(a.id,b.id))
  if(!freeze||!previous)return sorted
  const byId=new Map(sorted.map(item=>[item.id,item])),kept:T[]=[]
  for(const id of previous){const item=byId.get(id);if(item){kept.push(item);byId.delete(id)}}
  return [...kept,...sorted.filter(item=>byId.has(item.id))]
}

/** Pure derivation: no storage, clock, document parsing, writes or preferences
 * persistence. Callers own device preferences and the prior ordering snapshot. */
export function buildNativeWorkspaceView<T extends WorkspaceMetadata>(input:WorkspaceViewInput<T>):NativeWorkspaceView<T> {
  const preferences=input.preferences??{},sort=preferences.sort??'updatedAt',searchQuery=query(preferences.search??''),editing=new Set(input.editingIds??[]),previous=input.previousOrder
  if(!['updatedAt','createdAt'].includes(sort))throw new Error('UNSUPPORTED_WORKSPACE_SORT')
  const unique=<V extends {id:string}>(values:readonly V[],name:string)=>{const ids=new Set<string>();for(const value of values){if(!value.id||ids.has(value.id))throw new Error(`DUPLICATE_WORKSPACE_${name}_ID`);ids.add(value.id)}}
  unique(input.items,'ITEM');unique(input.groups,'GROUP')
  const groups=[...input.groups].sort((a,b)=>a.createdAt-b.createdAt||compareId(a.id,b.id)),groupById=new Map(groups.map(group=>[group.id,group])),active=input.items.filter(item=>item.deletedAt==null)
  const location=(item:T)=>item.workspaceGroupId&&groupById.has(item.workspaceGroupId)?item.workspaceGroupId:null
  const row=(item:T):WorkspaceRow<T>=>{const groupId=location(item),unavailable=item.workspaceGroupId&&!groupById.has(item.workspaceGroupId)?item.workspaceGroupId:undefined;return {item,groupId,groupName:groupId?groupById.get(groupId)!.name:unavailable?'原分组不可用':'未分组',...(unavailable?{unavailableGroupId:unavailable}:{}),current:item.id===input.currentId,matchesSearch:query(item.title).includes(searchQuery)}}
  const locations=[...groups.map(group=>({groupId:group.id as string|null,name:group.name})),{groupId:null,name:'未分组'}],expanded=new Set(preferences.expandedGroupIds??[])
  const order:WorkspaceOrderSnapshot={sections:[],searchQuery,searchItemIds:[]}
  const sections=locations.map(({groupId,name}):WorkspaceSection<T>=>{
    const members=active.filter(item=>location(item)===groupId),freeze=members.some(item=>editing.has(item.id)),sorted=stableOrder(members,sort,previous?.sections.find(section=>section.groupId===groupId)?.itemIds,freeze)
    ;(order.sections as Array<{groupId:string|null;itemIds:string[]}>).push({groupId,itemIds:sorted.map(item=>item.id)})
    // Keep the current/edited row at its existing sibling position when it lies
    // beyond the first five; do not expand every unrelated item to reveal it.
    const visible=new Set(sorted.slice(0,expanded.has(groupId)?sorted.length:5).map(item=>item.id))
    for(const item of sorted)if(item.id===input.currentId||editing.has(item.id))visible.add(item.id)
    const rows=sorted.filter(item=>visible.has(item.id)).map(row)
    return {groupId,name,total:sorted.length,expanded:expanded.has(groupId),rows,hiddenCount:sorted.length-rows.length}
  })
  const sameSearch=previous?.searchQuery===searchQuery,oldSearch=new Set(sameSearch?previous?.searchItemIds:[]),searchItems=active.filter(item=>query(item.title).includes(searchQuery)||sameSearch&&editing.has(item.id)&&oldSearch.has(item.id)),searchRows=stableOrder(searchItems,sort,sameSearch?previous?.searchItemIds:undefined,searchItems.some(item=>editing.has(item.id))).map(row)
  order.searchItemIds=searchRows.map(r=>r.item.id)
  const priorLocations=new Map(previous?.sections.flatMap(section=>section.itemIds.map(id=>[id,section.groupId] as const))??[]),currentById=new Map(active.map(item=>[item.id,item]))
  const relocatedEditingIds=[...editing].filter(id=>{const item=currentById.get(id);return item&&priorLocations.has(id)&&priorLocations.get(id)!==location(item)})
  const removedEditingIds=[...editing].filter(id=>priorLocations.has(id)&&!currentById.has(id))
  return {sections,searchRows,searching:!!searchQuery,order,relocatedEditingIds,removedEditingIds}
}
