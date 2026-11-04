import {test} from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {databaseState,canonicalHash} from '../server/backups/workspace'
import {canonicalContentJson} from '../src/drawing/engine/content-hash'

// The deployed manifest contract sorts canonical row strings as JS UTF-16,
// retains duplicates, then canonicalizes the outer record and schema objects.
function previousState(db:Database.Database){
 const tables=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string;sql:string}[]
 const records=tables.map(t=>({name:t.name,sql:t.sql,rows:db.prepare('SELECT * FROM "'+t.name.replaceAll('"','""')+'"').all().map(row=>canonicalContentJson(row as any)).sort()}))
 const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
 return {stateHash:canonicalHash({schema,records}),counts:Object.fromEntries(records.map(t=>[t.name,t.rows.length]))}
}

test('streamed database hash exactly matches existing backup manifests for diverse rows and schema',()=>{
 const db=new Database(':memory:')
 try{
  assert.deepEqual(databaseState(db),previousState(db))
  db.exec('CREATE TABLE "quotes""table" (name TEXT, number REAL, optional TEXT); CREATE TABLE many (value TEXT); CREATE TABLE empty (value TEXT); CREATE VIEW v AS SELECT value FROM many; CREATE INDEX by_value ON many(value)')
  const one=db.prepare('INSERT INTO "quotes""table" VALUES (?,?,?)')
  for(const [name,n,value] of [['中文𠮷',2.25,null],['emoji 😀',-1,'x\n"\\'],['\ue000',0,'control\t'],['𐀀',42,''],['duplicate',1,'same'],['duplicate',1,'same']] as const)one.run(name,n,value)
  const insert=db.prepare('INSERT INTO many VALUES (?)');for(let i=0;i<500;i++)insert.run('行'+(i%73)+' \u2028 '+String(i%9))
  assert.deepEqual(databaseState(db),previousState(db))
  db.exec('DELETE FROM many');assert.deepEqual(databaseState(db),previousState(db))
 }finally{db.close()}
})

test('streamed database hash keeps existing rejection of non-JSON binary values',()=>{
 const db=new Database(':memory:')
 try{db.exec('CREATE TABLE binary_data (payload BLOB)');db.prepare('INSERT INTO binary_data VALUES (?)').run(Buffer.from([0,1,2]));assert.throws(()=>previousState(db));assert.throws(()=>databaseState(db));assert.equal((db.prepare('SELECT count(*) n FROM binary_data').get() as any).n,1)}finally{db.close()}
})

test('later SQLite errors retain precedence over earlier row encoding failures',()=>{
 const db=new Database(':memory:');let fail=false
 try{
  db.function('maybe_fail',{deterministic:true},(id:number)=>{if(fail&&id===2)throw Error('late SQL failure');return id})
  db.exec('CREATE TABLE fragile (id INTEGER, payload BLOB, generated INTEGER GENERATED ALWAYS AS (maybe_fail(id)) VIRTUAL)')
  const insert=db.prepare('INSERT INTO fragile (id,payload) VALUES (?,?)');insert.run(1,Buffer.from([0]));insert.run(2,Buffer.from([1]));fail=true
  assert.throws(()=>previousState(db),/late SQL failure/);assert.throws(()=>databaseState(db),/late SQL failure/)
  fail=false;assert.equal((db.prepare('SELECT count(*) n FROM fragile').get() as any).n,2)
 }finally{db.close()}
})

test('without-rowid, query-only and numeric edge states keep previous digest behavior',()=>{
 const db=new Database(':memory:')
 try{
  db.exec('CREATE TABLE keyed (id TEXT PRIMARY KEY, value REAL, counter INTEGER) WITHOUT ROWID')
  const insert=db.prepare('INSERT INTO keyed VALUES (?,?,?)');for(const [id,value] of [['a',-0],['b',1e-200],['c',1e200],['d',null]] as const)insert.run(id,value,9007199254740991)
  db.pragma('query_only = ON');assert.deepEqual(databaseState(db),previousState(db))
  db.defaultSafeIntegers(true);assert.throws(()=>previousState(db));assert.throws(()=>databaseState(db))
 }finally{db.close()}
})

test('existing on-disk SQLite backup can be hashed through a read-only connection',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'flymind-db-hash-')),path=join(dir,'fixture.sqlite')
 try{
  const writer=new Database(path);try{writer.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('中文'),('𐀀'),('中文')")}finally{writer.close()}
  const reader=new Database(path,{readonly:true,fileMustExist:true});try{assert.deepEqual(databaseState(reader),previousState(reader));assert.throws(()=>reader.exec('DELETE FROM t'))}finally{reader.close()}
 }finally{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true})}
})
