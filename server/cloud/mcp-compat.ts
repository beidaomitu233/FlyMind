import {createHash} from 'node:crypto'
import {readFile,readdir} from 'node:fs/promises'
import {join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {z} from 'zod'
import {VERSION} from '../version'
import {PACKAGE_ROOT} from '../package-paths'
import {DRAWING_STANDARD_VERSION} from '../../src/drawing/core/drawing-quality'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION} from '../../src/drawing/engine/constants'
import {RUNTIME_FONT_SHA256,RUNTIME_BROWSER_REVISION} from '../../src/drawing/engine/runtime-assets'
import {CloudAccessError} from './identity'

export const MCP_CONTRACT_VERSION=1 as const
export const cloudReleaseSchema=z.strictObject({
 releaseId:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/),appVersion:z.string().min(1).max(100),
 policyBundleHash:z.string().regex(/^[a-f0-9]{64}$/),standardVersion:z.string().min(1).max(50),
 engineResourceKey:z.string().regex(/^[a-f0-9]{64}$/),adapterVersion:z.string().min(1).max(50),migrationLevel:z.literal(1)
})
export type CloudReleaseManifest=z.infer<typeof cloudReleaseSchema>
export interface CloudMcpHandshake {contractVersions:number[];release:CloudReleaseManifest}
/** Hash the immutable application code + authoritative rule text once at boot.
 * No mutable resource-cache paths, credentials or data enter the public manifest. */
export async function createCloudReleaseManifest(options:{releaseId?:string;appVersion?:string}={}):Promise<CloudReleaseManifest>{
 const compiled=fileURLToPath(import.meta.url).endsWith('.js'),codeRoot=compiled?join(PACKAGE_ROOT,'lib'):PACKAGE_ROOT
 const hash=createHash('sha256'),renderHash=createHash('sha256')
 async function scan(root:string){for(const entry of (await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(root,entry.name);if(entry.isSymbolicLink())throw Error('Release code cannot contain symlinks');if(entry.isDirectory())await scan(path);else if(entry.isFile()&&/\.(?:ts|js|mjs|json)$/.test(entry.name)){const name=relative(codeRoot,path).replaceAll('\\','/'),bytes=await readFile(path);hash.update(name);hash.update('\0');hash.update(bytes);hash.update('\0');if(name.startsWith('server/rendering/')||name.startsWith('src/drawing/engine/'))renderHash.update(name+'\0').update(bytes).update('\0')}}}
 await scan(join(codeRoot,'server'));await scan(join(codeRoot,'src/drawing'))
 for(const name of ['DRAWING_STANDARD.md','AI_DRAWING_GUIDE.md']){hash.update(name);hash.update(await readFile(join(PACKAGE_ROOT,'docs',name)))}
 const supply=JSON.parse(await readFile(join(PACKAGE_ROOT,'resources/drawio/supply.json'),'utf8'))
 if(!/^[a-f0-9]{64}$/.test(supply.archiveSha256))throw Error('Fixed drawio supply digest missing')
 const policyBundleHash=hash.digest('hex'),engineResourceKey=createHash('sha256').update(JSON.stringify({drawio:DRAWIO_VERSION,archiveSha256:supply.archiveSha256,adapter:DRAWIO_ADAPTER_VERSION,rendererBundle:renderHash.digest('hex'),font:RUNTIME_FONT_SHA256,browserRevision:RUNTIME_BROWSER_REVISION,platform:process.platform,arch:process.arch})).digest('hex')
 return Object.freeze(cloudReleaseSchema.parse({releaseId:options.releaseId??process.env.FLYMIND_RELEASE_ID??'app-'+VERSION+'-'+policyBundleHash.slice(0,12),appVersion:options.appVersion??VERSION,policyBundleHash,standardVersion:DRAWING_STANDARD_VERSION,engineResourceKey,adapterVersion:DRAWIO_ADAPTER_VERSION,migrationLevel:1}))
}
let bootManifest:Promise<CloudReleaseManifest>|undefined
export async function cloudMcpHandshake():Promise<CloudMcpHandshake>{return {contractVersions:[MCP_CONTRACT_VERSION],release:await(bootManifest??=createCloudReleaseManifest())}}
/** Version labels are observational; compatibility is a stable API contract.
 * Local Runtime exact-version/private-instance verification is unchanged. */
export function assertCloudMcpCompatibility(health:any):CloudMcpHandshake|undefined{
 const c=health?.capabilities
 if(health?.name!=='flymind'||health.storage!=='sqlite'||typeof health.dataRootId!=='string'||!health.dataRootId||c?.apiVersion!==1||c.drawingProjectVersion!==3||c.nativePilot!==true||c.nativeDocumentWrites!==true||c.nativeExports!==true||!Array.isArray(c.supportedKinds)||!['swimlane','flowchart','architecture','mindmap','dataflow'].every(kind=>c.supportedKinds.includes(kind)))throw new CloudAccessError(503,'MCP_CAPABILITY_MISMATCH','云端应用不支持当前绘图API契约')
 if(health.mcp===undefined)return undefined // Previously deployed API1 cloud health.
 if(!Array.isArray(health.mcp.contractVersions)||!health.mcp.contractVersions.includes(MCP_CONTRACT_VERSION))throw new CloudAccessError(503,'MCP_CONTRACT_UNSUPPORTED','云端应用不支持此MCP契约')
 const release=cloudReleaseSchema.safeParse(health.mcp.release)
 if(!release.success)throw new CloudAccessError(503,'MCP_RELEASE_INVALID','云端发布标识无效')
 return {contractVersions:health.mcp.contractVersions,release:release.data}
}
/** Snapshot XML is already frozen. Changed policy never revalidates old AI input;
 * changed renderer/adapter requires an explicitly retained old supply instead. */
export function assertExecutionReleaseAvailable(bound:CloudReleaseManifest,current:CloudReleaseManifest){
 const prior=cloudReleaseSchema.parse(bound),active=cloudReleaseSchema.parse(current)
 if(prior.engineResourceKey!==active.engineResourceKey||prior.adapterVersion!==active.adapterVersion||prior.migrationLevel!==active.migrationLevel)throw new CloudAccessError(503,'EXPORT_SUPPLY_UNAVAILABLE','原导出任务的固定渲染供应不可用；请保留任务并恢复对应供应')
}
