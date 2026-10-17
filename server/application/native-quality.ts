import type {DiagramContent} from '../../src/drawing/core/model'
import {inspectDrawing,requireDrawingQuality,DrawingQualityError,type DrawingQuality,type EditIntent,type QualityIssue} from '../../src/drawing/core/drawing-quality'
import {StoreError} from '../store'

export class NativeQualityError extends StoreError {
  constructor(readonly quality:DrawingQuality,message='AI 修改新增或加重了内容质量问题'){super(message,422,undefined,'QUALITY_FAILED')}
}
const family=(code:string)=>({wordy_label:'label_length',long_label:'label_length',wordy_description:'description_length',long_description:'description_length',many_items:'item_count',too_many_items:'item_count'} as Record<string,string>)[code]??code
function measure(issue:QualityIssue,content:DiagramContent){
  const node=content.nodes.find(n=>n.id===issue.nodeId)
  if(issue.actual!==undefined)return [issue.code==='decision_exits'?(issue.limit??2)-issue.actual:issue.actual-(issue.limit??0)]
  if(node&&['wordy_description','long_description'].includes(issue.code))return [[...(node.description??'')].length]
  if(node&&issue.code==='paragraph_label')return [Math.max(0,node.label.split('\n').length-3),Math.max(0,(node.label.match(/[。；;]/g)||[]).length-2)]
  if(node&&issue.code==='decision_conditions'){
    const labels=content.edges.filter(e=>e.source===node.id).map(e=>(e.label??'').trim().toLowerCase()),present=labels.filter(Boolean)
    return [labels.length-present.length,present.length-new Set(present).size]
  }
  if(node&&issue.code==='end_continues')return [content.edges.filter(e=>e.source===node.id).length]
  if(node&&issue.code==='duplicate_topic')return [content.nodes.filter(n=>n.kind!=='note'&&n.id!==node.id&&n.parentId===node.parentId&&n.label.trim()===node.label.trim()).length]
  if(node&&issue.code==='long_item'){
    const excess=(node.items??[]).map(s=>Math.max(0,[...s].length-(/[\u3400-\u9fff]/.test(s)?32:100))).filter(Boolean)
    return [excess.length,excess.reduce((sum,n)=>sum+n,0),Math.max(0,...excess)]
  }
  // Atomic presence violations (e.g. wrong node kind / isolated node) have no
  // meaningful graded scale beyond their code, object identity and severity.
  return [1]
}
const severity=(issue:QualityIssue)=>issue.severity==='error'?2:1
const key=(issue:QualityIssue)=>[family(issue.code),issue.nodeId??'',issue.edgeId??''].join(':')

/** AI policy only. Native editor/manual draft persistence remains structural. */
export function requireNativeAIQuality(next:DiagramContent,before?:DiagramContent,intent:EditIntent='structure'){
  const quality=inspectDrawing(next)
  if(!before){if(!quality.passed||quality.issues.some(i=>i.severity==='error'))throw new NativeQualityError(quality,'新建图形未通过内容质量标准');return quality}
  // Reuse the existing semantic-vs-annotation check, then strengthen it with all
  // issue severities. In particular, warnings cannot silently regress.
  try{requireDrawingQuality(next,before,intent)}catch(error){if(error instanceof DrawingQualityError&&error.quality.issues.some(i=>i.code==='annotation_only_change'))throw new NativeQualityError(error.quality,error.message);if(!(error instanceof DrawingQualityError))throw error}
  const previous=inspectDrawing(before),old=new Map(previous.issues.map(i=>[key(i),i]))
  const regressions=quality.issues.filter(issue=>{
    const prior=old.get(key(issue));if(!prior)return true
    return severity(issue)>severity(prior)||severity(issue)===severity(prior)&&measure(issue,next).some((n,index)=>n>(measure(prior,before)[index]??0))
  })
  if(regressions.length)throw new NativeQualityError({...quality,passed:false,issues:regressions})
  return quality
}
