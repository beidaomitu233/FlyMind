import {DOMParser,XMLSerializer} from '@xmldom/xmldom'
import {createHash} from 'node:crypto'
import {RUNTIME_FONT_ALIASES,RUNTIME_FONT_FAMILY,RUNTIME_FONT_SHA256} from '../../src/drawing/engine/runtime-assets'
import {NativeRenderError} from './types'
import {inspectNativeSVGResources} from './svg-resources'
import {BROWSER_FONT_MANIFEST} from '../../src/drawing/engine/browser-font-manifest'
import {sha256Base64} from './base64-sha'
import {constants as bufferConstants} from 'node:buffer'
const NS='http://www.w3.org/2000/svg'
const originalArrayMap=Array.prototype.map,originalArrayFilter=Array.prototype.filter,originalArraySort=Array.prototype.sort,originalArrayFrom=Array.from,originalStringify=JSON.stringify,originalSpecies=Object.getOwnPropertyDescriptor(Array,Symbol.species)
function family(value:string){
 const parts=value.trim().split(',').map(v=>v.trim().replace(/^(['"])(.*)\1$/,'$2'))
 if(!parts.length||parts.some(v=>!(RUNTIME_FONT_ALIASES as readonly string[]).includes(v)))throw new NativeRenderError('UNSUPPORTED_FONT',`SVG无供应字体：${value.slice(0,200)}`)
 return RUNTIME_FONT_FAMILY
}
function withoutFaces(css:string){
 const clean=css.replace(/@font-face\s*\{([^{}]*)\}/gi,(_rule,body:string)=>{const name=/(?:^|;)\s*font-family\s*:\s*([^;]+)/i.exec(body)?.[1];if(!name)throw new NativeRenderError('UNSUPPORTED_FONT','原生font-face缺少family');family(name);return ''})
 if(/@font-face\b/i.test(clean))throw new NativeRenderError('UNSUPPORTED_FONT','不支持的font-face规则')
 return clean
}
function rewriteCSS(css:string){return withoutFaces(css).replace(/(^|[;{])(\s*font-family\s*:\s*)([^;}]+)/gi,(_m,before:string,key:string,value:string)=>`${before}${key}"${family(value)}"`)}
function parse(svg:string){
 if(/<!DOCTYPE|<!ENTITY/i.test(svg))throw new NativeRenderError('UNSAFE_SVG','SVG禁止DTD/实体')
 let bad=false;const doc=new DOMParser({errorHandler:{warning:()=>{bad=true},error:()=>{bad=true},fatalError:()=>{bad=true}}}).parseFromString(svg,'application/xml')
 if(bad||doc.documentElement.localName!=='svg')throw new NativeRenderError('INVALID_SVG','原生SVG解析失败')
 return doc
}
/** All text, geometry, paint, labels and non-font CSS remain in this signature. */
export function svgDrawingSignature(svg:string):string{
 return documentDrawingSignature(parse(svg))
}
function documentDrawingSignature(doc:Document):string{
 // Keep the original route for unusually large/deep documents and altered
 // JSON prototypes. It also preserves the original overlength error order.
 if(!signatureStreamSafe(doc))return documentDrawingSignatureOriginal(doc)
 const hash=createHash('sha256');let pending:string[]=[],pendingLength=0
 const flush=()=>{if(pendingLength){hash.update(pending.join(''));pending=[];pendingLength=0}}
 const emit=(part:string)=>{if(part.length>=65536){flush();hash.update(part)}else{pending.push(part);pendingLength+=part.length;if(pendingLength>=65536)flush()}}
 function visit(node:Node,before:()=>void):boolean{
  if(node.nodeType===1){const el=node as Element;if(el.getAttribute('data-runtime-font')==='canonical')return false
   if(el.localName==='style'){const text=rewriteCSS(el.textContent??'');if(!text.trim())return false;before();emit(JSON.stringify({tag:el.tagName,css:text}));return true}
   const attributes=Array.from(el.attributes).map(a=>[a.name,a.localName==='font-family'?family(a.value):a.localName==='style'?rewriteCSS(a.value):a.value]).sort(([a],[b])=>a<b?-1:a>b?1:0)
   let started=false,count=0
   const start=()=>{if(!started){before();emit('{"tag":');emit(JSON.stringify(el.tagName));emit(',"attributes":');emit(JSON.stringify(attributes));emit(',"children":[');started=true}}
   if(el.localName!=='defs'||attributes.length)start()
   for(let child=node.firstChild;child;child=child.nextSibling)visit(child,()=>{start();if(count++)emit(',')})
   if(!started)return false
   emit(']}');return true
  }
  before();emit(JSON.stringify(node.nodeType===3||node.nodeType===4?{text:node.nodeValue}:{type:node.nodeType,value:node.nodeValue}));return true
 }
 if(!visit(doc.documentElement,()=>{}))return documentDrawingSignatureOriginal(doc)
 flush();return hash.digest('hex')
}

// DOMs here are created by the local parser and never exposed to a caller.
// The conservative bound covers JSON escaping and font-family expansion; it
// avoids changing JSON.stringify's overlength failure behavior. Canonical font
// subtrees are skipped by both this scan and the original signature visitor.
function signatureStreamSafe(doc:Document):boolean{
 if('toJSON'in Object.prototype||'toJSON'in Array.prototype||Array.prototype.map!==originalArrayMap||Array.prototype.filter!==originalArrayFilter||Array.prototype.sort!==originalArraySort||Array.from!==originalArrayFrom||JSON.stringify!==originalStringify)return false
 const ctor=Object.getOwnPropertyDescriptor(Array.prototype,'constructor'),species=Object.getOwnPropertyDescriptor(Array,Symbol.species)
 if(ctor?.value!==Array||species?.get!==originalSpecies?.get||species?.set!==originalSpecies?.set||species?.value!==originalSpecies?.value)return false
 let node:Node|null=doc.documentElement,depth=0,count=0,bound=0
 while(node){
  if(++count>100000||depth>128)return false
  let skip=false;bound+=128
  if(node.nodeType===1){const el=node as Element;skip=el.getAttribute('data-runtime-font')==='canonical';bound+=64*el.tagName.length
   if(!skip)for(const a of Array.from(el.attributes))bound+=64*(a.name.length+a.value.length)
  }else bound+=64*(node.nodeValue?.length??0)
  if(bound>bufferConstants.MAX_STRING_LENGTH)return false
  if(!skip&&node.firstChild){node=node.firstChild;depth++;continue}
  while(node!==doc.documentElement&&!node.nextSibling){node=node.parentNode;depth--;if(!node)return false}
  if(node===doc.documentElement)break
  node=node.nextSibling
 }
 return true
}

function documentDrawingSignatureOriginal(doc:Document):string{
 function visit(node:Node):unknown{
  if(node.nodeType===1){const el=node as Element;if(el.getAttribute('data-runtime-font')==='canonical')return undefined
   if(el.localName==='style'){const text=rewriteCSS(el.textContent??'');if(!text.trim())return undefined;return {tag:el.tagName,css:text}}
   const attributes=Array.from(el.attributes).map(a=>[a.name,a.localName==='font-family'?family(a.value):a.localName==='style'?rewriteCSS(a.value):a.value]).sort(([a],[b])=>a<b?-1:a>b?1:0),children=Array.from(el.childNodes).map(visit).filter(x=>x!==undefined)
   if(el.localName==='defs'&&!attributes.length&&!children.length)return undefined
   return {tag:el.tagName,attributes,children}
  }
  if(node.nodeType===3||node.nodeType===4)return {text:node.nodeValue}
  return {type:node.nodeType,value:node.nodeValue}
 }
 return createHash('sha256').update(JSON.stringify(visit(doc.documentElement))).digest('hex')
}
/** Native SVG resource packaging only. Never changes the source draw.io XML. */
export function packageNativeSVGFonts(svg:string,font:Buffer){
 if(createHash('sha256').update(font).digest('hex')!==RUNTIME_FONT_SHA256)throw new NativeRenderError('FONT_HASH_MISMATCH','SVG封装字体SHA不匹配')
 return packageNativeSVGResourceFonts(svg,[{bytes:font,sha256:RUNTIME_FONT_SHA256,format:'opentype'}])
}
export interface SVGFontResource {bytes:Buffer;sha256:string;format:'opentype'|'woff2';unicodeRange?:string}
/** Only hash-pinned source/derived supplies may be embedded; no caller URLs. */
export function packageNativeSVGResourceFonts(svg:string,fonts:readonly SVGFontResource[]){
 if(!fonts.length)throw new NativeRenderError('FONT_NOT_EMBEDDED','缺少离线字体')
 for(const font of fonts){const approved=font.format==='opentype'?font.sha256===RUNTIME_FONT_SHA256:BROWSER_FONT_MANIFEST.files.some(f=>f.sha256===font.sha256&&f.unicodeRange===font.unicodeRange)
  if(!approved||createHash('sha256').update(font.bytes).digest('hex')!==font.sha256)throw new NativeRenderError('FONT_HASH_MISMATCH','SVG封装字体SHA不匹配')}
 const doc=parse(svg),before=documentDrawingSignature(doc)
 for(const el of Array.from(doc.getElementsByTagName('*'))){
  for(const a of Array.from(el.attributes))if(a.localName==='font-family')el.setAttribute(a.name,family(a.value));else if(a.localName==='style')el.setAttribute(a.name,rewriteCSS(a.value))
  if(el.localName==='style'){const css=rewriteCSS(el.textContent??'');while(el.firstChild)el.removeChild(el.firstChild);if(css.trim())el.appendChild(doc.createTextNode(css));else el.parentNode?.removeChild(el)}
 }
 let defs=doc.getElementsByTagName('defs')[0];if(!defs){defs=doc.createElementNS(NS,'defs');doc.documentElement.insertBefore(defs,doc.documentElement.firstChild)}
 // Validate the rewritten drawing before adding the large, trusted font payload.
 // Nothing except our generated canonical style is changed after these checks.
 const serializer=new XMLSerializer(),drawing=serializer.serializeToString(doc)
 if(svgDrawingSignature(drawing)!==before)throw new NativeRenderError('SVG_DRAWING_CHANGED','字体资源封装改变了图形/文字/paint')
 const {urls,links}=inspectNativeSVGResources(drawing)
 const embeddedFonts=[...urls,...links].filter(url=>/^data:(font\/|application\/(?:x-font-|font|octet-stream))/i.test(url))
 if(embeddedFonts.some(url=>sha256Base64(url.slice(url.indexOf(',')+1))!==RUNTIME_FONT_SHA256))throw new NativeRenderError('FONT_NOT_EMBEDDED','SVG未嵌入固定SHA字体')
 const style=doc.createElementNS(NS,'style');style.setAttribute('type','text/css');style.setAttribute('data-runtime-font','canonical');style.appendChild(doc.createTextNode(fonts.map(font=>`@font-face{font-family:"${RUNTIME_FONT_FAMILY}";src:url("data:font/${font.format==='woff2'?'woff2':'otf'};base64,${font.bytes.toString('base64')}") format("${font.format}");font-weight:400;font-style:normal;${font.unicodeRange?'unicode-range:'+font.unicodeRange+';':''}}`).join('\n')));defs.appendChild(style)
 // Only this generated, hash-verified font style is appended after validation.
 // Keep the existing signature treatment of canonical resource markers unchanged.
 return serializer.serializeToString(doc)
}

// draw.io's HTML labels use these simple flex declarations. Recognize only
// this narrow grammar; complex or unfamiliar declarations retain the full
// font whenever the original content/text-transform detector would trigger.
// This only affects font selection and never changes the SVG or its CSS.
function knownSimpleFlexStyle(css:string){
 if(css.length>65536||/[^a-zA-Z0-9:;.\- \t\r\n\f]/.test(css))return false
 const parts=css.split(';');if(parts.at(-1)?.trim()==='')parts.pop()
 const seen=new Set<string>();let justify=false
 for(const part of parts){
  const match=/^[ \t\r\n\f]*([a-zA-Z][a-zA-Z0-9-]*)[ \t\r\n\f]*:[ \t\r\n\f]*([a-zA-Z0-9.\- \t\r\n\f]+?)[ \t\r\n\f]*$/.exec(part)
  if(!match)return false
  const name=match[1].toLowerCase(),value=match[2].trim().toLowerCase().replace(/[ \t\r\n\f]+/g,' ')
  if(seen.has(name))return false;seen.add(name)
  if(name==='justify-content'){if(value!=='unsafe center'&&value!=='unsafe flex-start')return false;justify=true}
  else if(name==='display'){if(value!=='flex')return false}
  else if(name==='align-items'){if(value!=='unsafe center'&&value!=='unsafe flex-start'&&value!=='unsafe flex-end')return false}
  else if(['width','height','padding-top','margin-left'].includes(name)){if(!/^\d+(?:\.\d+)?px$/.test(value))return false}
  else return false
 }
 return justify
}

/** Decode XML entities and include HTML foreignObject text, never style/metadata. */
export function svgVisibleCharacters(svg:string):Set<number>|undefined{
 const doc=parse(svg),points=new Set<number>();let complex=false
 function visit(node:Node){
  if(node.nodeType===1){const el=node as Element,name=el.localName
   // CSS-generated or transformed text is not necessarily present in XML text
   // nodes. Escapes can disguise a property name, so keep the complete font.
   const css=name==='style'?el.textContent??'':el.getAttribute('style')??''
   if(/\\/.test(css)||/\b(?:content|text-transform)\s*:/i.test(css)&&(name==='style'||!knownSimpleFlexStyle(css))||el.hasAttribute('text-transform')||['input','select','textarea'].includes(name))complex=true
   if(['style','metadata','script'].includes(name))return
  }
  if(node.nodeType===3||node.nodeType===4)for(const char of node.nodeValue??''){
   const point=char.codePointAt(0)!
   if(/[\p{Mark}\u200d]/u.test(char)||point>=0x1100&&point<=0x11ff||!/[\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}]/u.test(char))complex=true
   if(point>0x20||point===0x20)points.add(point)
  }
  for(let child=node.firstChild;child;child=child.nextSibling)visit(child)
 }
 visit(doc.documentElement);return complex?undefined:points
}
