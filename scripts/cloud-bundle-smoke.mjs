// Run in a prepared cloud bundle on its actual target OS/CPU/Node ABI.
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,readFile,readdir,lstat,readlink,chmod,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join,relative,sep,dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {DiagramStore} from '../lib/server/store.js'
import {NativeDiagramService} from '../lib/server/application/native-diagrams.js'
import {NativeExportService} from '../lib/server/application/native-exports.js'
import {NativeExportWorker} from '../lib/server/exports/worker.js'
import {NativeDrawioRenderer} from '../lib/server/rendering/renderer.js'
import {resolveRuntimeAssets} from '../lib/server/rendering/assets.js'
import {createCloudReleaseManifest} from '../lib/server/cloud/mcp-compat.js'
import {sampleFor} from '../lib/src/drawing/core/samples.js'
import {extractContent} from '../lib/src/drawing/core/layers.js'
const application=resolve(fileURLToPath(new URL('../',import.meta.url))),bundle=resolve(application,'..'),candidatePath=join(bundle,'candidate.json'),candidate=JSON.parse(await readFile(candidatePath,'utf8'))
if(candidate.prepared)throw Error('Candidate already finalized; do not modify an immutable release')
if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(candidate.releaseId))throw Error('Candidate identity invalid')
process.env.FLYMIND_RELEASE_ID=candidate.releaseId
const root=await mkdtemp(join(tmpdir(),'flymind-bundle-smoke-')),renderer=new NativeDrawioRenderer();let worker
const report={platform:process.platform,arch:process.arch,node:process.version,abi:process.versions.modules,cases:[]}
try{
 const release=await createCloudReleaseManifest({releaseId:candidate.releaseId});await renderer.ready()
 const store=new DiagramStore(join(root,'data'));await store.init({seedExamples:false});const diagrams=new NativeDiagramService(store,true),exports=new NativeExportService(store,true,Promise.resolve(release));worker=new NativeExportWorker(store,renderer,{release:Promise.resolve(release)})
 for(const kind of ['swimlane','flowchart','architecture','mindmap','dataflow']){
  const content={...extractContent(sampleFor(kind)),id:'bundle-'+kind};const record=await diagrams.create({content,requestId:'create-'+kind},diagrams.dataRootId)
  const task=await exports.create(content.id,{expectedRevision:record.revision,requestId:'export-'+kind},diagrams.dataRootId),result=await worker.runOnce();assert.equal(result?.id,task.id);assert.equal(result?.status,'succeeded',JSON.stringify(result?.error))
  for(const format of ['png','svg','drawio','json','project.json']){const file=await exports.file(task.id,format);assert.ok(file.buffer.length>0);if(format==='png')assert.equal(file.buffer.subarray(1,4).toString(),'PNG')}
  report.cases.push({kind,revision:record.revision,exportId:task.id,png:true,sources:true})
 }
 report.release=release;report.ok=true
}finally{if(worker)await worker.close();else await renderer.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-bundle-smoke-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
await writeFile(join(bundle,'smoke-report.json'),JSON.stringify(report,null,2)+'\n')
if(process.platform==='linux'){
 // Chromium ships these public dependency lists as 0600. Normalize only their
 // package permissions before freezing, so the service can read a root-owned
 // release; never change bytes or relax the production verifier.
 const browserDirectory=dirname(resolveRuntimeAssets(application).browserExecutable)
 for(const name of ['rpm.deps','deb.deps']){const path=join(browserDirectory,name),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||!(await realpath(path)).startsWith(application+sep))throw Error('Browser metadata must be a regular file inside this application bundle');await chmod(path,0o644)}
}
const files=[]
async function walk(directory){for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(directory,entry.name),name=relative(bundle,path).replaceAll('\\','/');if(name==='candidate.json')continue;if(entry.isSymbolicLink()){const target=await readlink(path),absolute=resolve(directory,target);if(!absolute.startsWith(bundle+sep))throw Error('Bundle symlink leaves candidate');files.push({path:name,type:'symlink',target})}else if(entry.isDirectory())await walk(path);else if((await lstat(path)).isFile()){const bytes=await readFile(path);files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})}}}
await walk(bundle);await writeFile(candidatePath,JSON.stringify({...candidate,prepared:true,platform:report.platform,arch:report.arch,node:report.node,abi:report.abi,release:report.release,files,note:'Verified platform candidate; promote these exact bytes without rebuilding.'},null,2)+'\n')
console.log(JSON.stringify({ok:true,releaseId:candidate.releaseId,platform:report.platform,arch:report.arch,node:report.node,cases:report.cases.length}))
