import {test} from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {decodeDiagramRow,diagramMetadata,type DiagramRow} from '../server/document-record'
import {readDiagramMetadata,readStoredDiagrams} from '../server/store'

const select='SELECT * FROM diagrams WHERE deleted_at IS NULL ORDER BY created_at DESC,id'
const create='CREATE TABLE diagrams(id TEXT,document TEXT,revision INTEGER,saved_at INTEGER,created_at INTEGER,workspace_group_id TEXT,deleted_at INTEGER)'
const old=(db:Database.Database)=>(db.prepare(select).all() as DiagramRow[]).map(diagramMetadata)
const oldStored=(db:Database.Database)=>(db.prepare(select).all() as DiagramRow[]).map(decodeDiagramRow)
function failure(fn:()=>unknown){try{fn()}catch(error){return {name:(error as Error).name,message:(error as Error).message}}assert.fail('expected failure')}
function row(db:Database.Database,id:string,created:number,document:string,deleted:number|null=null){db.prepare('INSERT INTO diagrams(id,document,revision,saved_at,created_at,workspace_group_id,deleted_at) VALUES(?,?,?,?,?,?,?)').run(id,document,3,created+1,created,null,deleted)}
function canvas(id:string,created:number){return JSON.stringify({schemaVersion:3,mode:'canvas-only',id,title:'图形 '+id,createdAt:created,updatedAt:created+1,rendering:{engine:{xml:'<mxfile/>',xmlHash:'hash'}}})}

test('streamed metadata matches previous order, values and deleted filtering',()=>{
 const db=new Database(':memory:')
 try{db.exec(create);assert.deepEqual(readDiagramMetadata(db),old(db))
  row(db,'a',1,canvas('a',1));row(db,'z',2,canvas('z',2));row(db,'b',2,canvas('b',2));row(db,'trash',3,canvas('trash',3),5)
  assert.deepEqual(readDiagramMetadata(db),old(db));assert.deepEqual(readDiagramMetadata(db).map(item=>item.id),['b','z','a']);assert.deepEqual(readStoredDiagrams(db),oldStored(db))
 }finally{db.close()}
})
test('malformed documents fail identically and release the cursor',()=>{
 const db=new Database(':memory:')
 try{db.exec(create);row(db,'bad',2,'{');row(db,'good',1,canvas('good',1));assert.deepEqual(failure(()=>readDiagramMetadata(db)),failure(()=>old(db)));assert.deepEqual(failure(()=>readStoredDiagrams(db)),failure(()=>oldStored(db)))
  assert.equal((db.prepare('SELECT count(*) AS n FROM diagrams').get() as any).n,2)
 }finally{db.close()}
})
test('later database failure takes precedence over earlier metadata failure',()=>{
 const db=new Database(':memory:');let fail=false
 try{db.function('late_error',{deterministic:true},(id:string)=>{if(fail&&id==='second')throw Error('late SQL failure');return id})
  db.exec(create.replace(/\)$/,',extra GENERATED ALWAYS AS (late_error(id)) VIRTUAL)'))
  row(db,'first',2,'{');row(db,'second',1,canvas('second',1));fail=true
  assert.deepEqual(failure(()=>readDiagramMetadata(db)),failure(()=>old(db)));assert.match(failure(()=>readDiagramMetadata(db)).message,/late SQL failure/);assert.deepEqual(failure(()=>readStoredDiagrams(db)),failure(()=>oldStored(db)))
  fail=false;assert.deepEqual(failure(()=>readDiagramMetadata(db)),failure(()=>old(db)))
  assert.equal((db.prepare('SELECT count(*) AS n FROM diagrams').get() as any).n,2)
 }finally{db.close()}
})
