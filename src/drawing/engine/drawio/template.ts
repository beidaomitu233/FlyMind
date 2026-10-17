import type {DiagramNode} from '../../core/model'
import type {DrawioCompileOptions} from '../types'
import {fail} from './xml'
export {RUNTIME_FONT_FAMILY as FONT} from '../runtime-assets'
import {RUNTIME_FONT_FAMILY as FONT} from '../runtime-assets'
export const metaKeys=['description','items','badge','color','parentId','groupId'] as const
type Attributes=Record<string,string|number|undefined>
export function nodeMetadata(node:DiagramNode):Attributes{
  const attrs:Attributes={fmType:node.kind==='note'?'annotation':'node',fmId:node.id,fmKind:node.kind,fmRole:'main',fmLaneId:node.laneId,fmPhaseId:node.phaseId}
  for(const key of metaKeys)if(node[key]!==undefined)attrs[`fm${key[0].toUpperCase()+key.slice(1)}`]=key==='items'?JSON.stringify(node[key]):node[key] as string
  return attrs
}
export function fontStyle(size=16){return `fontFamily=${FONT};fontSize=${size};html=0;whiteSpace=wrap;`}
export function textUnits(value:string){return [...value].reduce((n,c)=>n+(/[^\x00-\xff]/.test(c)?1:.55),0)}
export function dimensions(node:DiagramNode,options:DrawioCompileOptions){
  const preset=options.preferences?.nodeDefaults?.[node.kind]
  const font=preset?.fontSize??16,width=preset?.width??(node.kind==='decision'?Math.min(440,Math.max(240,Math.ceil(textUnits(node.label)/4)*16)):260)
  const shape=preset?.shape??(node.kind==='decision'?'diamond':['start','end'].includes(node.kind)?'ellipse':'rounded')
  const available=Math.max(font,(shape==='diamond'?width*.5:shape==='ellipse'?width*.72:width)-32)
  const lines=node.label.split('\n').reduce((n,line)=>n+Math.max(1,Math.ceil(textUnits(line)*font/available)),0)
  const height=Math.max(preset?.height??(shape==='diamond'?112:64),Math.ceil(lines*font*1.5)*(shape==='diamond'?2:shape==='ellipse'?1.5:1)+32)
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<64||width>2000||height>4000||font<10||font>48)fail('UNSUPPORTED_RENDERING_OPTION','节点标准尺寸或字体超限')
  return {width,height,font,shape}
}
export function styleShape(shape:string){return shape==='diamond'?'rhombus;':shape==='ellipse'?'ellipse;':`rounded=${shape==='rounded'?1:0};`}
