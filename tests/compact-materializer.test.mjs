import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,stat,symlink,lstat,chmod} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {materializeCandidate} from '../deploy/cloud/materialize-candidate.mjs'
import {verifyCandidate} from '../scripts/verify-cloud-candidate.mjs'
const execute=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex'),python=process.env.PYTHON??'python'
const run=async(command,args)=>(await execute(command,args,{windowsHide:true,timeout:30000,maxBuffer:1024*1024})).stdout
function manifest(files,releaseId='run-2-1'){
 return {schemaVersion:1,releaseId,sourceCommit:(releaseId==='run-1-1'?'a':'b').repeat(40),prepared:true,dirty:false,platform:process.platform,arch:process.arch,node:process.version,abi:process.versions.modules,files:Object.entries(files).map(([path,data])=>({path,bytes:Buffer.byteLength(data),sha256:sha(data)}))}
}
async function tree(root,files,m){await mkdir(root);for(const [path,data]of Object.entries(files)){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),data)}await writeFile(join(root,'candidate.json'),JSON.stringify(m))}
async function tar(root,entries,name='bundle.tar.gz'){
 const file=join(root,name),encoded=Buffer.from(JSON.stringify(entries.map(e=>({...e,...(e.data!==undefined?{data:Buffer.from(e.data).toString('base64')}:{})})))).toString('base64')
 await run(python,['-I','-c',String.raw`import base64,io,json,sys,tarfile
with tarfile.open(sys.argv[1],'w:gz') as t:
 for e in json.loads(base64.b64decode(sys.argv[2])):
  i=tarfile.TarInfo(e['path']); i.mode=0o644
  if e.get('type')=='symlink': i.type=tarfile.SYMTYPE; i.linkname=e['target']; t.addfile(i)
  elif e.get('type')=='fifo': i.type=tarfile.FIFOTYPE; t.addfile(i)
  else:
   data=base64.b64decode(e.get('data','')); i.size=len(data); t.addfile(i,io.BytesIO(data))
`,file,encoded]);return file
}
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'flymind-compact-test-'))),base=join(root,'baseline')
 const oldFiles={'application/resources/vendor.js':'unchanged vendor','application/lib/main.js':'old code','removed.txt':'old only','control-plane/system-admin.jar':'HEAD-old-BODY'}
 const old=manifest(oldFiles,'run-1-1');await tree(base,oldFiles,old)
 const initial=await readFile(join(base,'candidate.json'))
 return {root,base,old,oldFiles,initial,async close(){const temp=await realpath(tmpdir());assert.ok(root.startsWith(temp+sep)&&root.split(sep).at(-1).startsWith('flymind-compact-test-'));await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100})}}
}
async function overlayArchive(f,{files,patches=[],extra=[],changeOverlay,changeManifest}={}){
 files??={'application/resources/vendor.js':f.oldFiles['application/resources/vendor.js'],'application/lib/main.js':'new code','new.txt':'new file','control-plane/system-admin.jar':f.oldFiles['control-plane/system-admin.jar']}
 const target=manifest(files);changeManifest?.(target)
 const raw=Buffer.from(JSON.stringify(target)),overlay={schemaVersion:1,format:'flymind-overlay',baseReleaseId:f.old.releaseId,baseSourceCommit:f.old.sourceCommit,baseCandidateSHA256:sha(f.initial),targetCandidateSHA256:sha(raw),patches}
 changeOverlay?.(overlay)
 const entries=[{path:'candidate.json',data:raw},{path:'overlay.json',data:JSON.stringify(overlay)}]
 for(const [path,data]of Object.entries(files))if(!patches.some(p=>p.path===path)&&f.oldFiles[path]!==data)entries.push({path,data})
 const archive=await tar(f.root,[...entries,...extra]);return {archive,target,files}
}
async function assemble(f,archive){const destination=join(f.root,'candidate');await mkdir(destination,{mode:0o700});await chmod(destination,0o700);const result=await materializeCandidate({archive,destination,environment:'production',python,run,baselineRoot:f.base,requireRootOwned:false});if(process.platform!=='win32')assert.equal((await stat(destination)).mode&0o777,0o755,'new candidate must remain service-readable under a private root umask');return {destination,result}}

