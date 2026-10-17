import type {NativeDrawingProject} from '../../src/drawing/engine/types'
export interface RuntimeAssetPaths {projectRoot:string;drawioRoot:string;fontRoot:string;browserExecutable:string}
export interface NativeRenderOptions {background?:'white'|'transparent';scale?:number;timeoutMs?:number;signal?:AbortSignal}
export interface NativeRenderResult {
  png:Buffer;svg:string;width:number;height:number;scale:number;nativeXML:string
  /** Original native SVG before deterministic font resource packaging. */
  nativeSVG?:string
  runtime:{drawioVersion:string;browserVersion:string;fontFamily:string;fontSha256:string}
  timings:{totalMs:number;browserStartMs:number;loadMs:number;exportMs:number}
  warnings:string[]
}
export interface NativeRenderer {render(project:NativeDrawingProject,options?:NativeRenderOptions):Promise<NativeRenderResult>;close():Promise<void>}
export class NativeRenderError extends Error {
  constructor(readonly code:string,message:string){super(`${code}: ${message}`);this.name='NativeRenderError'}
}
