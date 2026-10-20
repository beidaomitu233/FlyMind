import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import Database from 'better-sqlite3'
import {DiagramStore} from '../server/store'
import {NativeDiagramService} from '../server/application/native-diagrams'
import {NativeImportService} from '../server/application/native-imports'
import {nativeIdentity} from '../server/document-record'
import {extractContent} from '../src/drawing/core/layers'
import {sampleFor} from '../src/drawing/core/samples'
import {identifyImportCandidates,scanImportEntries,importRelativePath,type ImportDirectoryEntry} from '../src/drawing/services/import-files'
const content=extractContent(sampleFor('flowchart'))
const source=(value:unknown,format:'content'|'project'='content')=>({format,data:Buffer.from(JSON.stringify(value)).toString('base64')})
const item=(value:unknown,key:string,target:{groupId:string|null}|{newGroupName:string}={groupId:null},batchId='batch1',format:'content'|'project'='content')=>({batchId,itemId:key,requestId:'request_'+key,source:source(value,format),target})
async function setup(){const dir=await mkdtemp(join(tmpdir(),'flymind-batch-')),store=new DiagramStore(join(dir,'data'));await store.init();const native=new NativeDiagramService(store,true);return {dir,store,native,imports:new NativeImportService(native),root:native.dataRootId!}}
async function cleanup(dir:string){assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep)&&dir.includes('flymind-batch-'));await rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:100})}
function count(store:DiagramStore,table:string){const db=new Database(store.databasePath,{readonly:true});try{return (db.prepare('SELECT count(*) n FROM '+table).get() as {n:number}).n}finally{db.close()}}
function file(name:string,value:string){const bytes=new TextEncoder().encode(value);return {file:{name,size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer},path:name}}

test('one export set selects complete project over content, never imports PNG/SVG as extra diagrams',async()=>{
 const project={schemaVersion:3,content,rendering:{engine:{xml:'original manual layout'}}}
 const rows=await identifyImportCandidates([file('drawing.json',JSON.stringify(content)),file('drawing.project.json',JSON.stringify(project)),file('drawing.png','not-read'),file('drawing.svg','not-read'),file('copy.json',JSON.stringify(content))])
 assert.equal(rows.filter(r=>r.status==='ready').length,1);assert.equal(rows.find(r=>r.status==='ready')!.format,'project');assert.ok(rows.filter(r=>r.status==='duplicate').every(r=>r.preferredItemId));assert.equal(rows.filter(r=>r.status==='unsupported').length,2)
})

test('same-name JSON is not authority; conflicting content or two complete layouts require explicit selection',async()=>{
 const rows=await identifyImportCandidates([file('a.json',JSON.stringify(content)),file('b.json',JSON.stringify({...content,title:'不同业务'}))]);assert.ok(rows.every(r=>r.status==='conflict'))
 const full=(xml:string)=>({schemaVersion:3,content,rendering:{engine:{xml}}})
 assert.ok((await identifyImportCandidates([file('one.json',JSON.stringify(full('layout1'))),file('two.json',JSON.stringify(full('layout2')))])).every(r=>r.status==='conflict'))
})

test('recursive directory scanning retains relative paths and skips hidden files without following unsafe paths',async()=>{
 const leaf=(name:string):ImportDirectoryEntry=>({name,isFile:true,isDirectory:false,file:ok=>ok(file(name,'{}').file)})
 let read=0;const directory:ImportDirectoryEntry={name:'chosen',isFile:false,isDirectory:true,createReader:()=>({readEntries:ok=>ok(read++===0?[leaf('a.json'),leaf('.env')]:[])})}
 assert.deepEqual((await scanImportEntries([directory])).map(r=>r.path),['chosen/a.json'])
 for(const path of ['../x.json','C:/x.json','/x.json','a\\x.json','a/.secret/x.json'])assert.throws(()=>importRelativePath(path))
})

