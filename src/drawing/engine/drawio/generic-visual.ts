import type {DiagramContent,DiagramNode,DiagramEdge} from '../../core/model'
import {palette} from '../../core/model'
import type {RenderingPreferences} from '../types'
import {architectureTone} from './architecture-layout'
import {technicalCategory,TECHNICAL_REGION_STYLE,TECHNICAL_NODE_STYLE,TECHNICAL_EDGE_STYLE} from './technical-layout'
import {fontStyle,styleShape} from './template'

export interface ArchitectureVisual {index:number;governance:boolean}
export function architectureVisual(content:DiagramContent,groupId?:string):ArchitectureVisual|undefined{
 if(content.kind!=='architecture'||!groupId)return
 const group=content.groups.find(g=>g.id===groupId);if(!group)return
 const governance=group.kind==='governance'
 return {governance,index:content.groups.filter(g=>(g.kind==='governance')===governance).findIndex(g=>g.id===groupId)}
}
export function genericNodeStyle(kind:DiagramContent['kind'],node:DiagramNode,size:{shape:string;font:number},preferences:RenderingPreferences={},a?:ArchitectureVisual){
 const p=palette[preferences.theme??(kind==='architecture'?'blue':'indigo')],preset=preferences.nodeDefaults?.[node.kind],tone=a&&architectureTone(a.index,a.governance)
 if(node.kind==='note')return `text;${fontStyle(size.font)}fillColor=none;strokeColor=none;fontColor=${preset?.textColor??node.color??p.dark};align=left;verticalAlign=middle;spacing=0;`
 return `${styleShape(size.shape)}${fontStyle(a?.governance?14:size.font)}fillColor=${preset?.fill??node.color??(a?(node.badge==='3期'?'#fff8ec':tone!.fill):node.kind==='decision'?p.accentSoft:p.soft)};strokeColor=${preset?.stroke??(a?(node.badge==='3期'?'#d18a35':tone!.stroke):p.brand)};fontColor=${preset?.textColor??(kind==='technical'?'#262c35':a?tone!.text:p.dark)};strokeWidth=1.3;arcSize=10;spacing=10;collapsible=0;${kind==='technical'?TECHNICAL_NODE_STYLE+(technicalCategory(node)==='client'?'strokeColor=#159bff;dashed=1;strokeWidth=2;':''):''}`
}
export function genericGroupStyle(kind:DiagramContent['kind'],group:DiagramContent['groups'][number],preferences:RenderingPreferences={},a?:ArchitectureVisual){
 const p=palette[preferences.theme??(kind==='architecture'?'blue':'indigo')],tone=a&&architectureTone(a.index,a.governance)
 return kind==='technical'?TECHNICAL_REGION_STYLE+fontStyle(19)+'startSize=0;':a?`swimlane;horizontal=${a.governance?1:0};startSize=${a.governance?56:100};container=1;collapsible=0;recursiveResize=0;expand=0;fillColor=${group.color??(a.governance?'#eef1fa':a.index%2?tone!.stroke:p.dark)};swimlaneFillColor=${a.governance?'#f5f7fb':'#ffffff'};strokeColor=${tone!.stroke};${fontStyle(a.governance?16:20)}fontStyle=1;fontColor=${a.governance?tone!.text:'#ffffff'};align=center;resizable=1;`:`swimlane;horizontal=1;startSize=48;container=1;collapsible=0;recursiveResize=0;expand=0;fillColor=${group.color??p.dark};swimlaneFillColor=${p.soft};strokeColor=${p.brand};${fontStyle(19)}fontStyle=1;fontColor=#ffffff;align=left;spacingLeft=20;resizable=1;`
}
export function genericEdgeStyle(kind:DiagramContent['kind'],edge:DiagramEdge,preferences:RenderingPreferences={},labelWidth=180){
 const p=palette[preferences.theme??(kind==='architecture'?'blue':'indigo')],defaults=preferences.edgeDefaults,arrow=defaults?.arrow??'end'
 return `edgeStyle=orthogonalEdgeStyle;rounded=0;ignoreEdge=1;jettySize=32;${fontStyle(13)}labelWidth=${labelWidth};labelBackgroundColor=#ffffff;startArrow=${arrow==='both'?'block':'none'};endArrow=${arrow==='none'?'none':'block'};strokeColor=${defaults?.color??(edge.kind==='feedback'?'#b77730':p.edge)};strokeWidth=${defaults?.width??1.5};dashed=${(defaults?.dashed??edge.kind==='feedback')?1:0};${kind==='technical'?TECHNICAL_EDGE_STYLE:''}`
}
