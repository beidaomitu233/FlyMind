import {test} from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {readTrashRows} from '../server/store'
const create='CREATE TABLE diagrams(id TEXT,document TEXT,revision INTEGER,saved_at INTEGER,created_at INTEGER,workspace_group_id TEXT,deleted_at INTEGER)'
const sql='SELECT * FROM diagrams WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC,id'
function old(db:Database.Database){return (db.prepare(sql).all() as any[]).map(row=>{const raw=JSON.parse(row.document),content=raw.content||raw;return {id:row.id,title:content.title,...(raw.mode==='canvas-only'?{mode:'canvas-only'}:{kind:content.kind}),revision:row.revision,deletedAt:row.deleted_at,createdAt:row.created_at,workspaceGroupId:row.workspace_group_id}})}
function fail(fn:()=>unknown){try{fn()}catch(error){const e=error as Error;return {name:e.name,message:e.message}}assert.fail('expected failure')}
function insert(db:Database.Database,id:string,document:string,deleted:number|null){db.prepare('INSERT INTO diagrams(id,document,revision,saved_at,created_at,workspace_group_id,deleted_at) VALUES(?,?,3,5,2,NULL,?)').run(id,document,deleted)}

test('trash list retains previous fields, ordering, filtering and JSON semantics',()=>{
 const db=new Database(':memory:')
 try{db.exec(create);assert.deepEqual(readTrashRows(db),old(db));insert(db,'b','{"title":"旧图","kind":"flowchart"}',3);insert(db,'a','{"mode":"canvas-only","title":"画布"}',3);insert(db,'z','{"content":{"title":"业务图","kind":"mindmap"}}',5);insert(db,'hidden','{"title":"live"}',null)
  assert.deepEqual(readTrashRows(db),old(db));assert.deepEqual(readTrashRows(db).map(r=>r.id),['z','a','b'])
 }finally{db.close()}
})
test('malformed JSON and later SQLite failures retain previous error priority',()=>{
 for(const invalid of ['{','null']){const db=new Database(':memory:');let failSql=false
  try{db.function('later_error',{deterministic:true},(id:string)=>{if(failSql&&id==='later')throw Error('late SQL failure');return id});db.exec(create.replace(/\)$/,',extra GENERATED ALWAYS AS (later_error(id)) VIRTUAL)'))
   insert(db,'bad',invalid,3);insert(db,'later','{"title":"later"}',2)
   assert.deepEqual(fail(()=>readTrashRows(db)),fail(()=>old(db)));failSql=true
   assert.deepEqual(fail(()=>readTrashRows(db)),fail(()=>old(db)));assert.match(fail(()=>readTrashRows(db)).message,/late SQL failure/)
   failSql=false;assert.equal((db.prepare('SELECT count(*) AS n FROM diagrams').get() as any).n,2)
  }finally{db.close()}
 }
})
