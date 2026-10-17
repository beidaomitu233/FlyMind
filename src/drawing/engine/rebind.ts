import type {DrawingProjectV3} from './types'
import {validateDrawingProject} from './project'
import {contentHash} from './content-hash'
import {parseNative,attr,serialize} from './drawio/xml'

/** Explicit full-project import identity change. Does not rewrite any internal
 * cell/business IDs, label, geometry, style, route, parent or decoration. */
export async function rebindDrawingProject(input:DrawingProjectV3,newId:string):Promise<DrawingProjectV3>{
 if(typeof newId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(newId))throw new Error('INVALID_DOCUMENT_ID')
 const project=await validateDrawingProject(structuredClone(input)),oldId=project.content.id,native=parseNative(project.rendering.engine.xml)
 project.content.id=newId
 for(const entry of native.cells.values())if(attr(entry.object,'fmType')==='decoration'&&attr(entry.object,'fmRole')==='title'){
  entry.object.setAttribute('fmDocumentId',newId)
  if(attr(entry.object,'fmId')===oldId)entry.object.setAttribute('fmId',newId)
 }
 if(attr(native.model,'fmDocumentId')===oldId)native.model.setAttribute('fmDocumentId',newId)
 project.rendering.engine.xml=serialize(native.document);project.rendering.engine.contentHash=await contentHash(project.content)
 return validateDrawingProject(project)
}
