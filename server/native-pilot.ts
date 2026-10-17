import {createHash} from 'node:crypto'
import {existsSync,realpathSync} from 'node:fs'
import {basename,dirname,join,resolve,sep} from 'node:path'

function canonicalPath(path:string):string {
  const missing:string[]=[];let current=resolve(path)
  while(!existsSync(current)){missing.unshift(basename(current));const parent=dirname(current);if(parent===current)break;current=parent}
  const actual=existsSync(current)?realpathSync.native(current):current
  const result=join(actual,...missing)
  return process.platform==='win32'?result.toLowerCase():result
}
export interface NativePilotConfiguration {enabled:boolean;dataRoot:string;dataRootId:string}
export function workspaceDataRootId(workspaceId:string):string{return createHash('sha256').update('flymind-native-workspace:'+workspaceId).digest('hex')}
export function assertIsolatedNativeRoot(root:string,projectRoot:string):void {
  const actual=canonicalPath(root),production=canonicalPath(join(projectRoot,'data'))
  if(actual===production||actual.startsWith(production+sep))throw new Error('Native pilot requires an isolated data directory outside the default production data root')
}
/** Must execute before creating/initializing a store. Never returns a raw path in health. */
export function nativePilotConfiguration(env:NodeJS.ProcessEnv,projectRoot:string):NativePilotConfiguration {
  const enabled=env.FLYMIND_NATIVE_PILOT==='1'
  if(enabled&&!env.FLYMIND_DATA_DIR?.trim())throw new Error('Native pilot requires explicit FLYMIND_DATA_DIR')
  const dataRoot=resolve(env.FLYMIND_DATA_DIR||join(projectRoot,'data'))
  if(enabled)assertIsolatedNativeRoot(dataRoot,projectRoot)
  return {enabled,dataRoot,dataRootId:createHash('sha256').update(canonicalPath(dataRoot)).digest('hex')}
}
