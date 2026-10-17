import {test} from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {DiagramStore,PROJECT_ROOT} from '../server/store'
import {sampleFor} from '../src/drawing/core/samples'
import {projectDocument} from '../src/drawing/core/layers'
const exec=promisify(execFile)
test('回收站保留原图与分组，恢复递增修订拒绝旧页面，永久删除保留防回灌记录',async()=>{
  const root=await mkdtemp(join(tmpdir(),'flymind-trash-'))
  try{const store=new DiagramStore(root);await store.init();const group=await store.createGroup('项目'),d=sampleFor('flowchart');d.id='trash-test';d.presentation.positions.f2={x:700,y:300};const first=await store.create(d,group.id)
    await store.delete(d.id,first.revision);const item=(await store.listTrash()).find(t=>t.id===d.id)!;assert.equal(item.workspaceGroupId,group.id);assert.ok((await store.snapshot()).deletedIds.includes(d.id));await assert.rejects(store.create(d),(e:any)=>e.status===410)
    await assert.rejects(store.restore(d.id,1,item.deletedAt+1),(e:any)=>e.status===409)
    const restored=await new DiagramStore(root).restore(d.id,item.revision,item.deletedAt);assert.equal(restored.revision,2);assert.equal(restored.createdAt,first.createdAt);assert.equal(restored.workspaceGroupId,group.id);assert.deepEqual(restored.document.nodes,first.document.nodes);assert.deepEqual(restored.document.presentation,first.document.presentation)
    await assert.rejects(store.update(d.id,1,d),(e:any)=>e.status===409);await assert.rejects(store.delete(d.id,1),(e:any)=>e.status===409);assert.ok(!(await store.listTrash()).some(t=>t.id===d.id))
    await store.delete(d.id,2);const second=(await store.listTrash()).find(t=>t.id===d.id)!;await assert.rejects(store.purge(d.id,item.revision,item.deletedAt),(e:any)=>e.status===409)
    await mkdir(join(root,'artifacts',d.id),{recursive:true});await writeFile(join(root,'artifacts',d.id,'example.svg'),'test');await store.purge(d.id,second.revision,second.deletedAt)
    await assert.rejects(readFile(join(root,'artifacts',d.id,'example.svg')));await assert.rejects(store.get(d.id),(e:any)=>e.status===410);await assert.rejects(new DiagramStore(root).create(d),(e:any)=>e.status===410);assert.ok((await store.snapshot()).deletedIds.includes(d.id));assert.ok(!(await store.listTrash()).some(t=>t.id===d.id))
    const db=new Database(store.databasePath);try{assert.equal((db.prepare('SELECT COUNT(*) n FROM diagram_versions WHERE diagram_id=?').get(d.id) as any).n,0);assert.throws(()=>db.prepare('INSERT INTO diagrams VALUES(?,?,?,?,?,?,?)').run(d.id,JSON.stringify(projectDocument(d)),1,Date.now(),Date.now(),null,null),/永久删除/);assert.equal(db.pragma('integrity_check',{simple:true}),'ok')}finally{db.close()}
  }finally{await rm(root,{recursive:true,force:true})}
})
test('JSON 一次性事务迁移：完整备份、时间与删除优先、分组、重复启动不回灌',async()=>{
  const root=await mkdtemp(join(tmpdir(),'flymind-migration-'))
  try{await mkdir(join(root,'diagrams'));await mkdir(join(root,'trash'));await writeFile(join(root,'.initialized'),'1')
    const d=sampleFor('flowchart');d.id='legacy';d.updatedAt=1000
    const record={document:projectDocument(d),revision:7,savedAt:2000};await writeFile(join(root,'diagrams','legacy.json'),JSON.stringify(record));await mkdir(join(root,'artifacts','legacy','r1'),{recursive:true});await writeFile(join(root,'artifacts','legacy','r1','diagram.project.json'),JSON.stringify({...projectDocument(d),updatedAt:500}))
    const deleted={...record,document:projectDocument({...d,id:'deleted'})};await writeFile(join(root,'diagrams','deleted.json'),JSON.stringify(deleted));await writeFile(join(root,'trash','deleted.json'),JSON.stringify({record:deleted,deletedAt:3000}))
    await writeFile(join(root,'workspace.json'),JSON.stringify({groups:[{id:'project',name:'项目',revision:2,createdAt:100,updatedAt:200}],assignments:{legacy:'project'}}))
    const store=new DiagramStore(root);await store.init();const result=await store.get('legacy');assert.equal(result.revision,7);assert.equal(result.createdAt,500);assert.equal(result.savedAt,2000);assert.equal(result.workspaceGroupId,'project');assert.deepEqual(result.document.nodes,d.nodes)
    await assert.rejects(store.get('deleted'),(e:any)=>e.status===410);assert.equal((await store.list()).length,1)
    const backups=await readdir(join(root,'backups'));assert.equal(backups.length,1);assert.equal(JSON.parse(await readFile(join(root,'backups',backups[0],'diagrams','legacy.json'),'utf8')).revision,7)
    await store.delete('legacy',7);await new DiagramStore(root).init();assert.equal((await store.list()).length,0)
    const backup=await store.backup(),db=new Database(backup,{readonly:true});try{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal((db.prepare('SELECT COUNT(*) n FROM diagrams').get() as any).n,2)}finally{db.close()}
  }finally{await rm(root,{recursive:true,force:true})}
})
test('独立进程竞争同版本仅一项成功，失败事务无半成品，历史快照与内容同事务提交',async()=>{
  const root=await mkdtemp(join(tmpdir(),'flymind-concurrency-'))
  try{const store=new DiagramStore(root);await store.init();const d=sampleFor('flowchart');d.id='concurrent';await store.create(d)
    const script="import {DiagramStore} from './server/store.ts';const store=new DiagramStore(process.argv[1]);try{await store.patch('concurrent',1,[{op:'set_title',title:process.argv[2]}]);process.stdout.write('saved')}catch(e){process.stdout.write(String(e.status))}"
    const responses=await Promise.all(['A','B'].map(title=>exec(process.execPath,['--import','tsx','--input-type=module','-e',script,root,title],{cwd:PROJECT_ROOT})))
    assert.deepEqual(responses.map(r=>r.stdout).sort(),['409','saved']);assert.equal((await store.get(d.id)).revision,2)
    const before=await store.get(d.id);await assert.rejects(store.patch(d.id,2,[{op:'set_title',title:'不应保存'},{op:'remove_edge',id:'missing'}]));assert.deepEqual(await store.get(d.id),before)
    const db=new Database(store.databasePath);try{assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal((db.prepare('SELECT COUNT(*) n FROM diagram_versions WHERE diagram_id=?').get(d.id) as any).n,2)}finally{db.close()}
  }finally{await rm(root,{recursive:true,force:true})}
})
