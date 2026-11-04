// Frozen copy of the pre-optimization visitor, for differential tests only.
import {DOMParser} from '@xmldom/xmldom'
import {createHash} from 'node:crypto'
import {RUNTIME_FONT_ALIASES,RUNTIME_FONT_FAMILY} from '../../src/drawing/engine/runtime-assets'
import {NativeRenderError} from '../../server/rendering/types'
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
export function originalSvgSignature(svg:string){
 if(/<!DOCTYPE|<!ENTITY/i.test(svg))throw new NativeRenderError('UNSAFE_SVG','SVG禁止DTD/实体')
 let bad=false;const doc=new DOMParser({errorHandler:{warning:()=>{bad=true},error:()=>{bad=true},fatalError:()=>{bad=true}}}).parseFromString(svg,'application/xml')
 if(bad||doc.documentElement.localName!=='svg')throw new NativeRenderError('INVALID_SVG','原生SVG解析失败')
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
