import {readFile,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {PACKAGE_ROOT} from '../package-paths'
import {cloudMcpHandshake,cloudReleaseSchema,createCloudReleaseManifest,type CloudReleaseManifest} from './mcp-compat'
import {CloudAccessError} from './identity'

const refused=()=>new CloudAccessError(503,'CLOUD_BUNDLE_INVALID','预备发布制品与当前运行供应不一致，拒绝启动')
/** Candidate metadata is read-only; actual executable/rule/supply bytes remain
 * authoritative. No release label can override a mismatched bundle digest. */
export function validatePreparedRelease(candidate:unknown,actual:CloudReleaseManifest):CloudReleaseManifest{
 const c=candidate as Record<string,unknown>|null
 if(!c||c.prepared!==true||c.platform!==process.platform||c.arch!==process.arch||c.abi!==process.versions.modules||c.releaseId!==actual.releaseId)throw refused()
 const declared=cloudReleaseSchema.safeParse(c.release)
 if(!declared.success||Object.keys(actual).some(key=>actual[key as keyof CloudReleaseManifest]!==declared.data[key as keyof CloudReleaseManifest]))throw refused()
 return actual
}
export async function preparedCloudRelease():Promise<CloudReleaseManifest>{
 const path=join(PACKAGE_ROOT,'..','candidate.json');let bytes:Buffer
 try{const file=await stat(path);if(!file.isFile()||file.size>2*1024*1024)throw refused();bytes=await readFile(path)}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&process.env.FLYMIND_CLOUD_REQUIRE_PREPARED_BUNDLE!=='1')return (await cloudMcpHandshake()).release;throw refused()}
 let candidate:any
 try{candidate=JSON.parse(bytes.toString('utf8'))}catch{throw refused()}
 const label=cloudReleaseSchema.safeParse(candidate?.release)
 if(!label.success||candidate.releaseId!==label.data.releaseId)throw refused()
 return validatePreparedRelease(candidate,await createCloudReleaseManifest({releaseId:label.data.releaseId}))
}
