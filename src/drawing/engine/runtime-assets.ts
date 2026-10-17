/** Shared by native templates, Host and background rendering. No machine font fallback. */
export const RUNTIME_FONT_FAMILY='Noto Sans CJK SC'
export const RUNTIME_FONT_FILE='NotoSansCJKsc-Regular.otf'
export const RUNTIME_FONT_SHA256='2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b'
export const RUNTIME_FONT_URL=`/runtime-assets/fonts/${RUNTIME_FONT_FILE}?v=${RUNTIME_FONT_SHA256}`
export const RUNTIME_BROWSER_VERSION='151.0.7922.34'
export const RUNTIME_BROWSER_REVISION='1234'
export const RUNTIME_FONT_ALIASES=[RUNTIME_FONT_FAMILY,'Microsoft YaHei','Helvetica','Arial'] as const
export function runtimeFontCSS(families:readonly string[]=RUNTIME_FONT_ALIASES){
 if(families.some(f=>!(RUNTIME_FONT_ALIASES as readonly string[]).includes(f)))throw new Error('UNSUPPORTED_FONT')
 return [...new Set(families)].map(f=>`@font-face{font-family:"${f}";src:url("${RUNTIME_FONT_URL}") format("opentype");font-style:normal;font-weight:400;font-display:block;}`).join('\n')
}
