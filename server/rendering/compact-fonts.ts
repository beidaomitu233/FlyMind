import {BROWSER_FONT_MANIFEST} from '../../src/drawing/engine/browser-font-manifest'
import {RUNTIME_FONT_ALIASES} from '../../src/drawing/engine/runtime-assets'
import {attr,type NativeDocument} from '../../src/drawing/engine/drawio/xml'
import {DOMParser} from '@xmldom/xmldom'
import {technologyBrandIcons} from '../../src/drawing/engine/technology-brand-icons'
import {TECHNOLOGY_ICONS} from '../../src/drawing/engine/drawio/technology-icons-data'

// Only built-in geometric primitives with no stencil-generated text. Named
// styles, images, custom shapes and unrecognized properties use the full font.
const shapes=new Set(['text','ellipse','rhombus','swimlane','group'])
const geometryShapes=new Set(['rectangle','ellipse','rhombus','table','tableRow','partialRectangle','cylinder','image'])
const properties=new Set(['shape','image','imageAspect','aspect','movable','resizeWidth','resizeHeight','rounded','fontFamily','fontSize','html','whiteSpace','fontStyle','fontColor','align','verticalAlign','labelPosition','verticalLabelPosition','spacing','spacingLeft','spacingRight','fillColor','strokeColor','strokeWidth','strokeOpacity','arcSize','collapsible','resizable','connectable','ignoreEdge','jettySize','labelWidth','labelBackgroundColor','startArrow','endArrow','startFill','endFill','dashed','dashPattern','exitX','exitY','exitPerimeter','entryX','entryY','entryPerimeter','edgeStyle','curved','bezier','noEdgeStyle','childLayout','startSize','container','recursiveResize','expand','fixedHeader','rowLines','columnLines','swimlaneFillColor','horizontal','swimlaneHead','swimlaneBody','dropTarget','top','left','bottom','right','overflow'])
const arrows=new Set(['none','block','classic','open','oval','diamond'])
const repeatablePresentation=new Set(['fillColor','strokeColor','fontColor','align','verticalAlign','spacing','spacingLeft','spacingRight','strokeWidth','strokeOpacity','rounded','arcSize','collapsible'])
const ranges=BROWSER_FONT_MANIFEST.files.map(file=>({file,ranges:file.unicodeRange.split(',').map(part=>{const [a,b]=part.slice(2).split('-').map(n=>parseInt(n,16));return [a,b??a] as const})}))
function textlessFixedIcon(svg:string){
 let invalid=false
 const doc=new DOMParser({errorHandler:{warning:()=>{invalid=true},error:()=>{invalid=true},fatalError:()=>{invalid=true}}}).parseFromString(svg,'image/svg+xml')
 if(invalid||doc.documentElement?.nodeName!=='svg')return false
 const tags=new Set(['svg','path','title','rect','circle','ellipse']),attributes=new Set(['fill','role','viewBox','xmlns','d','stroke','stroke-width','stroke-linecap','stroke-linejoin','x','y','width','height','rx','cx','cy','r','ry']),stack:Element[]=[doc.documentElement]
 while(stack.length){const el=stack.pop()!;if(!tags.has(el.nodeName))return false
  for(let i=0;i<el.attributes.length;i++){const a=el.attributes.item(i)!;if(!attributes.has(a.name)||/url\s*\(|javascript:/i.test(a.value))return false}
  for(let n=el.firstChild;n;n=n.nextSibling)if(n.nodeType===1)stack.push(n as Element);else if((n.nodeType===3||n.nodeType===4)&&el.nodeName!=='title'&&n.nodeValue?.trim())return false;else if(![1,3,4].includes(n.nodeType))return false
 }
 return true
}
let fixedIcons:Set<string>|undefined
function knownFixedIcon(value:string){
 fixedIcons??=new Set([...new Set([...Object.values(technologyBrandIcons),...Object.values(TECHNOLOGY_ICONS).map(icon=>icon.svg)])].filter(textlessFixedIcon).map(svg=>'data:image/svg+xml,'+encodeURIComponent(svg)))
 return fixedIcons.has(value)
}

/** HTML is accepted only as well-formed, static simple text markup. */
function simpleHtmlText(value:string):string|undefined{
 if(value.includes('\\')||value.includes('%')||/placeholder/i.test(value)||/<!|<\?/.test(value)||/&(?!amp;|lt;|gt;|quot;|apos;|nbsp;|#\d+;|#x[0-9a-fA-F]+;)/.test(value))return
 const markup=value.replace(/&nbsp;/g,'&#160;').replace(/<br\s*>/gi,'<br/>')
 let invalid=false
 const doc=new DOMParser({errorHandler:{warning:()=>{invalid=true},error:()=>{invalid=true},fatalError:()=>{invalid=true}}}).parseFromString('<body>'+markup+'</body>','application/xml')
 if(invalid||doc.documentElement?.nodeName!=='body')return
 const stack:Element[]=[doc.documentElement]
 while(stack.length){const el=stack.pop()!
  if(!['body','div','span','b','strong','i','em','br'].includes(el.nodeName))return
  for(let i=0;i<el.attributes.length;i++){
   const a=el.attributes.item(i)!;if(a.name!=='style'||a.value.includes('\\'))return
   for(const part of a.value.split(';')){if(!part.trim())continue;const match=/^\s*([a-z-]+)\s*:\s*([a-zA-Z0-9 .#-]+)\s*$/.exec(part);if(!match)return
    const [,key,val]=match
    if(['width','height','line-height'].includes(key)){if(!/^\d+(?:\.\d+)?px$/.test(val.trim()))return}
    else if(key==='white-space'){if(!['normal','nowrap'].includes(val.trim()))return}
    else if(key==='text-align'){if(!['left','right','center'].includes(val.trim()))return}
    else return
   }
  }
  for(let child=el.firstChild;child;child=child.nextSibling)if(child.nodeType===1)stack.push(child as Element);else if(child.nodeType!==3&&child.nodeType!==4)return
 }
 const text=doc.documentElement.textContent??''
 return text.includes('%')?undefined:text
}

/** Conservative closed set; undefined means use the original complete OTF. */
export function compactFontSubset(xml:string,native:NativeDocument):string[]|undefined{
 if(/placeholder/i.test(xml))return
 const math=attr(native.model,'math');if(math!==undefined&&math!==''&&math!=='0')return
 const htmlTexts:string[]=[]
 for(const entry of native.cells.values()){
  const style=attr(entry.cell,'style')??'',seen=new Map<string,string>()
  let html:string|undefined
  for(const token of style.split(';')){
   if(!token)continue
   const equal=token.indexOf('=')
   if(equal<0){if(!shapes.has(token)||seen.has('shape'))return;seen.set('shape',token);continue}
   const key=token.slice(0,equal),value=token.slice(equal+1)
   if(!properties.has(key)||seen.has(key)&&seen.get(key)!==value&&!repeatablePresentation.has(key)||!value||(key==='image'?!knownFixedIcon(value):!/^[a-zA-Z0-9 .,#_-]+$/.test(value)))return
   seen.set(key,value)
   if(key==='html'){if(value!=='0'&&value!=='1')return;html=value}
   if(key==='shape'&&!geometryShapes.has(value))return
   if(key==='fontFamily'&&!(RUNTIME_FONT_ALIASES as readonly string[]).includes(value))return
   if(key==='whiteSpace'&&value!=='wrap')return
   if(key==='edgeStyle'&&value!=='orthogonalEdgeStyle')return
   if(key==='childLayout'&&value!=='tableLayout')return
   if(key==='overflow'&&value!=='visible')return
   if((key==='startArrow'||key==='endArrow')&&!arrows.has(value))return
  }
  const label=attr(entry.object,entry.object===entry.cell?'value':'label')??''
  if(seen.has('image')&&seen.get('shape')!=='image'||seen.get('shape')==='image'&&!seen.has('image'))return
  if(/%[^%\r\n]+%/.test(label)||label&&html===undefined)return
  if(html==='1'){const text=simpleHtmlText(label);if(text===undefined)return;htmlTexts.push(text)}
 }
 const points=new Set<number>()
 const scan=(text:string)=>{
  if(/placeholder/i.test(text))return false
  for(const char of text){const p=char.codePointAt(0)!
   if(/[\p{Mark}\p{Format}]/u.test(char))return false
   if(p===9||p===10||p===13)continue
   if(!(ranges[0].ranges.some(([a,b])=>p>=a&&p<=b)||p>=0x2190&&p<=0x2193||/\p{Script=Han}/u.test(char)))return false
   points.add(p)
  }
  return true
 }
 // Raw XML is a superset, while DOM traversal adds decoded numeric entities
 // (including entities encoded inside otherwise inert metadata attributes).
 if(!scan(xml))return
 for(const text of htmlTexts)if(!scan(text))return
 const stack:Node[]=[native.document]
 while(stack.length){const node=stack.pop()!
  if(node.nodeType===1){const el=node as Element
   if(!['mxfile','diagram','mxGraphModel','root','UserObject','object','mxCell','mxGeometry','mxPoint','Array'].includes(el.nodeName))return
   for(let i=0;i<el.attributes.length;i++){const attribute=el.attributes.item(i)!;if(/image/i.test(attribute.name)||/data:image/i.test(attribute.value)&&!(el.nodeName==='mxCell'&&attribute.name==='style')||!scan(attribute.value))return}
  }
  else if((node.nodeType===3||node.nodeType===4)&&!scan(node.nodeValue??''))return
  for(let child=node.firstChild;child;child=child.nextSibling)stack.push(child)
 }
 if(ranges.length!==95||ranges[0].file.file!=='FlyMindCJKWeb-core.woff2')return
 for(let p=0x20;p<=0x7e;p++)if(!ranges[0].ranges.some(([a,b])=>p>=a&&p<=b))return
 const selected=new Set<string>([ranges[0].file.file])
 for(const point of points){const found=ranges.filter(entry=>entry.ranges.some(([a,b])=>point>=a&&point<=b));if(found.length!==1)return;selected.add(found[0].file.file)}
 const files=BROWSER_FONT_MANIFEST.files.filter(file=>selected.has(file.file))
 if(files.reduce((total,file)=>total+file.bytes,0)>2*1024*1024)return
 return files.map(file=>file.file)
}
