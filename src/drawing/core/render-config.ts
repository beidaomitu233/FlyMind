import type { Box, CardStyle, DiagramDocument, DiagramNode, EdgeStyle, NodeKind, NodeStyle, ThemeName } from './model'
import { wrapText,textUnits } from './text'

export type NodeShape='rectangle'|'rounded'|'ellipse'|'diamond'
export type LineRoute='orthogonal'|'straight'|'curved'
export interface NodePreset {width:number;height:number;fontSize:number;shape:NodeShape;fill?:string;stroke?:string;textColor?:string}
export interface RenderingConfig {
  theme:ThemeName
  orientation:'vertical'|'horizontal'
  nodeDefaults?:Partial<Record<NodeKind,Partial<NodePreset>>>
  edgeDefaults?:{route?:LineRoute;color?:string;width?:number;arrow?:'end'|'both'|'none';dashed?:boolean}
  positions:Record<string,Partial<Box>>
  ranks?:Record<string,number>
  phases?:Record<string,{size:number}>
  texts?:Record<string,{width?:number;fontSize?:number;color?:string}>
  groups?:Record<string,{tone?:'blue'|'green'|'amber';columns?:number}>
  cards?:Record<string,CardStyle>
  styles?:Record<string,NodeStyle>
  edges?:Record<string,EdgeStyle>
  objects?:{groups?:Record<string,string[]>;locked?:string[];order?:string[]}
}
export const standardNodePresets:Record<NodeKind,NodePreset>={
  task:{width:200,height:70,fontSize:17,shape:'rounded'},
  decision:{width:184,height:112,fontSize:17,shape:'diamond'},
  start:{width:200,height:70,fontSize:17,shape:'ellipse'},
  end:{width:200,height:70,fontSize:17,shape:'ellipse'},
  module:{width:300,height:124,fontSize:15,shape:'rectangle'},
  topic:{width:200,height:52,fontSize:16,shape:'rounded'},
  card:{width:284,height:160,fontSize:28,shape:'rounded'},
  note:{width:80,height:32,fontSize:17,shape:'rectangle'}
}
export function defaultRendering(kind:string):RenderingConfig {
  return {theme:kind==='architecture'||kind==='dataflow'?'blue':'indigo',orientation:'vertical',positions:{}}
}
export function nodePreset(d:DiagramDocument,kind:NodeKind):NodePreset {
  const preset={...standardNodePresets[kind]}
  if(d.kind==='swimlane')Object.assign(preset,kind==='decision'?{width:152,height:92}:{width:168,height:68})
  return {...preset,...d.presentation.nodeDefaults?.[kind]}
}
export function nodeDimensions(d:DiagramDocument,n:DiagramNode){
  const preset=nodePreset(d,n.kind),font=d.presentation.styles?.[n.id]?.fontSize||preset.fontSize,shape=d.presentation.styles?.[n.id]?.shape||preset.shape
  let width=preset.width
  if(['swimlane','flowchart'].includes(d.kind)&&d.presentation.nodeDefaults?.[n.kind]?.width===undefined){
    const longest=Math.max(...n.label.split('\n').map(textUnits)),ideal=shape==='diamond'?Math.min(10,longest)*font*2+32:Math.min(15,longest)*font+40
    width=Math.max(width,Math.ceil(Math.min(shape==='diamond'?304:320,ideal)/8)*8)
  }
  const available=shape==='diamond'?width/2-12:shape==='ellipse'?width*.72-16:width-32
  const lines=wrapText(n.label,available/font).length
  const textHeight=lines*font*1.45,height=shape==='diamond'?textHeight*2+24:shape==='ellipse'?textHeight*1.5+28:textHeight+32
  return {...preset,width,height:Math.max(preset.height,shape==='diamond'?Math.ceil(width*.6):0,Math.ceil(height))}
}
export function edgePreset(d:DiagramDocument){return {route:d.kind==='mindmap'?'curved' as const:'orthogonal' as const,width:d.kind==='dataflow'?2.5:1.7,arrow:d.kind==='mindmap'?'none' as const:'end' as const,dashed:false,...d.presentation.edgeDefaults}}
export function groupTone(d:DiagramDocument,id:string){return d.presentation.groups?.[id]?.tone||'blue'}