test('cross-request concurrent imports converge to one graph/history and item retries do not create an empty destination',async()=>{
 const s=await setup();try{const before=count(s.store,'diagrams'),value={...content,id:'batch-concurrent-source'},a=item(value,'a'),b=item(value,'b',{newGroupName:'不应创建'},'batch2')
 const both=await Promise.all([s.imports.commitItem(a,s.root),s.imports.commitItem(b,s.root)])
 assert.equal(new Set(both.map(r=>nativeIdentity(r.record.document).id)).size,1);assert.equal(count(s.store,'diagrams'),before+1);assert.equal(both.filter(r=>r.status==='imported').length,1)
 const winner=both.find(r=>r.status==='imported')!,replay=await s.imports.commitItem(winner.itemId==='a'?a:b,s.root);assert.deepEqual(replay,winner)
 const duplicatesOnly=await s.imports.commitItem(item(value,'c',{newGroupName:'零成功空组'},'batch3'),s.root);assert.equal(duplicatesOnly.status,'duplicate');assert.ok(!(await s.store.listGroups()).some(g=>g.name==='零成功空组'))
 const db=new Database(s.store.databasePath,{readonly:true});try{assert.equal((db.prepare('SELECT count(*) n FROM diagram_versions WHERE diagram_id=?').get(nativeIdentity(winner.record.document).id) as {n:number}).n,1)}finally{db.close()}
 }finally{await cleanup(s.dir)}
})

test('failed items are zero-write; first successful graph atomically creates one group and later items reuse it',async()=>{
 const s=await setup();try{const before=count(s.store,'diagrams'),target={newGroupName:'目录目标'}
 await assert.rejects(s.imports.commitItem(item({...content,nodes:[{id:'bad',kind:'task',x:5}]},'bad',target),s.root));assert.equal((await s.store.listGroups()).length,0)
 const first=await s.imports.commitItem(item({...content,id:'first-source'},'first',target),s.root),second=await s.imports.commitItem(item({...content,id:'second-source'},'second',target),s.root)
 assert.equal(first.record.workspaceGroupId,second.record.workspaceGroupId);assert.equal((await s.store.listGroups()).length,1);assert.equal(count(s.store,'diagrams'),before+2)
 await assert.rejects(s.imports.commitItem(item({...content,id:'third-source'},'third',{groupId:null}),s.root),(e:any)=>e.code==='IMPORT_BATCH_TARGET_CHANGED')
 await assert.rejects(s.imports.commitItem({...item({...content,id:'first-source'},'first',target),requestId:'changed-key'},s.root),(e:any)=>e.code==='IDEMPOTENCY_KEY_REUSED')
 }finally{await cleanup(s.dir)}
})

test('complete project then matching content is duplicate; altered project geometry or source content is conflict',async()=>{
 const s=await setup();try{const original=await s.native.create({content:{...content,id:'full-source'},requestId:'source-create'},s.root),full=await s.imports.commitItem(item(original.document,'full',{groupId:null},'full-batch','project'),s.root)
 const match=await s.imports.commitItem(item(original.document.content,'plain',{groupId:null},'plain-batch'),s.root);assert.equal(match.status,'duplicate');assert.equal(nativeIdentity(match.record.document).id,nativeIdentity(full.record.document).id)
 const xml=original.document.rendering.engine.xml.replace(/x="([\d.]+)"/,(all,n)=>'x="'+(Number(n)+8)+'"'),changed={...original.document,rendering:{...original.document.rendering,engine:{...original.document.rendering.engine,xml}}}
 await assert.rejects(s.imports.commitItem(item(changed,'changed',{groupId:null},'changed-batch','project'),s.root),(e:any)=>e.code==='IMPORT_SOURCE_CONFLICT')
 await assert.rejects(s.imports.commitItem(item({...original.document.content,title:'来源已变'},'different',{groupId:null},'different-batch'),s.root),(e:any)=>e.code==='IMPORT_SOURCE_CONFLICT')
 }finally{await cleanup(s.dir)}
})

test('read-only item preview writes no metadata; removed sources cannot be recreated even after purge',async()=>{
 const s=await setup();try{const value={...content,id:'deleted-source'},input=item(value,'delete')
 const before=count(s.store,'diagrams');await s.imports.previewItem(input,s.root);assert.equal(count(s.store,'diagrams'),before);assert.equal((await s.store.listGroups()).length,0)
 const r=(await s.imports.commitItem(input,s.root)).record,id=nativeIdentity(r.document).id,deleted=(await s.store.delete(id,r.revision,s.root), (await s.store.listTrash()).find(t=>t.id===id)!)
 await assert.rejects(s.imports.commitItem(item(value,'other',{groupId:null},'other'),s.root),(e:any)=>e.code==='IMPORT_SOURCE_DELETED')
 await s.store.purge(id,deleted.revision,deleted.deletedAt,s.root)
 await assert.rejects(s.imports.commitItem(item(value,'again',{groupId:null},'again'),s.root),(e:any)=>e.code==='IMPORT_SOURCE_DELETED')
 }finally{await cleanup(s.dir)}
})

