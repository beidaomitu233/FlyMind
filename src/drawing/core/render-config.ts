import type { Box, CardStyle, DiagramDocument, DiagramNode, EdgeStyle, NodeKind, NodeStyle, ThemeName } from './model'
import { wrapText } from './text'

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
  groups?:Record<string,{tone?:'blue'|'green'|'amber';columns?:number}>
  cards?:Record<string,CardStyle>
  styles?:Record<string,NodeStyle>
  edges?:Record<string,EdgeStyle>
}
export const standardNodePresets:Record<NodeKind,NodePreset>={
  task:{width:200,height:70,fontSize:17,shape:'rounded'},
  decision:{width:184,height:112,fontSize:17,shape:'diamond'},
  start:{width:200,height:70,fontSize:17,shape:'ellipse'},
  end:{width:200,height:70,fontSize:17,shape:'ellipse'},
  module:{width:300,height:124,fontSize:15,shape:'rectangle'},
  topic:{width:200,height:52,fontSize:16,shape:'rounded'},
  card:{width:284,height:160,fontSize:28,shape:'rounded'},
  note:{width:400,height:90,fontSize:28,shape:'rectangle'}
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
  const available=shape==='diamond'?preset.width/2-8:preset.width-32
  const lines=wrapText(n.label,available/font).length
  return {...preset,height:Math.max(preset.height,Math.ceil(lines*font*1.45+(shape==='diamond'?44:28)))}
}
export function edgePreset(d:DiagramDocument){return {route:d.kind==='mindmap'?'curved' as const:'orthogonal' as const,width:d.kind==='dataflow'?2.5:1.7,arrow:d.kind==='mindmap'?'none' as const:'end' as const,dashed:false,...d.presentation.edgeDefaults}}
export function groupTone(d:DiagramDocument,id:string){return d.presentation.groups?.[id]?.tone||'blue'}
