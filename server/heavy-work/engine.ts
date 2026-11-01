import type {DiagramContent} from '../../src/drawing/core/model'
import type {DiagramOperation} from '../../src/drawing/core/operations'
import type {DrawioCompileOptions,DrawioEngineDocument,DrawingProjectV3,DrawioRenderingChanges,DrawioConfigureResult,DrawioProjectionResult} from '../../src/drawing/engine/types'
import {runHeavyWork} from './runner'
export const compileDrawio=(content:DiagramContent,options?:DrawioCompileOptions)=>runHeavyWork<DrawioEngineDocument>('compile',{content,options})
export const patchDrawio=(base:DrawingProjectV3,operations:DiagramOperation[])=>runHeavyWork<DrawioEngineDocument>('patch',{base,operations})
export const configureDrawio=(base:DrawingProjectV3,changes:DrawioRenderingChanges)=>runHeavyWork<DrawioConfigureResult>('configure',{base,changes})
export const normalizeDrawioEdits=(xml:string,base:DrawingProjectV3)=>runHeavyWork<DrawioProjectionResult>('normalize',{xml,base})
