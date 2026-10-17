import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,basename} from 'node:path'
import {sampleFor} from '../src/drawing/core/samples'
import {DiagramStore} from '../server/store'
import {renderArtifacts,readExportFile} from '../server/artifacts'
import {exportBasename,exportStamp} from '../src/drawing/core/export-metadata'

test('导出副本按本次导出时间生成，修改时间与版本保持不变，旧导出仍可读取',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-export-time-'))
 try{const store=new DiagramStore(root);await store.init();const d=sampleFor('flowchart');d.id='export-clock';const before=await store.create(d),source=JSON.stringify(before),start=Date.now()
   const a=await renderArtifacts(before,root),b=await renderArtifacts(before,root);assert.ok(a.exportedAt>=start&&b.exportedAt>=a.exportedAt);assert.notEqual(a.files.png,b.files.png);assert.notEqual(a.exportId,b.exportId);assert.ok(basename(b.files.png).includes(exportStamp(b.exportedAt)))
   for(const path of Object.values(b.files)){const info=await stat(path);assert.ok(Math.abs(info.mtimeMs-b.exportedAt)<5);assert.ok(info.birthtimeMs>=start-2000)}
   assert.deepEqual(await readExportFile(root,d.id,before.revision,a.exportId,'png'),a.png);assert.equal(JSON.parse(await readFile(b.files['project.json'],'utf8')).updatedAt,before.document.updatedAt);assert.equal(JSON.stringify(await store.get(d.id)),source);assert.ok(b.urls.png.includes('/exports/'+b.exportId+'/'));assert.ok(!b.urls.png.includes(' '));await assert.rejects(readExportFile(root,d.id,1,'../outside','png'))
 }finally{await rm(root,{recursive:true,force:true})}
})
test('导出名称可辨识且安全，时间来自导出参数',()=>{const at=new Date(2026,9,15,20,30,12,34).getTime();assert.equal(exportBasename('流程:/图',at),'流程__图_20261015-203012-034');assert.notEqual(exportBasename('图',at),exportBasename('图',at+1))})
