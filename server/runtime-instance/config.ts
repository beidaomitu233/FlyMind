import {resolve,dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {homedir} from 'node:os'
import {nativePilotConfiguration} from '../native-pilot'
import {VERSION} from '../version'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION,DEFAULT_SWIMLANE_PROFILE} from '../../src/drawing/engine/constants'
import {RuntimeInstanceError,type EnsureNativeRuntimeOptions,type NativeRuntimeCapabilities} from './types'
import {nativeDocumentCapabilities} from '../../src/drawing/services/native-capabilities'
import {PACKAGE_ROOT} from '../package-paths'
export const API_VERSION=1 as const
export const runtimeCapabilities=():NativeRuntimeCapabilities=>{const c=nativeDocumentCapabilities();return {apiVersion:1,drawingProjectVersion:3,drawioVersion:DRAWIO_VERSION,adapterVersion:DRAWIO_ADAPTER_VERSION,profile:{...DEFAULT_SWIMLANE_PROFILE},supportedKinds:c.supportedKinds,profiles:c.profiles,configureRendering:c.configureRendering,imports:c.imports,nativePilot:true,nativeDocumentWrites:true,mixedWorkspace:true,nativeExports:true,localAuthorization:true}}
export {VERSION}
export function runtimeConfiguration(options:EnsureNativeRuntimeOptions={}){
 const env={...process.env,...options.env},projectRoot=resolve(options.projectRoot??PACKAGE_ROOT)
 if(env.FLYMIND_NATIVE_PILOT!=='1')throw new RuntimeInstanceError('NATIVE_PILOT_DISABLED','原生Runtime仅在显式pilot模式启用')
 const dataRoot=options.dataRoot??env.FLYMIND_DATA_DIR
 if(!dataRoot?.trim())throw new RuntimeInstanceError('DATA_ROOT_REQUIRED','原生Runtime需要显式隔离数据根')
 let pilot;try{pilot=nativePilotConfiguration({...env,FLYMIND_DATA_DIR:dataRoot},projectRoot)}catch{throw new RuntimeInstanceError('ISOLATED_ROOT_REQUIRED','原生Runtime不能使用生产数据根')}
 const port=options.port??Number(env.FLYMIND_PORT??5179)
 if(!Number.isInteger(port)||port<0||port>65535)throw new RuntimeInstanceError('INVALID_PORT','端口必须为0–65535')
 const timeoutMs=options.timeoutMs??20000;if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new RuntimeInstanceError('INVALID_TIMEOUT','启动等待需为1–30000ms')
 const privateRuntimeRoot=resolve(options.privateRuntimeRoot??env.FLYMIND_PRIVATE_RUNTIME_DIR??(process.platform==='win32'?join(env.LOCALAPPDATA??join(homedir(),'AppData/Local'),'FlyMind/runtime'):join(homedir(),'.flymind/runtime')))
 return {env,projectRoot,dataRoot:pilot.dataRoot,rootPathId:pilot.dataRootId,port,timeoutMs,privateRuntimeRoot}
}
export type RuntimeConfiguration=ReturnType<typeof runtimeConfiguration>
