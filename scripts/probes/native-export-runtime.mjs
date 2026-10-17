import {ensureNativeRuntime} from '../../server/runtime-instance/client.ts'
// No frontend page is opened: the real Runtime's durable job worker owns Chromium.
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,dirname,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import {DOMParser} from '@xmldom/xmldom'
import {sha256,exportSnapshotHash} from '../../server/exports/artifacts.ts'
import {EXPORT_FORMATS} from '../../server/exports/types.ts'
import {projectDrawio,drawioRenderSignature} from '../../src/drawing/engine/drawio/index.ts'
import {validateDrawingProject} from '../../src/drawing/engine/project.ts'
import {exportBasename} from '../../src/drawing/core/export-metadata.ts'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=join(root,'output/playwright/native-export-runtime')
await mkdir(out,{recursive:true})
const dataRoot=await mkdtemp(join(tmpdir(),'flymind-export-runtime-')),result={startedAt:new Date().toISOString(),checks:{},jobs:[],frontendPagesOpened:0,shutdowns:[]}
let child,origin,identity,apiConnection,runtimeLog=''
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function request(path,method='GET',body,headers={}){if(path!=='/health'&&!apiConnection)apiConnection=await ensureNativeRuntime({dataRoot,privateRuntimeRoot:join(dataRoot,'.private-runtime'),port:Number(new URL(origin).port),env:{FLYMIND_NATIVE_PILOT:'1'}});return fetch(origin+'/studio-api'+path,{method,headers:{...apiConnection?.headers(),'Content-Type':'application/json','X-FlyMind-DataRoot-Id':identity||'',...headers},body:body===undefined?undefined:JSON.stringify(body)})}
async function api(path,method='GET',body){if(path!=='/health'&&!apiConnection)apiConnection=await ensureNativeRuntime({dataRoot,privateRuntimeRoot:join(dataRoot,'.private-runtime'),port:Number(new URL(origin).port),env:{FLYMIND_NATIVE_PILOT:'1'}});const response=await request(path,method,body);const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error),{status:response.status,...value});return value}
async function start(){apiConnection=undefined;const portServer=createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');const port=portServer.address().port;await new Promise(r=>portServer.close(r));origin=`http://127.0.0.1:${port}`;child=spawn(process.execPath,['server/start.mjs','--runtime'],{cwd:root,env:{...process.env,FLYMIND_DATA_DIR:dataRoot,FLYMIND_NATIVE_PILOT:'1',FLYMIND_PRIVATE_RUNTIME_DIR:join(dataRoot,'.private-runtime'),FLYMIND_PORT:String(port)},stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});child.stderr.on('data',b=>runtimeLog+=b.toString());for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Runtime failed: '+runtimeLog);try{const health=await api('/health');if(health.dataRootId){identity=health.dataRootId;return}}catch{}await sleep(100)}throw Error('Runtime health timeout')}
async function stop(){
  const owned=child;child=undefined
  if(!owned||owned.exitCode!==null||owned.signalCode!==null)return
  const exit=once(owned,'exit');let timer
  if(owned.connected)owned.send({type:'flymind-test-shutdown'})
  const graceful=await Promise.race([exit.then(()=>true),new Promise(r=>timer=setTimeout(()=>r(false),10000))]);clearTimeout(timer)
  result.shutdowns.push({graceful,pid:owned.pid})
  if(!graceful){owned.kill();await exit;throw Error('Owned Runtime needed forced termination; graceful renderer shutdown did not complete')}
}
async function finished(id){let previous='';for(let i=0;i<360;i++){const job=await api('/native/exports/'+id);if(job.status!==previous){console.log(id+' '+job.status);previous=job.status}if(job.status==='succeeded')return job;if(job.status==='failed')throw Error('Real native export failed: '+JSON.stringify(job));await sleep(250)}throw Error('Export job timeout')}
async function verify(job,project){
  assert.equal(job.status,'succeeded');assert.equal(job.snapshotSha256,exportSnapshotHash(project));assert.ok(!JSON.stringify(job).includes(dataRoot));assert.equal(Object.keys(job.files).length,5)
  const db=new Database(join(dataRoot,'flymind.sqlite'),{readonly:true,fileMustExist:true});let row;try{row=db.prepare('SELECT lease_token,manifest,snapshot FROM native_export_jobs WHERE id=?').get(job.id)}finally{db.close()}
  assert.deepEqual(JSON.parse(row.snapshot),project)
  const directory=join(dataRoot,'artifacts',job.diagramId,`r${job.revision}`,'exports',job.id,row.lease_token),dest=join(out,job.id);await mkdir(dest,{recursive:true})
  const bytes={}
  for(const format of EXPORT_FORMATS){const entry=job.files[format],response=await apiConnection.authenticatedFetch(entry.url);assert.equal(response.status,200);const buffer=Buffer.from(await response.arrayBuffer());assert.equal(buffer.length,entry.bytes);assert.equal(sha256(buffer),entry.sha256);assert.ok(entry.filename.startsWith(exportBasename(project.content.title,job.exportedAt)));assert.ok(Math.abs((await stat(join(directory,entry.filename))).mtimeMs-job.exportedAt)<=5);assert.match(response.headers.get('content-disposition')||'',/attachment/);await writeFile(join(dest,entry.filename),buffer);bytes[format]=buffer}
  const png=await sharp(bytes.png).metadata();assert.equal(png.format,'png');assert.equal(png.width,job.width);assert.equal(png.height,job.height)
  const svg=new DOMParser().parseFromString(bytes.svg.toString(),'image/svg+xml');assert.equal(svg.documentElement.localName,'svg')
  const raw=bytes.drawio.toString();assert.equal(raw,project.rendering.engine.xml);assert.equal(drawioRenderSignature(raw),drawioRenderSignature(project.rendering.engine.xml));assert.equal((await projectDrawio(raw,project.content)).contentHash,project.rendering.engine.contentHash)
  assert.deepEqual(JSON.parse(bytes.json.toString()),project.content);assert.deepEqual(JSON.parse(bytes['project.json'].toString()),project);await validateDrawingProject(JSON.parse(bytes['project.json'].toString()))
  result.jobs.push({id:job.id,revision:job.revision,isCurrentRevision:job.isCurrentRevision,exportedAt:job.exportedAt,width:job.width,height:job.height,scale:job.scale,files:Object.fromEntries(EXPORT_FORMATS.map(f=>[f,{bytes:bytes[f].length,sha256:sha256(bytes[f])}]))})
}
try{
  await start();const originalIdentity=identity
  const content=JSON.parse(await readFile(join(root,'tests/fixtures/drawio-baseline/pbs-main.content.json'),'utf8'));content.id='headless-pbs-export';content.title='PBS 无页面导出验证'
  const first=await api('/native/diagrams','POST',{content,requestId:'headless-create'}),input={expectedRevision:1,requestId:'headless-export-one',options:{scale:1,background:'white'}}
  for(const header of ['', 'incorrect']){const response=await request(`/native/diagrams/${content.id}/exports`,'POST',input,{'X-FlyMind-DataRoot-Id':header});assert.equal(response.status,409);assert.equal((await response.json()).code,'WORKSPACE_MISMATCH')}
  const queued=await api(`/native/diagrams/${content.id}/exports`,'POST',input);assert.ok(['queued','running'].includes(queued.status))
  const changed=await api(`/native/diagrams/${content.id}/content-patch`,'POST',{expectedRevision:1,requestId:'headless-new-revision',operations:[{op:'set_title',title:'PBS 后续修订'}]})
  const historical=await finished(queued.id);assert.equal(historical.revision,1);assert.equal(historical.isCurrentRevision,false);await verify(historical,first.document);assert.deepEqual(await api('/native/diagrams/'+content.id),changed);result.checks.immutableHistoricalSnapshot=true
  assert.equal((await api(`/native/diagrams/${content.id}/exports`,'POST',input)).id,queued.id)
  const conflict=await request(`/native/diagrams/${content.id}/exports`,'POST',{...input,options:{scale:2}});assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'IDEMPOTENCY_KEY_REUSED');result.checks.requestIdentityAndIdempotence=true
  const second=await api(`/native/diagrams/${content.id}/exports`,'POST',{expectedRevision:2,requestId:'headless-export-two',options:{scale:0.5,background:'transparent'}}),current=await finished(second.id);assert.notEqual(second.id,queued.id);assert.ok(current.exportedAt>historical.exportedAt);await verify(current,changed.document);assert.deepEqual(await api('/native/diagrams/'+content.id),changed);result.checks.fiveFormatsAndTimes=true
  const again=await api(`/native/diagrams/${content.id}/exports`,'POST',{expectedRevision:2,requestId:'headless-export-three'}),regenerated=await finished(again.id);assert.notEqual(regenerated.id,current.id);assert.ok(regenerated.exportedAt>current.exportedAt);assert.deepEqual(await api('/native/diagrams/'+content.id),changed);result.checks.regenerationHasNewExportIdentityAndTime=true
  for(const format of ['manifest.json','content','project','private','png%2f..%2fproject.json'])assert.equal((await request(`/native/exports/${current.id}/files/${format}`)).status,404)
  const unregistered=await request(`/native/exports/unknown-job/files/png`);assert.equal(unregistered.status,404);result.checks.resourceWhitelist=true
  await stop();await start();assert.equal(identity,originalIdentity);const persisted=await api('/native/exports/'+current.id);assert.equal(persisted.status,'succeeded');assert.equal(persisted.exportedAt,current.exportedAt);assert.equal((await apiConnection.authenticatedFetch(persisted.files.png.url)).status,200);assert.deepEqual(await api('/native/diagrams/'+content.id),changed);result.checks.restartReadsPersistedJobAndFiles=true
  result.ok=true
}catch(error){result.ok=false;result.error=error.stack;process.exitCode=1}
finally{await stop();await writeFile(join(out,'runtime.log'),runtimeLog);await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));assert.ok(resolve(dataRoot).startsWith(resolve(tmpdir())+sep)&&dataRoot.includes('flymind-export-runtime-'));await rm(dataRoot,{recursive:true,force:true})}
