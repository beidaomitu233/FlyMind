import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {randomUUID} from 'node:crypto'
import Database from 'better-sqlite3'
import {DiagramStore} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {NativeImportService} from '../server/application/native-imports'
import {MAX_IMPORT_SOURCE_BYTES,validateImportInput,importIdentity} from '../server/imports/source'
import {createWorkspaceBackup,validateWorkspaceBackup,readDatabaseState} from '../server/backups/workspace'
import {planWorkspaceRestore,applyWorkspaceRestore} from '../server/backups/restore'
import {composeDocument,projectDocument,extractContent} from '../src/drawing/core/layers'
import {sampleFor} from '../src/drawing/core/samples'
import {previewLegacyMigration} from '../src/drawing/engine/migration'
import {nativeSnapshot,assertCellsPreserved} from '../scripts/probes/helpers/native-editor.mjs'
const basic=extractContent(sampleFor('swimlane'))
function request(format:'content'|'project',value:unknown,key:string,bytes?:Buffer){return {format,data:(bytes??Buffer.from(JSON.stringify(value))).toString('base64'),requestId:key}}
async function setup(){const directory=await mkdtemp(join(tmpdir(),'flymind-import-')),root=join(directory,'data'),store=new DiagramStore(root);await store.init();const native=new NativeDiagramService(store,true),imports=new NativeImportService(native);return {directory,root,store,native,imports,identity:native.dataRootId!}}
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-import-'));await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100})}
function count(store:DiagramStore){const db=new Database(store.databasePath,{readonly:true});try{return (db.prepare('SELECT COUNT(*) n FROM diagrams').get() as any).n}finally{db.close()}}
test('content import preserves exact UTF8/BOM source bytes, assigns new identity/time and replays one atomic record',async()=>{
 const s=await setup();try{const before=count(s.store),bytes=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(JSON.stringify({...basic,id:'original-content'}))]),input=request('content',null,'content-one',bytes),record=await s.imports.import(input,s.identity)
  assert.notEqual(record.document.content.id,'original-content');assert.equal(record.revision,1);assert.equal(record.workspaceGroupId,null);assert.ok(record.document.createdAt>Date.now()-10000);assert.equal(count(s.store),before+1)
  assert.deepEqual((await s.imports.source(record.document.content.id)).buffer,bytes);assert.deepEqual(await s.imports.import(input,s.identity),record)
  await assert.rejects(s.imports.import({...input,data:Buffer.from(JSON.stringify({...basic,title:'不同原文'})).toString('base64')},s.identity),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
  const source=await s.store.nativeImportSource(record.document.content.id);assert.equal(source.format,'content-json');assert.equal(source.bytes,bytes.length)
  const concurrent=request('content',{...basic,id:'concurrent-original'},'concurrent-import'),both=await Promise.all([s.imports.import(concurrent,s.identity),s.imports.import(concurrent,s.identity)]);assert.deepEqual(both[0],both[1]);assert.equal(count(s.store),before+2)
 }finally{await cleanup(s.directory)}
})
test('full v3 and v2 imports preserve internal IDs/geometry/style/decoration while replacing top-level identity and times',async()=>{
 const s=await setup();try{const original=await s.native.create({content:{...basic,id:'v3-origin'},requestId:'source-v3'},s.identity),project={...original.document,createdAt:1000,updatedAt:2000},input=request('project',project,'project-v3'),imported=await s.imports.import(input,s.identity)
  assert.notEqual(imported.document.content.id,project.content.id);assert.ok(imported.document.createdAt>2000);assert.equal(imported.document.updatedAt,imported.document.createdAt);assert.deepEqual(imported.document.content.nodes,project.content.nodes)
  const a=nativeSnapshot({document:project,revision:1}),b=nativeSnapshot(imported);assertCellsPreserved(a,b,a.cells.map(c=>c.cellId));assert.equal((await s.store.nativeImportSource(imported.document.content.id)).format,'project-v3')
  const anchor=imported.document.content.nodes.find(n=>n.kind!=='note')!,edited=await s.native.patchContent(imported.document.content.id,{expectedRevision:1,requestId:'import-then-structure',operations:[{op:'add_node',node:{id:'imported-step',kind:'task',label:'导入后校验',laneId:anchor.laneId,phaseId:anchor.phaseId}},{op:'add_edge',edge:{id:'imported-edge',source:anchor.id,target:'imported-step'}}]},s.identity);assert.equal(edited.revision,2);assert.ok(edited.document.content.nodes.some(n=>n.id==='imported-step'))
  const legacy=composeDocument({...basic,id:'v2-origin'});legacy.createdAt=1000;legacy.updatedAt=2000;const raw=projectDocument(legacy),preview=await previewLegacyMigration(raw);assert.equal(preview.status,'ready',JSON.stringify(preview.diagnostics));const converted=await s.imports.import(request('project',raw,'project-v2'),s.identity);assert.equal((await s.store.nativeImportSource(converted.document.content.id)).format,'project-v2');const expected=nativeSnapshot({document:preview.project!,revision:1});assertCellsPreserved(expected,nativeSnapshot(converted),expected.cells.map(c=>c.cellId));assert.deepEqual(converted.document.content.nodes,raw.content.nodes)
 }finally{await cleanup(s.directory)}
})
test('invalid inputs and late workspace change create no half diagram/source registration',async()=>{
 const s=await setup();try{const before=count(s.store)
  for(const input of [{format:'drawio',data:'AA==',requestId:'bad'},{format:'content',data:'not-base64',requestId:'bad'},request('content',null,'invalid-utf8',Buffer.from([0xff])),request('project',{schemaVersion:4},'future'),request('content',{...basic,nodes:[{...basic.nodes[0],x:2}]},'coordinates')])await assert.rejects(s.imports.import(input,s.identity))
  assert.throws(()=>validateImportInput(request('content',null,'huge',Buffer.alloc(MAX_IMPORT_SOURCE_BYTES+1))),(e:any)=>e.code==='IMPORT_TOO_LARGE');assert.equal(count(s.store),before)
  const pending=s.imports.import(request('content',basic,'root-race'),s.identity),db=new Database(s.store.databasePath);try{db.prepare("UPDATE metadata SET value=? WHERE key='native_workspace_id'").run(randomUUID())}finally{db.close()}
  await assert.rejects(pending,(e:any)=>e.code==='WORKSPACE_MISMATCH');assert.equal(count(s.store),before);await assert.rejects(s.store.getNative(importIdentity(s.identity,'root-race').diagramId),(e:any)=>e.status===404)
 }finally{await cleanup(s.directory)}
})
test('file publication or DB creation failure leaves no half imported record or downloadable orphan',async()=>{
 const s=await setup();try{const blocked=request('content',basic,'blocked-publication'),before=count(s.store);await writeFile(join(s.root,'artifacts'),'not-a-directory');await assert.rejects(s.imports.import(blocked,s.identity),(e:any)=>e.code==='IMPORT_PATH_INVALID');assert.equal(count(s.store),before);await rm(join(s.root,'artifacts'))
  const key='existing-id',id=importIdentity(s.identity,key).diagramId;await s.native.create({content:{...basic,id},requestId:'independent-owner'},s.identity);const countBefore=count(s.store);await assert.rejects(s.imports.import(request('content',basic,key),s.identity),(e:any)=>e.status===409);assert.equal(count(s.store),countBefore);await assert.rejects(s.imports.source(id),(e:any)=>e.code==='IMPORT_SOURCE_NOT_FOUND')
 }finally{await cleanup(s.directory)}
})
test('import source is part of complete backup/restore validation and old receipt epoch cannot replay',async()=>{
 const s=await setup();try{const input=request('content',basic,'restore-import'),record=await s.imports.import(input,s.identity),source=await s.imports.source(record.document.content.id),backup=await createWorkspaceBackup({sourceRoot:s.root,backupRoot:join(s.directory,'backups')});assert.ok(backup.manifest.artifacts.some(f=>f.path.endsWith('/imports/'+source.source.importId+'/source.json')))
  const options={dataRoot:s.root,port:0,privateRuntimeRoot:join(s.directory,'private'),env:{...process.env,FLYMIND_NATIVE_PILOT:'1'}},plan=await planWorkspaceRestore({...options,backupRoot:backup.backupRoot}),restored=await applyWorkspaceRestore({...options,plan}),next=new NativeImportService(new NativeDiagramService(s.store,true));assert.deepEqual((await next.source(record.document.content.id)).buffer,source.buffer);await assert.rejects(next.import(input,restored.dataRootId),(e:any)=>e.code==='REQUEST_EPOCH_CHANGED')
  const path=join(s.root,...source.source.relativePath.split('/'));await writeFile(path,'tampered');await assert.rejects(createWorkspaceBackup({sourceRoot:s.root,backupRoot:join(s.directory,'backups')}),(e:any)=>e.code==='IMPORT_SOURCE_CORRUPT')
 }finally{await cleanup(s.directory)}
})
