import type {DiagramContent} from '../core/model'
import {validateContent} from '../core/layers'
import type {DrawingProjectV3,DrawioEngineDocument,RenderingPreferences,RenderingProfile} from './types'
import {canonicalContentJson,contentHash} from './content-hash'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION,DEFAULT_SWIMLANE_PROFILE} from './constants'
import {projectDrawio} from './drawio'
import {validateProfilePreferences} from './preferences'
import {defaultProfileForKind} from './profiles'
import {parseNative,attr} from './drawio/xml'
export {validateRenderingPreferences} from './preferences'

type JsonObject=Record<string,unknown>
const contentKeys=['schemaVersion','id','title','kind','nodes','edges','lanes','phases','groups']

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
function timestamp(value:unknown,path:string):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0||value>8_640_000_000_000_000)throw new Error(`${path} must be a positive, valid integer timestamp`)
  return value
}
function profile(value:unknown,kind:DiagramContent['kind']):RenderingProfile {
  const p=exact(value,['id','version'],['id','version'],'rendering.profile')
  const expected=defaultProfileForKind(kind);if(p.id!==expected.id||p.version!==expected.version)throw new Error('Unsupported rendering profile or profile version')
  return {id:p.id as string,version:p.version as string}
}

function strictContent(value:unknown):DiagramContent {
  const data=exact(value,contentKeys,contentKeys,'content')
  if(data.schemaVersion!==1)throw new Error('Unsupported content schemaVersion; expected 1')
  canonicalContentJson(data as unknown as DiagramContent) // Reject non-JSON values before legacy normalisation.
  if(Array.isArray(data.nodes))for(const [i,node] of data.nodes.entries()){
    if(node&&typeof node==='object')for(const key of ['laneId','phaseId','groupId','parentId']){
      const field=(node as JsonObject)[key]
      if(field!==undefined&&(typeof field!=='string'||!field))throw new Error(`content.nodes[${i}].${key} must be a nonempty ID`)
    }
  }
  if(Array.isArray(data.groups))for(const [i,group] of data.groups.entries()){
    if(group&&typeof group==='object'&&(group as JsonObject).kind!==undefined)member((group as JsonObject).kind,['layer','governance'],`content.groups[${i}].kind`)
  }
  return validateContent(data)
}

/** Formal v3 validation always reprojects native XML; a self-reported hash is insufficient. */
export async function validateDrawingProject(input:unknown):Promise<DrawingProjectV3> {
  const value=exact(input,['schemaVersion','content','rendering','createdAt','updatedAt'],['schemaVersion','content','rendering','createdAt','updatedAt'],'project')
  if(value.schemaVersion!==3)throw new Error('Unsupported project schemaVersion; expected 3')
  const content=strictContent(value.content)
  const rendering=exact(value.rendering,['profile','preferences','engine'],['profile','preferences','engine'],'rendering')
  const selectedProfile=profile(rendering.profile,content.kind)
  const preferences=validateProfilePreferences(rendering.preferences,selectedProfile)
  const engine=exact(rendering.engine,['name','version','adapterVersion','xml','contentHash'],['name','version','adapterVersion','xml','contentHash'],'rendering.engine')
  if(engine.name!=='drawio'||engine.version!==DRAWIO_VERSION||engine.adapterVersion!==DRAWIO_ADAPTER_VERSION)throw new Error('Unsupported draw.io engine or adapter version')
  if(typeof engine.xml!=='string'||!engine.xml.trim())throw new Error('rendering.engine.xml is required')
  if(typeof engine.contentHash!=='string'||!/^[a-f0-9]{64}$/.test(engine.contentHash))throw new Error('rendering.engine.contentHash must be SHA-256 hex')
  const xml=engine.xml,claimedHash=engine.contentHash // Snapshot caller-owned input before the first await.
  const createdAt=timestamp(value.createdAt,'createdAt'),updatedAt=timestamp(value.updatedAt,'updatedAt')
  if(updatedAt<createdAt)throw new Error('updatedAt must not precede createdAt')
  const hash=await contentHash(content)
  if(hash!==claimedHash)throw new Error('Content hash does not match project content')
  const projection=await projectDrawio(xml,content)
  const projectedContent=strictContent(projection.content)
  if(await contentHash(projectedContent)!==hash||projection.contentHash!==hash)throw new Error('Native XML projection does not match project content')
  return {
    schemaVersion:3,content,
    rendering:{profile:selectedProfile,preferences,engine:{name:'drawio',version:DRAWIO_VERSION,adapterVersion:DRAWIO_ADAPTER_VERSION,xml,contentHash:hash}},
    createdAt,updatedAt,
  }
}

export interface CreateDrawingProjectOptions {
  profile?:RenderingProfile
  preferences?:RenderingPreferences
  createdAt?:number
  updatedAt?:number
}

/** Build a detached v3 project; never writes a store or migrates an existing workspace. */
export async function createDrawingProject(content:DiagramContent,engine:DrawioEngineDocument,options:CreateDrawingProjectOptions={}):Promise<DrawingProjectV3> {
  const selected={...exact(options,['profile','preferences','createdAt','updatedAt'],[],'options')}
  if(content.kind==='mindmap'&&(options.preferences?.orientation===undefined)){
    const title=[...parseNative(engine.xml).cells.values()].find(e=>attr(e.object,'fmRole')==='title'&&attr(e.object,'fmType')==='decoration'&&attr(e.object,'fmAutoOrientation')==='1')
    const orientation=title&&attr(title.object,'fmOrientation');if(orientation==='vertical'||orientation==='horizontal')selected.preferences={...options.preferences,orientation}
  }
  const createdAt=selected.createdAt!==undefined?selected.createdAt:selected.updatedAt!==undefined?selected.updatedAt:Date.now()
  return validateDrawingProject({schemaVersion:3,content,rendering:{profile:selected.profile!==undefined?selected.profile:defaultProfileForKind(content.kind),preferences:selected.preferences!==undefined?selected.preferences:{},engine},createdAt,updatedAt:selected.updatedAt!==undefined?selected.updatedAt:createdAt})
}
