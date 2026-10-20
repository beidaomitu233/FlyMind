import type {DiagramKind} from '../../src/drawing/core/model'
import type {DrawioKindCapabilities} from '../../src/drawing/engine/types'
export interface NativeRuntimeCapabilities {
 nativePilot:boolean;nativeDocumentWrites:boolean;mixedWorkspace:boolean;nativeExports:boolean;localAuthorization:boolean
 apiVersion:1;drawingProjectVersion:3;drawioVersion:string;adapterVersion:string;profile:{id:string;version:string}
 supportedKinds:DiagramKind[];configureRendering:boolean;profiles:DrawioKindCapabilities[]
 imports:{contentJSON:boolean;businessProjectJSON:boolean;drawio:boolean;canvasOnly:boolean;maxSourceBytes:number;maxRequestBytes:number;maxXMLBytes:number}
}
export interface NativeRuntimeIdentity {
 application:'flymind';appVersion:string;apiVersion:1;instanceId:string;rootPathId:string;pid:number
}
export interface NativeRuntimeHealth {
 name:'flymind';version:string;storage:'sqlite';dataRootId:string
 runtime:NativeRuntimeIdentity;capabilities:NativeRuntimeCapabilities;proof?:string
}
export interface EnsureNativeRuntimeOptions {
 dataRoot?:string;port?:number;env?:NodeJS.ProcessEnv;timeoutMs?:number;privateRuntimeRoot?:string;projectRoot?:string
}
export interface NativeRuntimeConnection {
 readonly baseURL:string;readonly dataRootId:string;readonly instanceId:string;readonly sessionToken:string
 readonly capabilities:NativeRuntimeCapabilities
 headers():Record<string,string>
 authenticatedFetch(path:string,init?:RequestInit):Promise<Response>
 /** Client detach only. Never shuts down the shared Runtime. */
 close():Promise<void>
}
export class RuntimeInstanceError extends Error {
 constructor(readonly code:string,message:string){super(`${code}: ${message}`);this.name='RuntimeInstanceError'}
}
