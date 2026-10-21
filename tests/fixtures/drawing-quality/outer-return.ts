import type {DiagramContent} from '../../../src/drawing/core/model'
/** Synthetic approval flow only; no customer material or inferred relations. */
export function outerReturnContent(kind:'flowchart'|'swimlane'):DiagramContent{
 const swim=kind==='swimlane'
 return {schemaVersion:1,id:'outer-return-'+kind,title:'退回修改与补充资料',kind,
  nodes:[...([{id:'start',kind:'start',label:'接收申请'},{id:'a',kind:'task',label:'编制申请'},{id:'b',kind:'task',label:'检查资料'},{id:'c',kind:'decision',label:'复核是否通过？'},{id:'d',kind:'task',label:'确认办理'},{id:'end',kind:'end',label:'办理完成'}].map((n,i)=>({...n,...(swim?{laneId:i<3?'author':'reviewer',phaseId:i<3?'prepare':'approve'}:{})})) as DiagramContent['nodes']),{id:'note',kind:'note',label:'退回后重新检查，说明不占主流程。',...(swim?{laneId:'author',phaseId:'prepare'}:{})}],
  edges:[{id:'f1',source:'start',target:'a'},{id:'f2',source:'a',target:'b'},{id:'f3',source:'b',target:'c'},{id:'f4',source:'c',target:'d',label:'通过'},{id:'f5',source:'d',target:'end'},{id:'feedback',source:'c',target:'a',kind:'feedback',label:'未通过：退回修改'},{id:'unmarked',source:'d',target:'b',label:'资料变化：重新检查'}],
  lanes:swim?[{id:'author',label:'申请人'},{id:'reviewer',label:'审核人'}]:[],phases:swim?[{id:'prepare',label:'编制'},{id:'approve',label:'审批'}]:[],groups:[]}
}
