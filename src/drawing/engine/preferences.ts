import type {RenderingPreferences,RenderingProfile} from './types'
import {DEFAULT_SWIMLANE_PROFILE} from './constants'
import {kindForProfile} from './profiles'

type JsonObject=Record<string,unknown>
const nodeKinds=['task','decision','start','end','module','topic','card','note']
const colorPattern=/^#[0-9a-f]{6}$/i

function exact(value:unknown,allowed:readonly string[],required:readonly string[],path:string):JsonObject {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error(`${path} must be a plain object`)
  const data=value as JsonObject
  if(Object.getOwnPropertySymbols(data).length)throw new Error(`${path} contains a non-JSON key`)
  for(const key of Object.keys(data))if(!allowed.includes(key))throw new Error(`${path}.${key} is not allowed`)
  for(const key of required)if(!Object.hasOwn(data,key)||data[key]===undefined)throw new Error(`${path}.${key} is required`)
  return data
}
function member(value:unknown,allowed:readonly string[],path:string):void {
  if(typeof value!=='string'||!allowed.includes(value))throw new Error(`${path} is unsupported`)
}
function numberRange(value:unknown,min:number,max:number,path:string):void {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error(`${path} must be ${min}–${max}`)
}
function color(value:unknown,path:string):void {
  if(typeof value!=='string'||!colorPattern.test(value))throw new Error(`${path} must be #RRGGBB`)
}
/** Visual defaults only; XML owns positions, per-cell styles, routes, groups and decoration. */
export function validateRenderingPreferences(value:unknown):RenderingPreferences {
  const p=exact(value,['theme','orientation','nodeDefaults','edgeDefaults'],[],'rendering.preferences')
  if(p.theme!==undefined)member(p.theme,['blue','indigo','forest'],'rendering.preferences.theme')
  if(p.orientation!==undefined)member(p.orientation,['vertical','horizontal'],'rendering.preferences.orientation')
  if(p.nodeDefaults!==undefined){
    const presets=exact(p.nodeDefaults,nodeKinds,[],'rendering.preferences.nodeDefaults')
    for(const [kind,raw] of Object.entries(presets)){
      const path=`rendering.preferences.nodeDefaults.${kind}`
      const preset=exact(raw,['width','height','fontSize','shape','fill','stroke','textColor'],[],path)
      for(const key of ['width','height'])if(preset[key]!==undefined)numberRange(preset[key],32,2000,`${path}.${key}`)
      if(preset.fontSize!==undefined)numberRange(preset.fontSize,10,48,`${path}.fontSize`)
      if(preset.shape!==undefined)member(preset.shape,['rectangle','rounded','ellipse','diamond'],`${path}.shape`)
      for(const key of ['fill','stroke','textColor'])if(preset[key]!==undefined)color(preset[key],`${path}.${key}`)
    }
  }
  if(p.edgeDefaults!==undefined){
    const path='rendering.preferences.edgeDefaults'
    const edge=exact(p.edgeDefaults,['route','color','width','arrow','dashed'],[],path)
    if(edge.route!==undefined)member(edge.route,['orthogonal','straight','curved'],`${path}.route`)
    if(edge.color!==undefined)color(edge.color,`${path}.color`)
    if(edge.width!==undefined)numberRange(edge.width,1,8,`${path}.width`)
    if(edge.arrow!==undefined)member(edge.arrow,['end','both','none'],`${path}.arrow`)
    if(edge.dashed!==undefined&&typeof edge.dashed!=='boolean')throw new Error(`${path}.dashed must be boolean`)
  }
  return JSON.parse(JSON.stringify(p)) as RenderingPreferences
}

/** Fixed native template capabilities, shared by compilation and project validation. */
export function validateProfilePreferences(value:unknown,selected:RenderingProfile=DEFAULT_SWIMLANE_PROFILE):RenderingPreferences {
  const profile=exact(selected,['id','version'],['id','version'],'profile')
  const kind=kindForProfile(profile as unknown as RenderingProfile)
  const preferences=validateRenderingPreferences(value)
  if(preferences.edgeDefaults?.route!==undefined&&preferences.edgeDefaults.route!=='orthogonal')throw new Error('UNSUPPORTED_RENDERING_OPTION: Rendering profile swimlane-standard v1 supports only orthogonal edge routes')
  if(preferences.nodeDefaults?.note?.shape!==undefined)throw new Error('UNSUPPORTED_RENDERING_OPTION: Rendering profile swimlane-standard v1 does not support note shape defaults')
  for(const preset of Object.values(preferences.nodeDefaults||{}))if(preset?.width!==undefined&&preset.width<64)throw new Error('UNSUPPORTED_RENDERING_OPTION: Rendering profile swimlane-standard v1 requires node default width of at least 64')
  return preferences
}
