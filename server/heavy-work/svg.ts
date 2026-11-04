import {readFile} from 'node:fs/promises'
import {isAbsolute,dirname,join} from 'node:path'
import {createHash} from 'node:crypto'
import {DOMParser} from '@xmldom/xmldom'
import {packageNativeSVGFonts,packageNativeSVGResourceFonts,svgVisibleCharacters,type SVGFontResource} from '../rendering/svg-fonts'
import {inspectNativeSVGResources} from '../rendering/svg-resources'
import {NativeRenderError} from '../rendering/types'
import {RENDER_BUDGET} from '../rendering/budgets'
import {RUNTIME_FONT_SHA256} from '../../src/drawing/engine/runtime-assets'
import {BROWSER_FONT_MANIFEST} from '../../src/drawing/engine/browser-font-manifest'
import {sha256Base64} from '../rendering/base64-sha'

const supplies=BROWSER_FONT_MANIFEST.files.map(file=>({file,ranges:file.unicodeRange.split(',').map(part=>{const [from,to]=part.slice(2).split('-').map(n=>parseInt(n,16));return [from,to??from] as const})}))
async function usedFonts(svg:string,fontFile:string):Promise<SVGFontResource[]|undefined>{
 const points=svgVisibleCharacters(svg);if(!points)return
 const selected=new Set<(typeof BROWSER_FONT_MANIFEST.files)[number]>()
 for(const point of points){const file=supplies.find(s=>s.ranges.some(([from,to])=>point>=from&&point<=to))?.file;if(!file)return;selected.add(file)}
 if(!selected.size)selected.add(BROWSER_FONT_MANIFEST.files[0])
 const fonts:SVGFontResource[]=[]
 for(const file of selected){let bytes:Buffer;try{bytes=await readFile(join(dirname(fontFile),'web',file.file))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
  if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new NativeRenderError('FONT_HASH_MISMATCH','固定WOFF2供应校验失败')
  fonts.push({bytes,sha256:file.sha256,format:'woff2',unicodeRange:file.unicodeRange})
 }
 return fonts
}

function svgInput(input:unknown):{svg:string}{
 if(!input||typeof input!=='object'||typeof (input as {svg?:unknown}).svg!=='string')throw new NativeRenderError('INVALID_SVG','SVG输入无效')
 const svg=(input as {svg:string}).svg
 if(Buffer.byteLength(svg)>RENDER_BUDGET.maxSVGBytes)throw new NativeRenderError('OUTPUT_BUDGET','SVG超出字节预算')
 return {svg}
}

/** Pure CPU/resource packaging in the killable worker; no DB or browser ownership. */
export async function packageSVGCPU(input:unknown):Promise<{svg:string;metadataValid?:true}>{
 const {svg}=svgInput(input),fontFile=(input as {fontFile?:unknown}).fontFile
 if(typeof fontFile!=='string'||!isAbsolute(fontFile))throw new NativeRenderError('FONT_MISSING','缺少固定字体供应')
 const fonts=await usedFonts(svg,fontFile)
 const packaged=fonts?packageNativeSVGResourceFonts(svg,fonts):packageNativeSVGFonts(svg,await readFile(fontFile))
 if(Buffer.byteLength(packaged)>RENDER_BUDGET.maxSVGBytes)throw new NativeRenderError('OUTPUT_BUDGET','封装SVG超出字节预算')
 // Keep the deployed renderer's independent resource/hash checks inside the
 // worker too. Font optimization drafts do not weaken this trust boundary.
 const {urls,metadataValid}=inspectNativeSVGResources(packaged,{inspectDimensions:true})
 const embedded=urls.filter(url=>/^data:(font\/|application\/(?:x-font-|font|octet-stream))/i.test(url))
 const hashes=new Set(fonts?.map(f=>f.sha256)??[RUNTIME_FONT_SHA256])
 if(!embedded.length||embedded.some(url=>!hashes.has(sha256Base64(url.slice(url.indexOf(',')+1)))))throw new NativeRenderError('FONT_NOT_EMBEDDED','SVG未嵌入固定SHA字体')
 return {svg:packaged,...(metadataValid?{metadataValid:true as const}:{})}
}

/** Validate the entire artifact XML away from the HTTP loop, not just a prefix. */
export function inspectSVGCPU(input:unknown):{valid:true}{
 const {svg:source}=svgInput(input)
 if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new NativeRenderError('EXPORT_RENDER_INVALID','SVG格式无效')
 let invalid=false
 const svg=new DOMParser({errorHandler:{warning:()=>{invalid=true},error:()=>{invalid=true},fatalError:()=>{invalid=true}}}).parseFromString(source,'image/svg+xml')
 if(invalid||svg.documentElement?.localName!=='svg')throw new NativeRenderError('EXPORT_RENDER_INVALID','SVG格式无效')
 const root=svg.documentElement,viewBox=(root.getAttribute('viewBox')||'').trim().split(/[ ,]+/).map(Number)
 const width=parseFloat(root.getAttribute('width')||''),height=parseFloat(root.getAttribute('height')||'')
 if(!(viewBox.length===4&&viewBox.every(Number.isFinite)&&viewBox[2]>0&&viewBox[3]>0)&&!(width>0&&height>0))throw new NativeRenderError('EXPORT_RENDER_INVALID','SVG尺寸无效')
 return {valid:true}
}
