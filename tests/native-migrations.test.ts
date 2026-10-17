import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import Database from 'better-sqlite3'
import {DiagramStore} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {NativeMigrationService,type MigrationRequest} from '../server/application/native-migrations'
import {readDatabaseState} from '../server/backups/workspace'
async function setup(){const root=await mkdtemp(join(tmpdir(),'flymind-migration-')),store=new DiagramStore(root);await store.init();const sample=await store.get('sample-swimlane');await store.create({...sample.document,id:'migration-swimlane'});const native=new NativeDiagramService(store,true);return {root,store,native,service:new NativeMigrationService(store),identity:native.dataRootId!}}
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-migration-'));await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100})}
function request(p:Awaited<ReturnType<NativeMigrationService['preview']>>,key='migrate'):MigrationRequest{return {diagramId:p.source.diagramId,expectedRevision:p.source.revision,expectedRawDocumentSha256:p.source.rawDocumentSha256,expectedSourceHash:p.preview.sourceHash,expectedGeometryDigest:p.preview.geometryDigest!,converterVersion:p.preview.converterVersion,requestId:key,expectedWorkspaceGroupId:p.source.workspaceGroupId,expectedDeletedAt:p.source.deletedAt,expectedSavedAt:p.source.savedAt}}
test('migration preview is read-only, commit preserves identity/time/group/history and is idempotent',async()=>{
 const s=await setup();try{const group=await s.store.createGroup('保留分组',s.identity);await s.store.moveStoredToGroup('migration-swimlane',group.id,null,s.identity)
  const before=readDatabaseState(s.store.databasePath),p=await s.service.preview('migration-swimlane');assert.equal(p.preview.status,'ready',JSON.stringify(p.preview.diagnostics));assert.deepEqual(readDatabaseState(s.store.databasePath),before)
  const input=request(p),committed=await s.service.commit(input,s.identity);assert.equal(committed.revision,p.source.revision+1);assert.equal(committed.document.createdAt,p.source.createdAt);assert.equal(committed.document.updatedAt,p.source.updatedAt);assert.equal(committed.workspaceGroupId,group.id);assert.equal(committed.deletedAt,null)
  assert.deepEqual(await s.service.commit(input,s.identity),committed);await assert.rejects(s.service.commit({...input,expectedGeometryDigest:'0'.repeat(64)},s.identity),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
  const db=new Database(s.store.databasePath,{readonly:true});try{assert.equal((db.prepare('SELECT document FROM diagram_versions WHERE diagram_id=? AND revision=?').get(input.diagramId,p.source.revision) as any).document,p.source.rawDocument);assert.equal((db.prepare('SELECT source_raw FROM native_migration_records').get() as any).source_raw,p.source.rawDocument)}finally{db.close()}
  await assert.rejects(s.store.update(input.diagramId,committed.revision,d=>d),(e:any)=>e.code==='NATIVE_DOCUMENT_REQUIRED')
 }finally{await cleanup(s.root)}
})
test('migration rejects changed source/group/trash and wrong root without partial write',async()=>{
 const s=await setup();try{const p=await s.service.preview('migration-swimlane'),input=request(p);await s.store.delete(input.diagramId,input.expectedRevision,s.identity);const before=readDatabaseState(s.store.databasePath)
  await assert.rejects(s.service.commit(input,'wrong'),(e:any)=>e.code==='WORKSPACE_MISMATCH');await assert.rejects(s.service.commit(input,s.identity),(e:any)=>e.code==='MIGRATION_SOURCE_CHANGED');assert.deepEqual(readDatabaseState(s.store.databasePath),before)
  const deleted=await s.service.preview(input.diagramId),r=await s.service.commit(request(deleted,'migrate-trash'),s.identity);assert.equal(r.deletedAt,deleted.source.deletedAt);await assert.rejects(s.store.getNative(input.diagramId),(e:any)=>e.status===410)
 }finally{await cleanup(s.root)}
})
test('unsupported source format is blocked without creating migration schema or changing business records',async()=>{
 const s=await setup();try{const db=new Database(s.store.databasePath);try{const raw=JSON.parse((db.prepare('SELECT document FROM diagrams WHERE id=?').get('sample-flowchart') as any).document);db.prepare('UPDATE diagrams SET document=? WHERE id=?').run(JSON.stringify({...raw,schemaVersion:999}),'sample-flowchart')}finally{db.close()}const before=readDatabaseState(s.store.databasePath),p=await s.service.preview('sample-flowchart');assert.equal(p.preview.status,'blocked');assert.equal(p.preview.project,undefined);assert.deepEqual(readDatabaseState(s.store.databasePath),before)}finally{await cleanup(s.root)}
})