test('full archive remains compatible and performs the original complete verification',async()=>{
 const f=await fixture();try{const files={'application/main.js':'full'},m=manifest(files),archive=await tar(f.root,[{path:'candidate.json',data:JSON.stringify(m)},...Object.entries(files).map(([path,data])=>({path,data}))]);const {destination,result}=await assemble(f,archive);assert.equal(result.releaseId,'run-2-1');assert.equal(await readFile(join(destination,'application/main.js'),'utf8'),'full');await verifyCandidate(destination)}finally{await f.close()}
})
test('overlay copies exact unchanged files, replaces changed files, omits deleted files and leaves baseline immutable',async()=>{
 const f=await fixture();try{const {archive}=await overlayArchive(f),{destination}=await assemble(f,archive);assert.equal(await readFile(join(destination,'application/lib/main.js'),'utf8'),'new code');await assert.rejects(lstat(join(destination,'removed.txt')),e=>e.code==='ENOENT');assert.equal(await readFile(join(f.base,'application/lib/main.js'),'utf8'),'old code');assert.deepEqual(await readFile(join(f.base,'candidate.json')),f.initial);assert.equal((await stat(join(destination,'application/resources/vendor.js'))).nlink,1);assert.notEqual((await stat(join(destination,'application/resources/vendor.js'))).ino,(await stat(join(f.base,'application/resources/vendor.js'))).ino)}finally{await f.close()}
})
test('only bounded COPY/literal JAR operations reconstruct the exact original target bytes',async()=>{
 const f=await fixture();try{const jar='HEAD-new-BODY',literal='new',path='control-plane/system-admin.jar',literalPath='_overlay/patches/'+sha(jar)+'.bin',patch={path,baseSHA256:sha(f.oldFiles[path]),literalPath,literalSHA256:sha(literal),operations:[{from:'base',offset:0,bytes:5},{from:'literal',offset:0,bytes:3},{from:'base',offset:8,bytes:5}]}
 const files={...f.oldFiles,[path]:jar},{archive}=await overlayArchive(f,{files,patches:[patch],extra:[{path:literalPath,data:literal}]});const {destination}=await assemble(f,archive);assert.equal(await readFile(join(destination,path),'utf8'),jar);assert.equal(await readFile(join(f.base,path),'utf8'),'HEAD-old-BODY')
 }finally{await f.close()}
})
test('wrong baseline, target metadata, extra payload and unsafe archives are refused before activation',async()=>{
 const cases=[{changeOverlay:o=>{o.baseCandidateSHA256='0'.repeat(64)}},{changeOverlay:o=>{o.targetCandidateSHA256='0'.repeat(64)}},{changeOverlay:o=>{o.unknown=true}},{extra:[{path:'unexpected.txt',data:'extra'}]},{extra:[{path:'../escape',data:'no'}]},{extra:[{path:'fifo',type:'fifo'}]},{extra:[{path:'application/lib/main.js',data:'duplicate'}]},{extra:[{path:'evil',type:'symlink',target:'/etc/passwd'}]}]
 for(const options of cases){const f=await fixture();try{const {archive}=await overlayArchive(f,options);await assert.rejects(assemble(f,archive));assert.deepEqual(await readFile(join(f.base,'candidate.json')),f.initial);assert.equal(await readFile(join(f.base,'application/lib/main.js'),'utf8'),'old code')}finally{await f.close()}}
})
test('patch input digest, offset, output budget and unexpected payload cannot bypass target hash',async()=>{
 for(const type of ['bounds','digest','budget','payload']){const f=await fixture();try{const path='control-plane/system-admin.jar',jar='new-jar',literal='new-jar',literalPath='_overlay/patches/'+sha(jar)+'.bin',patch={path,baseSHA256:sha(f.oldFiles[path]),literalPath,literalSHA256:sha(literal),operations:[{from:'literal',offset:0,bytes:7}]}
  if(type==='bounds')patch.operations[0].offset=1
  if(type==='digest')patch.literalSHA256='f'.repeat(64)
  if(type==='budget')patch.operations[0].bytes=2_000_000_001
  const extra=[{path:literalPath,data:literal},...(type==='payload'?[{path,data:jar}]:[])],{archive}=await overlayArchive(f,{files:{...f.oldFiles,[path]:jar},patches:[patch],extra});await assert.rejects(assemble(f,archive));assert.equal(await readFile(join(f.base,path),'utf8'),f.oldFiles[path])
 }finally{await f.close()}}
})
test('relative symlinks are created last inside the new complete tree', {skip:process.platform==='win32'?'Real symlink creation is verified on Linux, not simulated on Windows':false},async()=>{
 const f=await fixture();try{const {archive,target}=await overlayArchive(f,{changeManifest:m=>m.files.push({path:'application/bin/current',type:'symlink',target:'../lib/main.js'})});const {destination}=await assemble(f,archive);assert.equal(await readFile(join(destination,'application/bin/current'),'utf8'),'new code');assert.equal((await lstat(join(destination,'application/bin/current'))).isSymbolicLink(),true);assert.equal(target.files.at(-1).type,'symlink')}finally{await f.close()}
})
test('production calls cannot inject a caller-selected baseline root',async()=>{
 const f=await fixture();try{await assert.rejects(materializeCandidate({archive:'unused',destination:'unused',environment:'production',python,run,baselineRoot:f.base,requireRootOwned:true}),/root materializer/)}finally{await f.close()}
})
test('actual Python builder ZIP-compressed COPY output materializes to the original complete manifest',async()=>{
 const f=await fixture();try{
  const jarPath='control-plane/system-admin.jar',newJar=join(f.root,'new.jar')
  await run(python,['-I','-c',String.raw`import io,random,sys,zipfile
dependency=random.Random(29).randbytes(65536)
for path,code in [(sys.argv[1],b'old class'),(sys.argv[2],b'new class')]:
 with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as z:
  z.writestr('BOOT-INF/lib/dependency.jar',dependency); z.writestr('BOOT-INF/classes/App.class',code)
`,join(f.base,jarPath),newJar])
  f.oldFiles[jarPath]=await readFile(join(f.base,jarPath));f.old=manifest(f.oldFiles,'run-1-1');f.initial=Buffer.from(JSON.stringify(f.old));await writeFile(join(f.base,'candidate.json'),f.initial)
  const targetRoot=join(f.root,'target'),files={...f.oldFiles,[jarPath]:await readFile(newJar),'application/lib/main.js':'actual builder code'}
  await tree(targetRoot,files,manifest(files))
  const archive=join(f.root,'built.tar.gz'),report=join(f.root,'builder.json')
  await run(python,['-I',resolve('scripts/build-compact-candidate.py'),'--baseline',f.base,'--target',targetRoot,'--output',archive,'--report',report])
  const evidence=JSON.parse(await readFile(report,'utf8'));assert.ok(evidence.jarCopiedBytes>60000)
  const {destination}=await assemble(f,archive)
  assert.deepEqual(await readFile(join(destination,jarPath)),files[jarPath]);assert.deepEqual(await readFile(join(destination,'candidate.json')),await readFile(join(targetRoot,'candidate.json')))
 }finally{await f.close()}
})
