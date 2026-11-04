import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import Database from 'better-sqlite3'
import {DiagramStore} from '../server/store'
import {validateWorkspace} from '../server/backups/workspace'
import {createNativeCanvasProject} from '../src/drawing/engine/native-canvas'

async function fixture(seedExamples=false){
 const directory=await mkdtemp(join(tmpdir(),'flymind-backup-order-')),root=join(directory,'data'),store=new DiagramStore(root)
 try{await store.init({seedExamples});return {directory,root,store,close:async()=>{assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));await rm(directory,{recursive:true,force:true})}}}
 catch(error){await rm(directory,{recursive:true,force:true});throw error}
}
const xml='<mxfile><diagram id="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'

test('async canvas validation reports the first row error and leaves the database usable',async()=>{
 const f=await fixture()
 try{
  const first=await createNativeCanvasProject(xml,{id:'first',title:'First',createdAt:1,updatedAt:2}),second=await createNativeCanvasProject(xml,{id:'wrong',title:'Second',createdAt:1,updatedAt:2})
  const bad=structuredClone(first);bad.rendering.engine.xmlHash='0'.repeat(64)
  const db=new Database(f.store.databasePath)
  try{const insert=db.prepare('INSERT INTO diagrams VALUES(?,?,?,?,?,?,NULL)'),history=db.prepare('INSERT INTO diagram_versions VALUES(?,?,?,?)')
   for(const [id,doc] of [['first',bad],['second',second]] as const){const text=JSON.stringify(doc);insert.run(id,text,1,2,1,null);history.run(id,1,text,2)}
  }finally{db.close()}
  await assert.rejects(validateWorkspace(f.root),/CANVAS_XML_HASH_MISMATCH/)
  const repair=new Database(f.store.databasePath);try{const text=JSON.stringify(first);repair.prepare('UPDATE diagrams SET document=? WHERE id=?').run(text,'first');repair.prepare('UPDATE diagram_versions SET document=? WHERE diagram_id=?').run(text,'first')}finally{repair.close()}
  await assert.rejects(validateWorkspace(f.root),/Canvas stored record metadata is inconsistent/)
 }finally{await f.close()}
})

test('historical rows preserve first failure order and valid public result',async()=>{
 const f=await fixture(true)
 try{
  const valid=await validateWorkspace(f.root);assert.ok(valid.counts.diagrams>=2);assert.deepEqual(valid.jobs,[])
  const db=new Database(f.store.databasePath);let id:string
  try{id=(db.prepare('SELECT id FROM diagrams LIMIT 1').get() as {id:string}).id
   const insert=db.prepare('INSERT INTO diagram_versions VALUES(?,?,?,?)')
   insert.run(id,100,JSON.stringify({schemaVersion:3,id:'wrong'}),2)
   insert.run(id,101,JSON.stringify({schemaVersion:3,id}),2)
  }finally{db.close()}
  await assert.rejects(validateWorkspace(f.root),/历史身份不符/)
  const repair=new Database(f.store.databasePath);try{repair.prepare('DELETE FROM diagram_versions WHERE diagram_id=? AND revision=100').run(id!)}finally{repair.close()}
  await assert.rejects(validateWorkspace(f.root),/project\.id is not allowed/)
 }finally{await f.close()}
})
