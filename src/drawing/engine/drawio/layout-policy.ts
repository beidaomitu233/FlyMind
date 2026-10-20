import type {ElkNode} from 'elkjs/lib/elk-api'
import type {DiagramContent} from '../../core/model'
import {bindingId} from './state'

export function layoutExtent(graph:ElkNode){const nodes=graph.children??[];return {width:Math.max(1,...nodes.map(n=>(n.x??0)+(n.width??0)))-Math.min(0,...nodes.map(n=>n.x??0)),height:Math.max(1,...nodes.map(n=>(n.y??0)+(n.height??0)))-Math.min(0,...nodes.map(n=>n.y??0))}}
/** ELK owns ranking/order. Align shapes within its disjoint rank bands, then
 * centre a tree parent over its own children; no synthetic content edges. */
export function alignRankedLayout(graph:ElkNode,content:DiagramContent,horizontal:boolean){
 const axis=horizontal?'x':'y',size=horizontal?'width':'height',cross=horizontal?'y':'x',crossSize=horizontal?'height':'width',nodes=graph.children??[],sorted=[...nodes].sort((a,b)=>(a[axis]??0)-(b[axis]??0))
 let band:ElkNode[]=[],end=-Infinity
 const flush=()=>{if(band.length){const start=Math.min(...band.map(n=>n[axis]??0));for(const n of band)n[axis]=start}band=[]}
 for(const n of sorted){const start=n[axis]??0;if(start>=end){flush();end=start+(n[size]??0)}else end=Math.max(end,start+(n[size]??0));band.push(n)}flush()
 const byId=new Map(nodes.map(n=>[n.id,n]))
 const center=(parent:string,children:string[])=>{const p=byId.get(bindingId('node',parent)),cs=children.map(id=>byId.get(bindingId('node',id))).filter((n):n is ElkNode=>!!n);if(p&&cs.length){const first=Math.min(...cs.map(n=>(n[cross]??0)+(n[crossSize]??0)/2)),last=Math.max(...cs.map(n=>(n[cross]??0)+(n[crossSize]??0)/2));p[cross]=(first+last-(p[crossSize]??0))/2}}
 if(content.kind==='mindmap'){
  const depth=(id:string,seen=new Set<string>()):number=>{if(seen.has(id))return 0;seen.add(id);const p=content.nodes.find(n=>n.id===id)?.parentId;return p?1+depth(p,seen):0}
  for(const p of [...content.nodes].sort((a,b)=>depth(b.id)-depth(a.id)))center(p.id,content.nodes.filter(n=>n.parentId===p.id).map(n=>n.id))
 }else if(content.kind==='flowchart'){
  const roots=content.nodes.filter(n=>n.kind!=='note'&&!content.edges.some(e=>e.target===n.id&&e.kind!=='feedback'&&e.source!==e.target));if(roots.length===1)center(roots[0].id,content.edges.filter(e=>e.source===roots[0].id&&e.target!==e.source&&e.kind!=='feedback').map(e=>e.target))
 }
 const minX=Math.min(0,...nodes.map(n=>n.x??0)),minY=Math.min(0,...nodes.map(n=>n.y??0));for(const n of nodes){n.x=(n.x??0)-minX;n.y=(n.y??0)-minY}
 return graph
}
export function compactLayoutCost(graph:ElkNode){const {width,height}=layoutExtent(graph);return Math.abs(Math.log(width/height/1.4))+Math.sqrt(width*height)/5000}
