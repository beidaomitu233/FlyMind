import type {DiagramContent,DiagramKind} from '../../src/drawing/core/model'
/** Synthetic service fixtures. No user business source or inferred PBS repairs. */
export function businessContent(kind:DiagramKind,id='business-'+kind):DiagramContent {
 const base:DiagramContent={schemaVersion:1,id,title:'业务'+kind+'验证',kind,nodes:[],edges:[],lanes:[],phases:[],groups:[]}
 if(kind==='swimlane'||kind==='flowchart'){
  base.nodes=[{id:'start',kind:'start',label:'接收申请'},{id:'task',kind:'task',label:'核对资料'},{id:'end',kind:'end',label:'完成受理'}];base.edges=[{id:'a',source:'start',target:'task'},{id:'b',source:'task',target:'end'}]
  if(kind==='swimlane'){base.lanes=[{id:'owner',label:'经办人员'}];base.phases=[{id:'work',label:'受理阶段'}];base.nodes.forEach(n=>{n.laneId='owner';n.phaseId='work'})}
 }else if(kind==='architecture'){
  base.groups=[{id:'app',label:'应用层'},{id:'service',label:'服务层'}];base.nodes=[{id:'entry',kind:'module',label:'申请入口',groupId:'app',items:['提交申请']},{id:'task',kind:'module',label:'审核服务',groupId:'service',items:['核对资料']}];base.edges=[{id:'call',source:'entry',target:'task',label:'审核请求'}]
 }else if(kind==='mindmap')base.nodes=[{id:'root',kind:'topic',label:'申请受理'},{id:'task',kind:'topic',label:'核对资料',parentId:'root'},{id:'deliver',kind:'topic',label:'结果交付',parentId:'root'}]
 else {base.nodes=[{id:'source',kind:'card',label:'申请数据',description:'接收申请数据'},{id:'task',kind:'card',label:'资料校验',description:'输出校验结果'},{id:'sink',kind:'card',label:'结果归档',description:'保存受理结果'}];base.edges=[{id:'a',source:'source',target:'task',label:'申请资料'},{id:'b',source:'task',target:'sink',label:'校验结果'}]}
 return base
}
