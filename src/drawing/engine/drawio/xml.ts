import {DOMImplementation, DOMParser, XMLSerializer} from '@xmldom/xmldom'

export const MAX_DRAWIO_BYTES=5*1024*1024
export const MAX_DRAWIO_CELLS=10000
export interface NativeCell {id:string;object:Element;cell:Element}
export interface NativeDocument {document:Document;file:Element;diagram:Element;model:Element;root:Element;cells:Map<string,NativeCell>}
export function fail(code:string,message:string):never {throw new Error(`${code}: ${message}`)}
export function children(e:Element,name?:string):Element[]{
  const result:Element[]=[]
  for(let i=0;i<e.childNodes.length;i++){const n=e.childNodes.item(i);if(n?.nodeType===1&&(!name||n.nodeName===name))result.push(n as Element)}
  return result
}
export function attr(e:Element,name:string):string|undefined {return e.hasAttribute(name)?e.getAttribute(name)!:undefined}
export function element(doc:Document,name:string,attributes:Record<string,string|number|undefined>={}):Element{
  const e=doc.createElement(name)
  for(const [k,v] of Object.entries(attributes))if(v!==undefined)e.setAttribute(k,String(v))
  return e
}
export function serialize(document:Document|Element):string{return new XMLSerializer().serializeToString(document)}
export function newDocument():Document{return new DOMImplementation().createDocument(null,'mxfile',null)}

// Only an uncompressed, single-page mxfile is accepted. Business projection never
// interprets DTDs, entities, scripts, compressed text or unknown document formats.
export function parseNative(xml:string,options:{allowDanglingEdgeEndpoints?:boolean}={}):NativeDocument{
  if(typeof xml!=='string'||!xml.trim())fail('INVALID_XML','XML 不能为空')
  if(new TextEncoder().encode(xml).byteLength>MAX_DRAWIO_BYTES)fail('XML_TOO_LARGE','XML 超过 5 MiB')
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(xml))fail('INVALID_XML','XML 含非法控制字符')
  if(/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml))fail('UNSAFE_XML','禁止 DTD 和实体声明')
  if(/<\?(?!xml\s)[\s\S]*?\?>/i.test(xml))fail('UNSAFE_XML','禁止 XML 处理指令')
  const errors:string[]=[]
  const document=new DOMParser({errorHandler:{warning:m=>errors.push(String(m)),error:m=>errors.push(String(m)),fatalError:m=>errors.push(String(m))}}).parseFromString(xml,'application/xml')
  if(errors.length||!document?.documentElement)fail('INVALID_XML','XML 解析失败')
  const file=document.documentElement
  if(file.nodeName!=='mxfile')fail('UNSUPPORTED_XML','仅接受单页 mxfile')
  const diagrams=children(file,'diagram')
  if(diagrams.length!==1||children(file).length!==1)fail('UNSUPPORTED_MULTIPAGE','仅接受单页文档')
  const diagram=diagrams[0],models=children(diagram,'mxGraphModel')
  if(models.length!==1||children(diagram).length!==1)fail('UNSUPPORTED_COMPRESSED_XML','仅接受未压缩 mxGraphModel')
  for(let i=0;i<diagram.childNodes.length;i++){const n=diagram.childNodes.item(i);if((n?.nodeType===3||n?.nodeType===4)&&n.nodeValue?.trim())fail('UNSUPPORTED_COMPRESSED_XML','禁止混入压缩页内容')}
  const model=models[0],roots=children(model,'root')
  if(roots.length!==1||children(model).length!==1)fail('INVALID_XML','缺少唯一 root')
  // Bound depth and element count before any recursive traversal.
  const stack:Array<[Element,number]>=[[file,0]];let count=0
  while(stack.length){const [node,depth]=stack.pop()!;if(depth>128||++count>MAX_DRAWIO_CELLS*8)fail('XML_TOO_COMPLEX','XML 结构过深或过大');if(['script','iframe','foreignObject'].includes(node.localName||node.nodeName))fail('UNSAFE_XML','禁止主动内容');for(const e of children(node))stack.push([e,depth+1])}
  const root=roots[0],entries=children(root),cells=new Map<string,NativeCell>()
  if(entries.length>MAX_DRAWIO_CELLS)fail('XML_TOO_COMPLEX','cell 数量超限')
  for(const object of entries){
    const direct=object.nodeName==='mxCell',nested=children(object,'mxCell')
    if(!direct&&(nested.length!==1||children(object).length!==1))fail('INVALID_CELL','对象必须包含一个 mxCell')
    const cell=direct?object:nested[0],id=attr(object,'id')||attr(cell,'id')
    if(!id||cells.has(id))fail('DUPLICATE_CELL_ID','cell ID 缺失或重复')
    if(!direct&&attr(cell,'id')&&attr(cell,'id')!==id)fail('INVALID_CELL','包装对象和 cell 身份不一致')
    cells.set(id,{id,object,cell})
  }
  if(!cells.has('0')||attr(cells.get('0')!.cell,'parent'))fail('INVALID_ROOT','必须有无 parent 的根 cell 0')
  for(const entry of cells.values()){
    for(const name of ['parent','source','target']){const ref=attr(entry.cell,name);if(ref&&!cells.has(ref)&&!(options.allowDanglingEdgeEndpoints&&name!=='parent'&&attr(entry.cell,'edge')==='1'))fail('BROKEN_REFERENCE',`${entry.id} 的 ${name} 引用不存在`)}
    if(entry.id!=='0'&&!attr(entry.cell,'parent'))fail('BROKEN_REFERENCE',`${entry.id} 缺少 parent`)
    const seen=new Set<string>();let current:NativeCell|undefined=entry
    while(current){if(seen.has(current.id))fail('CYCLIC_PARENT','cell parent 形成循环');seen.add(current.id);const parent=attr(current.cell,'parent');current=parent?cells.get(parent):undefined}
    if(attr(entry.cell,'edge')==='1')for(const name of ['source','target']){const ref=attr(entry.cell,name);if(ref&&cells.has(ref)&&attr(cells.get(ref)!.cell,'vertex')!=='1')fail('BROKEN_REFERENCE','连线端点必须为顶点')}
  }
  return {document,file,diagram,model,root,cells}
}

