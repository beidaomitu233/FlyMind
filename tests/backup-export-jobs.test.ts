import {test} from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {readExportJobs} from '../server/backups/workspace'

const columns='id,diagram_id,data_root_id,revision,request_id,request_hash,snapshot,snapshot_hash,options,release,status,created_at,updated_at,attempts,lease_token,manifest'
const create=`CREATE TABLE native_export_jobs(id,diagram_id,data_root_id,revision,request_id,request_hash,snapshot,snapshot_hash,options,release,status,created_at,updated_at,attempts,lease_token,manifest)`
const values=['job','diagram','root',1,'request','hash','{"title":"中文"}','sha','{"scale":1}',null,'succeeded',1,2,3,null,'{"ok":true}']
function oldJob(row:any){return {id:row.id,diagramId:row.diagram_id,dataRootId:row.data_root_id,revision:row.revision,requestId:row.request_id,requestHash:row.request_hash,snapshot:JSON.parse(row.snapshot),snapshotSha256:row.snapshot_hash,options:JSON.parse(row.options),...(row.release?{release:JSON.parse(row.release)}:{}),status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,attempts:row.attempts,leaseToken:row.lease_token,manifest:row.manifest?JSON.parse(row.manifest):undefined}}
const previous=(db:Database.Database)=>(db.prepare('SELECT * FROM native_export_jobs').all() as any[]).map(oldJob)
function capture(fn:()=>unknown){try{fn()}catch(error){const e=error as Error;return {name:e.name,message:e.message}}assert.fail('expected failure')}
function insert(db:Database.Database,row:unknown[]){db.prepare(`INSERT INTO native_export_jobs (${columns}) VALUES (${row.map(()=>'?').join(',')})`).run(...row)}

test('iterator matches old empty, duplicate, ordered and BLOB/NULL JSON values',()=>{
 const db=new Database(':memory:')
 try{db.exec(create);assert.deepEqual(readExportJobs(db),previous(db))
  insert(db,values);insert(db,values)
  const binary=[...values];binary[0]='binary';binary[6]=Buffer.from('{"title":"字"}');binary[8]=Buffer.from('null');binary[9]=Buffer.from('{"policy":1}');binary[15]=Buffer.from('{"ok":true}');insert(db,binary)
  const nullable=[...values];nullable[0]='nullable';nullable[6]=null;nullable[8]=null;nullable[15]=null;insert(db,nullable)
  assert.deepEqual(readExportJobs(db),previous(db));assert.deepEqual(readExportJobs(db).map(x=>x.id),['job','job','binary','nullable'])
 }finally{db.close()}
})

test('invalid JSON and binary retain old exception semantics and leave connection usable',()=>{
 for(const value of ['{',Buffer.from([0xff,0]),'undefined']){const db=new Database(':memory:')
  try{db.exec(create);const bad=[...values];bad[6]=value;insert(db,bad);insert(db,values)
   assert.deepEqual(capture(()=>readExportJobs(db)),capture(()=>previous(db)))
   assert.equal((db.prepare('SELECT count(*) AS n FROM native_export_jobs').get() as any).n,2)
  }finally{db.close()}
 }
})

test('later SQLite error precedes early JSON error and iterator is released',()=>{
 const db=new Database(':memory:');let fail=false
 try{db.function('maybe_fail',{deterministic:true},(id:string)=>{if(fail&&id==='second')throw Error('late SQL failure');return id})
  db.exec(create.replace(/\)$/,',generated GENERATED ALWAYS AS (maybe_fail(id)) VIRTUAL)'))
  const bad=[...values];bad[6]='{';insert(db,bad);const second=[...values];second[0]='second';insert(db,second);fail=true
  assert.deepEqual(capture(()=>readExportJobs(db)),capture(()=>previous(db)));assert.match(capture(()=>readExportJobs(db)).message,/late SQL failure/)
  fail=false;assert.equal((db.prepare('SELECT count(*) AS n FROM native_export_jobs').get() as any).n,2)
  assert.deepEqual(capture(()=>readExportJobs(db)),capture(()=>previous(db)))
 }finally{db.close()}
})

test('actual readonly database returns the exact previous complete jobs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-jobs-readonly-')),path=join(root,'fixture.sqlite')
 try{const writer=new Database(path);try{writer.exec(create);insert(writer,values)}finally{writer.close()}
  const db=new Database(path,{readonly:true,fileMustExist:true});try{assert.deepEqual(readExportJobs(db),previous(db));assert.throws(()=>db.exec('DELETE FROM native_export_jobs'))}finally{db.close()}
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true})}
})
