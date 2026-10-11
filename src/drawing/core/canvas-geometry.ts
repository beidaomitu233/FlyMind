import type { Box, Point } from './model'

export type ResizeHandle='nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'
export const resizeHandles:ResizeHandle[]=['nw','n','ne','e','se','s','sw','w']
export interface AlignmentGuide {axis:'x'|'y';value:number;from:number;to:number}
export function selectionBounds(boxes:Box[]):Box|undefined {
  if(!boxes.length)return
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y))
  return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y}
}
export function resizeHandlePoint(b:Box,h:ResizeHandle):Point {
  return {x:b.x+(h.includes('w')?0:h.includes('e')?b.width:b.width/2),y:b.y+(h.includes('n')?0:h.includes('s')?b.height:b.height/2)}
}
export function snapMovement(boxes:Box[],targets:Box[],delta:Point,zoom:number,disabled=false){
  const b=selectionBounds(boxes),guides:AlignmentGuide[]=[]
  if(!b)return {delta,guides}
  const moved={...b,x:b.x+Math.max(16-b.x,delta.x),y:b.y+Math.max(16-b.y,delta.y)}
  const result={x:moved.x-b.x,y:moved.y-b.y}
  if(disabled)return {delta:result,guides}
  const threshold=8/Math.max(.12,zoom)
  for(const axis of ['x','y'] as const){
    const size=axis==='x'?'width':'height',other=axis==='x'?'y':'x',otherSize=axis==='x'?'height':'width'
    const anchors=(box:Box)=>[box[axis],box[axis]+box[size]/2,box[axis]+box[size]]
    let correction:number|undefined
    for(const t of targets)for(const a of anchors(moved))for(const v of anchors(t)){
      const distance=v-a
      if(Math.abs(distance)<=threshold&&moved[axis]+distance>=16&&(correction===undefined||Math.abs(distance)<Math.abs(correction)))correction=distance
    }
    if(correction===undefined)continue
    moved[axis]+=correction;result[axis]+=correction
    for(const a of anchors(moved)){
      const matching=targets.filter(t=>anchors(t).some(v=>Math.abs(v-a)<.001))
      if(matching.length)guides.push({axis,value:a,from:Math.min(moved[other],...matching.map(t=>t[other]))-12/zoom,to:Math.max(moved[other]+moved[otherSize],...matching.map(t=>t[other]+t[otherSize]))+12/zoom})
    }
  }
  return {delta:result,guides}
}
export function resizeBox(base:Box,handle:ResizeHandle,delta:Point,proportional=false):Box {
  const west=handle.includes('w'),east=handle.includes('e'),north=handle.includes('n'),south=handle.includes('s')
  const ratio=base.width/base.height,minWidth=72,minHeight=40
  let width=east?base.width+delta.x:west?base.width-delta.x:base.width
  let height=south?base.height+delta.y:north?base.height-delta.y:base.height
  if(proportional){
    if((west||east)&&(north||south)){
      if(Math.abs(width/base.width-1)>=Math.abs(height/base.height-1))height=width/ratio;else width=height*ratio
    }else if(west||east)height=width/ratio;else width=height*ratio
    width=Math.max(minWidth,minHeight*ratio,width);height=width/ratio
  }else {width=Math.max(minWidth,width);height=Math.max(minHeight,height)}
  // Keep the opposite edge/corner fixed; side handles scale around the other
  // axis's center with Shift. The current paper coordinate system starts at 16.
  let x=west?base.x+base.width-width:base.x,y=north?base.y+base.height-height:base.y
  if(proportional&&!west&&!east)x=base.x+(base.width-width)/2
  if(proportional&&!north&&!south)y=base.y+(base.height-height)/2
  if(x<16||y<16){
    if(proportional){
      const factor=Math.min(1,x<16?(base.width+(base.x-16)*(west?1:2))/width:1,y<16?(base.height+(base.y-16)*(north?1:2))/height:1)
      width*=factor;height*=factor
      x=west?base.x+base.width-width:(!east?base.x+(base.width-width)/2:base.x)
      y=north?base.y+base.height-height:(!south?base.y+(base.height-height)/2:base.y)
    }else {if(x<16){width-=16-x;x=16}if(y<16){height-=16-y;y=16}}
  }
  return {x,y,width,height}
}
export function marqueeSelection(nodes:Array<Box&{node:{id:string}}>,box:Box,existing:string[]=[]){
  return [...new Set([...existing,...nodes.filter(n=>n.x>=box.x&&n.y>=box.y&&n.x+n.width<=box.x+box.width&&n.y+n.height<=box.y+box.height).map(n=>n.node.id)])]
}
