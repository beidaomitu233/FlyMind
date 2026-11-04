import {DOMParser} from '@xmldom/xmldom'
import {NativeRenderError} from './types'

/** Inspect decoded XML values, never entity-encoded serialized markup. */
export function inspectNativeSVGResources(svg:string,options:{inspectDimensions?:boolean}={}):{urls:string[];links:string[];metadataValid?:boolean}{
 if(/<!DOCTYPE|<!ENTITY/i.test(svg))throw new NativeRenderError('UNSAFE_SVG','SVG禁止DTD/实体声明')
 let invalid=false;const doc=new DOMParser({errorHandler:{warning:()=>{invalid=true},error:()=>{invalid=true},fatalError:()=>{invalid=true}}}).parseFromString(svg,'application/xml')
 if(invalid||doc.documentElement?.localName!=='svg')throw new NativeRenderError('UNSAFE_SVG','SVG结构无效')
 const urls:string[]=[],links:string[]=[]
 const css=(text:string)=>{if(/@import\b/i.test(text))throw new NativeRenderError('UNRESOLVED_RESOURCE','SVG不允许CSS import');for(const match of text.matchAll(/url\(([^)]+)\)/gi))urls.push(match[1].trim().replace(/^(["'])(.*)\1$/,'$2'))}
 for(const e of Array.from(doc.getElementsByTagName('*'))){
  if(['script','iframe','object'].includes(e.localName))throw new NativeRenderError('UNSAFE_SVG','原生SVG包含活动脚本元素')
  for(const a of Array.from(e.attributes)){
   if(/^on/i.test(a.name))throw new NativeRenderError('UNSAFE_SVG','原生SVG包含事件处理器')
   css(a.value)
   if(a.localName==='href'||a.localName==='src'){if(e.localName==='a'){if(!/^(https?:|mailto:|#)/i.test(a.value))throw new NativeRenderError('UNSAFE_SVG','原生SVG包含非安全链接')}else links.push(a.value)}
  }
  if(e.localName==='style')css(e.textContent??'')
 }
 const unresolved=[...urls,...links].filter(url=>!url.startsWith('data:')&&!url.startsWith('#'))
 if(unresolved.length)throw new NativeRenderError('UNRESOLVED_RESOURCE',`SVG仍引用外部资源：${unresolved.join(';').slice(0,500)}`)
 if(options.inspectDimensions){const root=doc.documentElement,rawViewBox=root.getAttribute('viewBox')||'',rawWidth=root.getAttribute('width')||'',rawHeight=root.getAttribute('height')||''
  // Avoid moving unbounded split/parse work into the packaging worker. The
  // independent validator remains authoritative for unusual dimensions.
  if(Math.max(rawViewBox.length,rawWidth.length,rawHeight.length)>4096)return {urls,links}
  try{const viewBox=rawViewBox.trim().split(/[ ,]+/).map(Number),width=parseFloat(rawWidth),height=parseFloat(rawHeight)
   return {urls,links,metadataValid:viewBox.length===4&&viewBox.every(Number.isFinite)&&viewBox[2]>0&&viewBox[3]>0||width>0&&height>0}
  }catch{return {urls,links}}
 }
 return {urls,links}
}
