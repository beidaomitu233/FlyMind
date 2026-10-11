import { cardStyle, palette, type DiagramDocument, type DiagramScene, type SceneNode, type CardStyle } from './model'
import { nodePreset, edgePreset } from './render-config'
import { cardMetrics } from './dataflow'
import { wrapText as wrap } from './text'
import { pathPoints } from './geometry'
export const xml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!))
function text(value:string,x:number,y:number,size:number,color:string,max=999,bold=false,anchor='middle'){
  const lines=wrap(value,max),dy=size*1.45,start=y-(lines.length-1)*dy/2
  return `<text x="${x}" y="${start}" text-anchor="${anchor}" dominant-baseline="middle" fill="${color}" font-size="${size}" font-weight="${bold?600:400}">${lines.map((line,i)=>`<tspan x="${x}" dy="${i?dy:0}">${xml(line)}</tspan>`).join('')}</text>`
}
export function renderScene(scene:DiagramScene,d:DiagramDocument,selectedId:string|string[]|null=null):string {
  const p=palette[d.presentation.theme]
  const isSelected=(id:string)=>Array.isArray(selectedId)?selectedId.includes(id):id===selectedId
  let output=`<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" style="font-family:Inter,Segoe UI,Microsoft YaHei,sans-serif" role="img" aria-label="${xml(d.title)}"><defs><linearGradient id="titleGradient"><stop stop-color="${p.dark}"/><stop offset="1" stop-color="${p.brand}"/></linearGradient><filter id="nodeShadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#244f73" flood-opacity=".055"/></filter>`
  const edgeColors=new Set(scene.edges.map(e=>e.color));edgeColors.forEach(color=>output+=`<marker id="arrow-${color.slice(1)}" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4.5 L0 9" fill="${color}"/></marker>`)
  output+='</defs>'
  for(const c of scene.containers){
    const {x,y,width:w,height:h}=c
    output+=`<g data-container-id="${xml(c.id)}">`
    if(c.kind==='title'){output+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="url(#titleGradient)"/>`+text(c.label,x+w/2,y+h/2,d.kind==='architecture'?31:25,'#fff',90,true)}
    if(c.kind==='lane'){
      output+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#d4ddeb" stroke-width="1"/>`
      const hw=c.vertical?w:120,hh=c.vertical?56:h
      output+=`<rect x="${x}" y="${y}" width="${hw}" height="${hh}" fill="${p.brand}"/>`+text(c.label,x+hw/2,y+hh/2,18,'#fff',c.vertical?15:7,true)
    }
    if(c.kind==='phase'){
      output+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${p.soft}" stroke="#d4ddeb"/>`
      if(c.vertical){output+=`<g transform="translate(${x+w/2} ${y+h/2}) rotate(-90)">`+text(c.label,0,0,17,p.dark,20,true)+'</g>';output+=`<path d="M${x+w} ${y+h} H${scene.width-40}" stroke="#b9c5d5" stroke-dasharray="10 8"/>`}
      else {output+=text(c.label,x+w/2,y+h/2,18,p.dark,20,true);output+=`<path d="M${x+w} ${y+h} V${scene.height-40}" stroke="#b9c5d5" stroke-dasharray="10 8"/>`}
    }
    if(c.kind==='layer'){const color=d.groups.find(g=>g.id===c.id)?.color||(c.tone==='green'?p.accent:c.tone==='amber'?'#d9933f':p.dark);output+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${color}"/>`+text(c.label,x+w/2,y+h/2,20,'#fff',5,true)}
    if(c.kind==='governance'){output+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#eef1fa" stroke="#bbc5e0"/>`+text(c.label,x+w/2,y+26,13,'#465473',8,true)}
    output+='</g>'
  }
  for(const e of scene.edges){const selected=isSelected(e.edge.id),style=d.presentation.edges?.[e.edge.id],arrow=style?.arrow||edgePreset(d).arrow;output+=`<path data-edge-id="${xml(e.edge.id)}" d="${e.path}" fill="none" stroke="transparent" stroke-width="14" style="cursor:pointer"/><path data-edge-id="${xml(e.edge.id)}" d="${e.path}" fill="none" stroke="${selected?'#7166dc':e.color}" stroke-width="${selected?3:style?.width||edgePreset(d).width}" stroke-linejoin="round" stroke-linecap="round" ${(style?.dashed??edgePreset(d).dashed)?'stroke-dasharray="7 5"':''} ${arrow!=='none'?`marker-end="url(#arrow-${e.color.slice(1)})"`:''} ${arrow==='both'?`marker-start="url(#arrow-${e.color.slice(1)})"`:''}/>`}
  scene.nodes.forEach(n=>output+=renderNode(n,d,isSelected(n.node.id)))
  for(const e of scene.edges)if(e.edge.label){const size=d.kind==='dataflow'?22:13,height=size+10,width=Math.max(22,e.edge.label.length*size+12);output+=`<g data-edge-id="${xml(e.edge.id)}" data-label-id="${xml(e.edge.id)}" style="cursor:move"><rect x="${e.labelX-width/2}" y="${e.labelY-height/2}" width="${width}" height="${height}" rx="4" fill="#fff"/>`+text(e.edge.label,e.labelX,e.labelY,size,e.color,999,d.kind==='dataflow')+'</g>'}
  return output+'</svg>'
}
function renderNode(n:SceneNode,d:DiagramDocument,selected:boolean):string {
  const {x,y,width:w,height:h,node,color,fill,textColor}=n,stroke=node.badge==='3期'?'#df913d':color,fontSize=d.presentation.styles?.[node.id]?.fontSize||nodePreset(d,node.kind).fontSize,shape=d.presentation.styles?.[node.id]?.shape||nodePreset(d,node.kind).shape
  let out=`<g data-node-id="${xml(node.id)}" style="cursor:grab" role="button" aria-label="${xml(node.label)}" tabindex="0">`
  if(selected)out+=`<rect x="${x-6}" y="${y-6}" width="${w+12}" height="${h+12}" rx="12" fill="#6862db" fill-opacity=".06" stroke="#7768df" stroke-width="1.5" stroke-dasharray="4 3"/>`
  if(d.kind==='dataflow')return out+renderCard(n,d)+'</g>'
  if(shape==='diamond')out+=`<path d="M${x+w/2} ${y} L${x+w} ${y+h/2} L${x+w/2} ${y+h} L${x} ${y+h/2} Z" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>`
  else if(shape==='ellipse')out+=`<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`
  else out+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${shape==='rectangle'?0:d.kind==='mindmap'?10:6}" fill="${node.badge==='3期'?'#fff8ec':fill}" stroke="${stroke}" stroke-width="1.5" filter="url(#nodeShadow)"/>`
  if(node.kind==='module'){
    const governance=d.groups.find(g=>g.id===node.groupId)?.kind==='governance'
    if(governance){out+=text(node.label,x+w/2,y+24,13,textColor,9,true);(node.items||[]).forEach((item,i)=>out+=text(item,x+w/2,y+56+i*24,10,textColor,10));}
    else {
      const cols=w<260?1:2,gap=8,pad=12,cellW=(w-pad*2-gap*(cols-1))/cols
      out+=text(node.label,x+pad,y+22,fontSize||Math.min(15,w<260?13:15),textColor,(w-24-(node.badge?36:0))/(fontSize||14),true,'start')
      if(node.badge){out+=`<rect x="${x+w-46}" y="${y+10}" width="34" height="20" rx="10" fill="${stroke}"/>`+text(node.badge,x+w-29,y+20,10,'#fff')}
      ;(node.items||[]).forEach((item,i)=>{const ix=x+pad+(i%cols)*(cellW+gap),iy=y+44+Math.floor(i/cols)*28;out+=`<rect x="${ix}" y="${iy}" width="${cellW}" height="22" rx="3" fill="#fff" stroke="${stroke}" stroke-opacity=".22"/>`+text(item,ix+7,iy+11,Math.min(12,cellW/(item.length||1)),textColor,999,false,'start')})
    }
  }else {const size=fontSize||(d.kind==='mindmap'?16:17);out+=text(node.label,x+w/2,y+h/2,size,textColor,shape==='diamond'?(w/2-8)/size:(w-24)/size,node.kind==='topic'&&!node.parentId)}
  return out+'</g>'
}

function cardIcon(icon:CardStyle['icon'],color:string){
  const paths={
    database:'<ellipse cx="18" cy="7" rx="13" ry="5"/><path d="M5 7v22c0 7 26 7 26 0V7 M5 15c0 7 26 7 26 0 M5 23c0 7 26 7 26 0"/>',
    network:'<path d="M7 7l22-2-10 13 12 12-25-1 13-11z M7 7l24 23 M6 29L29 5"/><circle cx="7" cy="7" r="3" fill="white"/><circle cx="29" cy="5" r="3" fill="white"/><circle cx="19" cy="18" r="3" fill="white"/><circle cx="31" cy="30" r="3" fill="white"/><circle cx="6" cy="29" r="3" fill="white"/>',
    check:'<circle cx="18" cy="18" r="15"/><path d="M10 18l6 6 11-13"/>',none:''
  }
  return `<g fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[icon||'none']}</g>`
}
function renderCard(n:SceneNode,d:DiagramDocument){
  const {x,y,width:w,height:h,node,color,fill,textColor}=n,style=cardStyle(d,node.id),m=cardMetrics(d,node,w),shape=d.presentation.styles?.[node.id]?.shape||nodePreset(d,node.kind).shape,border=d.presentation.styles?.[node.id]?.stroke||d.presentation.nodeDefaults?.[node.kind]?.stroke||'#ccdee7'
  let out=''
  if(node.kind!=='note'){
    out+=shape==='diamond'?`<path d="M${x+w/2} ${y} L${x+w} ${y+h/2} L${x+w/2} ${y+h} L${x} ${y+h/2} Z" fill="${fill}" stroke="${border}"/>`:shape==='ellipse'?`<ellipse cx="${x+w/2}" cy="${y+h/2}" rx="${w/2}" ry="${h/2}" fill="${fill}" stroke="${border}"/>`:`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${shape==='rectangle'?0:14}" fill="${fill}" stroke="${border}" stroke-width="1.5" filter="url(#nodeShadow)"/>`
    if(!m.centered)out+=`<path d="M ${x+14} ${y+18} V ${y+h-18}" stroke="${color}" stroke-width="4"/>`
  }
  const tx=m.centered?x+w/2:x+m.pad,anchor=m.centered?'middle':'start'
  let ty=y+m.pad
  if(m.iconHeight){out+=`<g transform="translate(${tx} ${ty})">${cardIcon(style.icon,color)}</g>`;ty+=m.iconHeight}
  out+=text(node.label,tx,ty+m.titleHeight/2,m.titleSize,textColor,(w-m.pad*2)/m.titleSize,true,anchor)
  if(node.description)out+=text(node.description,tx,ty+m.titleHeight+14+m.bodyHeight/2,m.bodySize,'#657e8d',(w-m.pad*2)/m.bodySize,false,anchor)
  return out
}

// XML is generated from the same scene as SVG; it is an editable interchange format.
function drawioShape(n:SceneNode,d:DiagramDocument){const shape=d.presentation.styles?.[n.node.id]?.shape||nodePreset(d,n.node.kind).shape;return shape==='diamond'?'rhombus;':shape==='ellipse'?'ellipse;':shape==='rectangle'?'rounded=0;':'rounded=1;'}
export function renderDrawio(scene:DiagramScene,d:DiagramDocument):string {
  const cells=['<mxCell id="0"/>','<mxCell id="1" parent="0"/>']
  scene.containers.forEach(c=>cells.push(`<mxCell id="c-${xml(c.id)}" value="${xml(c.label)}" style="rounded=1;whiteSpace=wrap;html=0;fillColor=${c.kind==='title'?palette[d.presentation.theme].brand:'#edf3fa'};fontColor=${c.kind==='title'?'#ffffff':'#34516e'};" vertex="1" parent="1"><mxGeometry x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" as="geometry"/></mxCell>`))
  scene.nodes.forEach(n=>{
    if(d.kind==='dataflow'){
      const m=cardMetrics(d,n.node,n.width),s=cardStyle(d,n.node.id),id=`n-${xml(n.node.id)}`
      cells.push(`<mxCell id="${id}" value="" style="${drawioShape(n,d)}arcSize=8;fillColor=${n.node.kind==='note'?'none':n.fill};strokeColor=${n.node.kind==='note'?'none':'#ccdee7'};" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" as="geometry"/></mxCell>`)
      if(!m.centered)cells.push(`<mxCell id="${id}-accent" style="fillColor=${n.color};strokeColor=none;" vertex="1" parent="${id}"><mxGeometry x="14" y="18" width="4" height="${n.height-36}" as="geometry"/></mxCell>`)
      if(m.iconHeight){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">${cardIcon(s.icon,n.color)}</svg>`;cells.push(`<mxCell id="${id}-icon" style="shape=image;image=data:image/svg+xml,${encodeURIComponent(svg)};" vertex="1" parent="${id}"><mxGeometry x="${m.pad}" y="${m.pad}" width="36" height="36" as="geometry"/></mxCell>`)}
      const ty=m.pad+m.iconHeight,align=m.centered?'center':'left'
      cells.push(`<mxCell id="${id}-title" value="${xml(n.node.label)}" style="text;html=0;whiteSpace=wrap;align=${align};fontStyle=1;fontSize=${m.titleSize};fontColor=${n.textColor};" vertex="1" parent="${id}"><mxGeometry x="${m.pad}" y="${ty}" width="${n.width-m.pad*2}" height="${m.titleHeight}" as="geometry"/></mxCell>`)
      if(n.node.description)cells.push(`<mxCell id="${id}-body" value="${xml(n.node.description)}" style="text;html=0;whiteSpace=wrap;align=${align};fontSize=${m.bodySize};fontColor=#657e8d;" vertex="1" parent="${id}"><mxGeometry x="${m.pad}" y="${ty+m.titleHeight+14}" width="${n.width-m.pad*2}" height="${m.bodyHeight}" as="geometry"/></mxCell>`)
    }else cells.push(`<mxCell id="n-${xml(n.node.id)}" value="${xml(n.node.label+(n.node.items?.length?'\n'+n.node.items.join(' · '):''))}" style="${drawioShape(n,d)}whiteSpace=wrap;html=0;fillColor=${n.fill};strokeColor=${n.color};fontColor=${n.textColor};fontSize=${d.presentation.styles?.[n.node.id]?.fontSize||nodePreset(d,n.node.kind).fontSize};" vertex="1" parent="1"><mxGeometry x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" as="geometry"/></mxCell>`)
  })
  scene.edges.forEach(e=>{
    const style=d.presentation.edges?.[e.edge.id],points=d.kind==='mindmap'&&!style?[]:pathPoints(e.path)
    const a=scene.nodes.find(n=>n.node.id===e.edge.source)!,b=scene.nodes.find(n=>n.node.id===e.edge.target)!
    const first=points[0],last=points.at(-1),ports=first&&last?`exitX=${(first.x-a.x)/a.width};exitY=${(first.y-a.y)/a.height};entryX=${(last.x-b.x)/b.width};entryY=${(last.y-b.y)/b.height};`:''
    const arrow=style?.arrow||edgePreset(d).arrow
    cells.push(`<mxCell id="e-${xml(e.edge.id)}" value="${xml(e.edge.label||'')}" style="${(style?.route||edgePreset(d).route)==='curved'?'curved=1;':points.length?'':'edgeStyle=orthogonalEdgeStyle;'}${ports}rounded=1;html=0;endArrow=${arrow==='none'?'none':'block'};startArrow=${arrow==='both'?'block':'none'};strokeWidth=${style?.width||edgePreset(d).width};strokeColor=${e.color};dashed=${(style?.dashed??edgePreset(d).dashed)?1:0};" edge="1" parent="1" source="n-${xml(e.edge.source)}" target="n-${xml(e.edge.target)}"><mxGeometry relative="1" as="geometry">${points.length>2?`<Array as="points">${points.slice(1,-1).map(p=>`<mxPoint x="${p.x}" y="${p.y}"/>`).join('')}</Array>`:''}</mxGeometry></mxCell>`)
  })
  return `<?xml version="1.0" encoding="UTF-8"?><mxfile host="FlyMind"><diagram name="${xml(d.title)}"><mxGraphModel pageWidth="${scene.width}" pageHeight="${scene.height}"><root>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`
}