// HTML labels are decoded to inert text. No DOM is inserted into a browser.
export function cellText(entry:NativeCell):string{
  const value=attr(entry.object,entry.object===entry.cell?'value':'label')??''
  if(!/(?:^|;)html=1(?:;|$)/.test(attr(entry.cell,'style')||''))return value
  const html=value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/(div|p|li|h[1-6])\s*>/gi,'\n')
  const doc=new DOMParser({errorHandler:()=>{}}).parseFromString(`<body>${html}</body>`,'text/html')
  return (doc.documentElement.textContent||'').replace(/\u00a0/g,' ').replace(/\n$/,'')
}
export function setCellText(entry:NativeCell,value:string){
  // A plain label remains literal text even if it contains < > or ampersands.
  const html=/(?:^|;)html=1(?:;|$)/.test(attr(entry.cell,'style')||'')
  let text=html?value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\n','<br>'):value
  if(html&&attr(entry.object,'fmTextLayout')==='phase-vertical')text=`<div style="width:32px;line-height:32.8px;white-space:normal;">${text}</div>`
  entry.object.setAttribute(entry.object===entry.cell?'value':'label',text)
}

/** Canonical render state: viewport and XML formatting do not create revisions. */
export function drawioRenderSignature(xml:string):string{
  const native=parseNative(xml)
  const attributes=(e:Element,ignore:Set<string>=new Set(),numericDefaults=false)=>{
    const pairs:Array<[string,string]>=[]
    for(let i=0;i<e.attributes.length;i++){const a=e.attributes.item(i)!;if(ignore.has(a.name))continue
      if(numericDefaults&&['x','y','width','height','relative'].includes(a.name)&&Number(a.value)===0)continue
      const value=numericDefaults&&['x','y','width','height','relative'].includes(a.name)&&Number.isFinite(Number(a.value))?String(Number(a.value)):a.value
      pairs.push([a.name,value])
    }
    return pairs.sort(([a],[b])=>a<b?-1:a>b?1:0)
  }
  const describe=(e:Element):unknown=>({tag:e.nodeName,attributes:attributes(e,new Set(),['mxGeometry','mxPoint','mxRectangle'].includes(e.nodeName)),children:children(e).map(describe),text:children(e).length?undefined:(e.textContent?.trim()||undefined)})
  const byParent=new Map<string,NativeCell[]>()
  for(const cell of native.cells.values()){const parent=attr(cell.cell,'parent')??'';const siblings=byParent.get(parent)??[];siblings.push(cell);byParent.set(parent,siblings)}
  const describeCell=(entry:NativeCell):unknown=>({id:entry.id,object:entry.object===entry.cell?undefined:attributes(entry.object),cell:attributes(entry.cell,new Set(['id'])),geometry:children(entry.cell).map(describe),children:(byParent.get(entry.id)??[]).map(describeCell)})
  const ignoredModel=new Set(['dx','dy','grid','gridSize','guides','tooltips','connect','arrows','fold','page','pageScale','pageWidth','pageHeight','scrollTop','scrollLeft','scale','translate'])
  for(let i=0;i<native.model.attributes.length;i++){const name=native.model.attributes.item(i)!.name;if(name.startsWith('fm'))ignoredModel.add(name)}
  return JSON.stringify({model:attributes(native.model,ignoredModel),diagram:attributes(native.diagram),cells:(byParent.get('')??[]).map(describeCell)})
}
