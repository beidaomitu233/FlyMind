import type {DiagramContent,DiagramKind,DiagramNode,DiagramEdge,NodeKind} from '../core/model'
import type {RenderingConfig} from '../core/render-config'

// Shared D02 contract. Geometry lives in native XML, never in DiagramContent.
export interface RenderingProfile {id:string;version:string}
export interface RenderingPreferences {
  theme?:RenderingConfig['theme']
  orientation?:RenderingConfig['orientation']
  nodeDefaults?:RenderingConfig['nodeDefaults']
  edgeDefaults?:RenderingConfig['edgeDefaults']
}
export interface DrawioEngineDocument {
  name:'drawio'
  version:string
  adapterVersion:string
  xml:string
  contentHash:string
}
export interface DrawingProjectV3 {
  schemaVersion:3
  content:DiagramContent
  rendering:{profile:RenderingProfile;preferences:RenderingPreferences;engine:DrawioEngineDocument}
  createdAt:number
  updatedAt:number
}
export interface DrawioCompileOptions {
  preferences?:RenderingPreferences
  profile?:RenderingProfile
  // Only for explicit migration/preview; never accepted by the content API.
  legacyRendering?:RenderingConfig
}
export interface ProjectionDiagnostic {
  code:string
  message:string
  cellId?:string
  businessId?:string
}
export interface DrawioProjectionResult {
  content:DiagramContent
  xml:string
  contentHash:string
  diagnostics:ProjectionDiagnostic[]
}
/** Rendering endpoint only. Never accepted as DiagramContent/DiagramOperation. */
export type DrawioRenderingChanges=Partial<RenderingConfig>&{relayout?:boolean}
export interface DrawioConfigureResult {
 profile:RenderingProfile
 preferences:RenderingPreferences
 engine:DrawioEngineDocument
 diagnostics:ProjectionDiagnostic[]
}
export interface DrawioKindCapabilities {
 kind:DiagramKind
 profile:RenderingProfile
 compile:boolean
 project:boolean
 patch:boolean
 configureRendering:boolean
 migrateLegacy:boolean
 orientations:ReadonlyArray<'vertical'|'horizontal'>
}
export interface DrawioCapabilities {
 engineVersion:string
 adapterVersion:string
 supportedKinds:DiagramKind[]
 profiles:DrawioKindCapabilities[]
}
export interface BusinessBinding {
  cellId:string
  type:'node'|'edge'|'lane'|'phase'|'layer'|'annotation'|'decoration'
  businessId:string
  kind?:NodeKind|string
  role?:string
}

/** Imported native document without inferred business semantics. */
export interface NativeCanvasProjectV3 {
 schemaVersion:3
 mode:'canvas-only'
 id:string
 title:string
 rendering:{engine:Omit<DrawioEngineDocument,'contentHash'>&{xmlHash:string}}
 createdAt:number
 updatedAt:number
}
export type NativeDrawingProject=DrawingProjectV3|NativeCanvasProjectV3
export type NativeImportInspection=
 |{status:'business';projection:DrawioProjectionResult;xmlHash:string}
 |{status:'canvas-only';xml:string;xmlHash:string;cellCount:number}
 |{status:'invalid';diagnostics:ProjectionDiagnostic[]}
export interface NativeCanvasCreateOptions {id:string;title:string;createdAt:number;updatedAt:number}
/** Explicit user mapping, never guessed from coordinates/appearance. */
export interface NativeBusinessMapping {
 kind:DiagramKind
 titleCellId?:string
 parentEdges?:Array<{cellId:string;childId:string}>
 decorations?:string[]
 nodes:Array<{cellId:string;node:Omit<DiagramNode,'label'>&{label?:string}}>
 edges:Array<{cellId:string;edge:DiagramEdge}>
 lanes?:Array<{cellId:string;id:string;label?:string}>
 phases?:Array<{cellId:string;id:string;label?:string}>
 groups?:Array<{cellId:string;id:string;label?:string;kind?:'layer'|'governance';color?:string}>
}
export interface NativeCanvasFunctions {
 inspectNativeImport(xml:string):Promise<NativeImportInspection>
 createNativeCanvasProject(xml:string,options:NativeCanvasCreateOptions):Promise<NativeCanvasProjectV3>
 rebindNativeProject(project:NativeDrawingProject,newId:string):Promise<NativeDrawingProject>
 mapNativeCanvas(project:NativeCanvasProjectV3,mapping:NativeBusinessMapping):Promise<DrawingProjectV3>
}

export interface NativeCanvasCell {cellId:string;label:string;kind:'vertex'|'edge';parentCellId?:string;sourceCellId?:string;targetCellId?:string}
