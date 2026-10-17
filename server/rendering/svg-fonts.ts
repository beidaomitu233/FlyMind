import {DOMParser,XMLSerializer} from '@xmldom/xmldom'
import {createHash} from 'node:crypto'
import {RUNTIME_FONT_ALIASES,RUNTIME_FONT_FAMILY,RUNTIME_FONT_SHA256} from '../../src/drawing/engine/runtime-assets'
import {NativeRenderError} from './types'
const NS='http://www.w3.org/2000/svg'
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
 const doc=parse(svg)
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
 const before=svgDrawingSignature(svg),doc=parse(svg)
 for(const el of Array.from(doc.getElementsByTagName('*'))){
  for(const a of Array.from(el.attributes))if(a.localName==='font-family')el.setAttribute(a.name,family(a.value));else if(a.localName==='style')el.setAttribute(a.name,rewriteCSS(a.value))
  if(el.localName==='style'){const css=rewriteCSS(el.textContent??'');while(el.firstChild)el.removeChild(el.firstChild);if(css.trim())el.appendChild(doc.createTextNode(css));else el.parentNode?.removeChild(el)}
 }
 let defs=doc.getElementsByTagName('defs')[0];if(!defs){defs=doc.createElementNS(NS,'defs');doc.documentElement.insertBefore(defs,doc.documentElement.firstChild)}
 const style=doc.createElementNS(NS,'style');style.setAttribute('type','text/css');style.setAttribute('data-runtime-font','canonical');style.appendChild(doc.createTextNode(`@font-face{font-family:"${RUNTIME_FONT_FAMILY}";src:url("data:font/otf;base64,${font.toString('base64')}") format("opentype");font-weight:400;font-style:normal;}`));defs.appendChild(style)
 const result=new XMLSerializer().serializeToString(doc)
 if(svgDrawingSignature(result)!==before)throw new NativeRenderError('SVG_DRAWING_CHANGED','字体资源封装改变了图形/文字/paint')
 return result
}
