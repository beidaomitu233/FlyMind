import type {DiagramDocument,DiagramNode,DiagramScene} from './model'
import {textUnits,wrapText} from './text'

export function textAppearance(d:DiagramDocument,n:DiagramNode){
  const config=d.presentation.texts?.[n.id],style=d.presentation.styles?.[n.id],preset=d.presentation.nodeDefaults?.note
  return {fontSize:config?.fontSize||style?.fontSize||preset?.fontSize||17,color:config?.color||style?.textColor||preset?.textColor||n.color||'#32495d',width:config?.width||preset?.width}
}
export function floatingTextValue(n:DiagramNode){return [n.label,n.description].filter(Boolean).join('\n')}
export function floatingTextMetrics(d:DiagramDocument,n:DiagramNode){
  const style=textAppearance(d,n),value=floatingTextValue(n),width=style.width||Math.max(24,Math.min(420,Math.ceil(Math.max(...value.split('\n').map(textUnits))*style.fontSize+12)))
  const lines=wrapText(value,Math.max(1,(width-12)/style.fontSize)),height=Math.max(24,Math.ceil(lines.length*style.fontSize*1.45+8))
  return {...style,width,height,lines}
}
export function appendFloatingTexts(d:DiagramDocument,scene:DiagramScene){
  let y=Math.max(80,d.kind==='dataflow'?scene.height:0,...scene.nodes.map(n=>n.y+n.height))+36
  for(const n of d.nodes.filter(n=>n.kind==='note')){
    const m=floatingTextMetrics(d,n),p=d.presentation.positions[n.id],x=p?.x??80,top=p?.y??y
    scene.nodes.push({node:n,x,y:top,width:m.width!,height:m.height,color:m.color,fill:'transparent',textColor:m.color})
    if(p?.y===undefined)y+=m.height+16
  }
}
