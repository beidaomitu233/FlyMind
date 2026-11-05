import {BROWSER_FONT_MANIFEST} from './browser-font-manifest'
import {RUNTIME_FONT_ALIASES,RUNTIME_FONT_URL} from './runtime-assets'

export {BROWSER_FONT_MANIFEST}
export function browserFontCSS(families:readonly string[]=RUNTIME_FONT_ALIASES){
 if(families.some(f=>!(RUNTIME_FONT_ALIASES as readonly string[]).includes(f)))throw Error('UNSUPPORTED_FONT')
 return [...new Set(families)].flatMap(f=>BROWSER_FONT_MANIFEST.files.map(file=>`@font-face{font-family:"${f}";src:url("/runtime-assets/fonts/web/${file.file}?v=${file.sha256}") format("woff2"),url("${RUNTIME_FONT_URL}") format("opentype");font-style:normal;font-weight:400;font-display:block;unicode-range:${file.unicodeRange};}`)).join('\n')
}
/** Render-only subset: each file is selected from the pinned manifest. */
export function selectedBrowserFontCSS(families:readonly string[],fileNames:readonly string[]){
 if(families.some(f=>!(RUNTIME_FONT_ALIASES as readonly string[]).includes(f)))throw Error('UNSUPPORTED_FONT')
 const wanted=new Set(fileNames)
 if(!wanted.has(BROWSER_FONT_MANIFEST.files[0].file)||wanted.size!==fileNames.length||BROWSER_FONT_MANIFEST.files.filter(f=>wanted.has(f.file)).length!==wanted.size)throw Error('UNSUPPORTED_FONT_SUBSET')
 return [...new Set(families)].flatMap(f=>BROWSER_FONT_MANIFEST.files.filter(file=>wanted.has(file.file)).map(file=>`@font-face{font-family:"${f}";src:url("/runtime-assets/fonts/web/${file.file}?v=${file.sha256}") format("woff2");font-style:normal;font-weight:400;font-display:block;unicode-range:${file.unicodeRange};}`)).join('\n')
}
const environmentCSS=browserFontCSS()
/** UI-only CSS: vendor config.fontCss eagerly embeds every URL on save, ignoring
 * unicode-range. Keep this outside the native model/export font configuration. */
export function applyBrowserFonts(document:Document){
 let style=document.getElementById('fm-browser-fonts') as HTMLStyleElement|null
 if(!style){style=document.createElement('style');style.id='fm-browser-fonts';document.head.appendChild(style)}
 if(style.textContent!==environmentCSS)style.textContent=environmentCSS
}