test('a paper-only change in a complete source is a conflict, never silently discarded as a duplicate',async()=>{
 const {parseNative,serialize}=await import('../src/drawing/engine/drawio/xml')
 const s=await setup();try{const original=await s.native.create({content:{...content,id:'paper-source'},requestId:'paper-source-create'},s.root)
 await s.imports.commitItem(item(original.document,'paper-original',{groupId:null},'paper-batch','project'),s.root)
 const parsed=parseNative(original.document.rendering.engine.xml);parsed.model.setAttribute('pageScale','2')
 const changed={...original.document,rendering:{...original.document.rendering,engine:{...original.document.rendering.engine,xml:serialize(parsed.document)}}}
 await assert.rejects(s.imports.commitItem(item(changed,'paper-changed',{groupId:null},'paper-other','project'),s.root),(e:any)=>e.code==='IMPORT_SOURCE_CONFLICT')
 }finally{await cleanup(s.dir)}
})

test('late DB identity conflict rolls back the newly-created target group and batch item completely',async()=>{
 const {importItemKey}=await import('../server/imports/batch'),{importIdentity}=await import('../server/imports/source')
 const s=await setup();try{const input=item({...content,id:'late-source'},'late',{newGroupName:'不留半组'}),id=importIdentity(s.root,importItemKey(s.root,input.batchId,input.itemId)).diagramId
 await s.native.create({content:{...content,id},requestId:'independent-existing'},s.root);const before=count(s.store,'diagrams')
 await assert.rejects(s.imports.commitItem(input,s.root),(e:any)=>e.status===409);assert.equal(count(s.store,'diagrams'),before);assert.equal((await s.store.listGroups()).length,0)
 const db=new Database(s.store.databasePath,{readonly:true});try{assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='native_import_batches'").get(),undefined)}finally{db.close()}
 }finally{await cleanup(s.dir)}
})

test('older registered sources without the new fingerprint index still block cross-format duplicate creation',async()=>{
 const s=await setup();try{const original=await s.native.create({content:{...content,id:'pre-index-source'},requestId:'legacy-source-create'},s.root),full=await s.imports.commitItem(item(original.document,'older',{groupId:null},'older-batch','project'),s.root)
 const db=new Database(s.store.databasePath);try{db.exec('DROP TABLE native_import_keys')}finally{db.close()}
 const before=count(s.store,'diagrams'),again=await s.imports.commitItem(item(original.document.content,'old-content',{groupId:null},'old-content-batch'),s.root)
 assert.equal(again.status,'duplicate');assert.equal(nativeIdentity(again.record.document).id,nativeIdentity(full.record.document).id);assert.equal(count(s.store,'diagrams'),before)
 }finally{await cleanup(s.dir)}
})

test('one actual project/content/drawio export set shares authoritative fingerprints and creates one graph',async()=>{
 const s=await setup();try{const original=await s.native.create({content:{...content,id:'all-formats-source'},requestId:'all-formats-create'},s.root),full=item(original.document,'project',{groupId:null},'all-formats','project'),plain=item(original.document.content,'content',{groupId:null},'all-formats'),drawio={...item(null,'drawio',{groupId:null},'all-formats'),source:{format:'drawio',data:Buffer.from(original.document.rendering.engine.xml).toString('base64')}}
 const previews=await Promise.all([s.imports.previewItem(full,s.root),s.imports.previewItem(plain,s.root),s.imports.previewItem(drawio,s.root)])
 assert.equal(new Set(previews.map(p=>p.sourceFingerprint.sourceKey)).size,1);assert.equal(new Set(previews.map(p=>p.sourceFingerprint.contentHash)).size,1);assert.equal(previews[0].sourceFingerprint.renderHash,previews[2].sourceFingerprint.renderHash)
 const before=count(s.store,'diagrams'),results=[];for(const input of [full,plain,drawio])results.push(await s.imports.commitItem(input,s.root))
 assert.equal(count(s.store,'diagrams'),before+1);assert.deepEqual(results.map(r=>r.status),['imported','duplicate','duplicate']);assert.equal(new Set(results.map(r=>nativeIdentity(r.record.document).id)).size,1)
 }finally{await cleanup(s.dir)}
})
