import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,realpath,mkdir,writeFile,readFile,symlink,link,rm} from 'node:fs/promises'
import {join,sep} from 'node:path'
import {tmpdir} from 'node:os'
import {inventoryReleaseRoot,planReleaseRetention} from '../deploy/cloud/release-inventory.mjs'

const supply=n=>({engineResourceKey:String(n).repeat(64),adapterVersion:'1',migrationLevel:1})
async function fixture(){
 const parent=await realpath(tmpdir()),root=await realpath(await mkdtemp(join(parent,'flymind-inventory-'))),releases=join(root,'releases'),outside=join(root,'user-data');await mkdir(releases);await mkdir(outside);await writeFile(join(outside,'sensitive'),'never print this')
 for(let n=1;n<=5;n++){const id=`run-${n}-1`,dir=join(releases,id);await mkdir(dir);await writeFile(join(dir,'candidate.json'),JSON.stringify({schemaVersion:1,prepared:true,dirty:false,releaseId:id,release:{releaseId:id,...supply(n)}}));await writeFile(join(dir,'file'),`payload-${n}`)}
 return {root,releases,outside,async close(){assert.ok(root.startsWith(parent+sep)&&root.split(sep).at(-1).startsWith('flymind-inventory-'));await rm(root,{recursive:true,force:true})}}
}
const opts={readMounts:async()=>[]}
function evidence(){return {current:{complete:true,releaseIds:['run-1-1']},gateway:{complete:true,releaseIds:['run-2-1']},rollback:{complete:true,releaseIds:['run-3-1']},compactBaseline:{complete:true,releaseIds:['run-1-1']},activeProcesses:{complete:true,releaseIds:[]},deploymentState:{complete:true,releaseIds:[]},exportSupplies:{complete:true,keys:[supply(4)]}}}

test('read-only inventory ignores symlink targets and reports hardlinks without claiming reclaimable bytes',async()=>{
 const f=await fixture();try{
  await symlink(f.outside,join(f.releases,'run-1-1','linked-user-data'),process.platform==='win32'?'junction':'dir')
  await link(join(f.releases,'run-2-1','file'),join(f.releases,'run-3-1','linked-file'))
  const report=await inventoryReleaseRoot(f.releases,opts);assert.equal(report.complete,true);assert.equal(report.releases.length,5)
  assert.equal(report.releases.find(r=>r.releaseId==='run-1-1').symlinks,1);assert.equal(report.releases.find(r=>r.releaseId==='run-3-1').hardLinkedFiles,1)
  assert.equal(await readFile(join(f.outside,'sensitive'),'utf8'),'never print this');assert.ok(!JSON.stringify(report).includes('never print this'));assert.ok(!JSON.stringify(report).includes('sensitive'))
  const plan=planReleaseRetention(report,evidence());assert.equal(plan.deleteAuthorized,false);assert.equal(plan.evidenceVerified,false)
  for(let n=1;n<=4;n++)assert.equal(plan.items.find(r=>r.releaseId===`run-${n}-1`).disposition,'protect')
  assert.equal(plan.items.find(r=>r.releaseId==='run-5-1').disposition,'manual-review-only');assert.ok(plan.items.every(r=>r.guaranteedReclaimableBytes===null))
  const busy=evidence();busy.activeProcesses.releaseIds=['run-5-1'];busy.deploymentState.releaseIds=['run-5-1'];const busyItem=planReleaseRetention(report,busy).items.find(r=>r.releaseId==='run-5-1');assert.equal(busyItem.disposition,'protect');assert.deepEqual(busyItem.reasons,['activeProcesses','deploymentState'])
  report.releases.find(r=>r.releaseId==='run-5-1').supply=supply(4);assert.equal(planReleaseRetention(report,evidence()).items.find(r=>r.releaseId==='run-5-1').disposition,'protect')
  assert.equal(await readFile(join(f.releases,'run-5-1','file'),'utf8'),'payload-5')
 }finally{await f.close()}
})

test('missing or inconsistent reference evidence blocks every review hint',async()=>{
 const f=await fixture();try{const report=await inventoryReleaseRoot(f.releases,opts)
  for(const invalid of [{},{...evidence(),rollback:{complete:false,releaseIds:[]}},{...evidence(),gateway:{complete:true,releaseIds:['run-99-1']}},{...evidence(),exportSupplies:{complete:true,keys:[supply(9)]}}]){
   const plan=planReleaseRetention(report,invalid);assert.ok(plan.blockers.length);assert.ok(plan.items.every(item=>item.disposition==='hold'));assert.equal(plan.deleteAuthorized,false)
  }
 }finally{await f.close()}
})

test('unknown candidate, nested mount, budget exhaustion and missing mount inventory fail closed',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.releases,'run-3-1','candidate.json'),'{}')
  let report=await inventoryReleaseRoot(f.releases,opts);assert.equal(report.complete,false);assert.ok(report.releases.find(r=>r.releaseId==='run-3-1').issues.includes('UNVERIFIED_CANDIDATE_METADATA'));assert.ok(planReleaseRetention(report,evidence()).items.every(i=>i.disposition==='hold'))
  report=await inventoryReleaseRoot(f.releases,{readMounts:async()=>[join(f.releases,'run-2-1')]});assert.equal(report.complete,false);assert.ok(report.releases.find(r=>r.releaseId==='run-2-1').issues.includes('DIRECTORY_REDIRECT_OR_MOUNT'))
  report=await inventoryReleaseRoot(f.releases,{...opts,maxEntries:2});assert.equal(report.complete,false);assert.ok(report.issues.includes('INVENTORY_BUDGET_EXCEEDED'))
  report=await inventoryReleaseRoot(f.releases,{readMounts:async()=>{throw Error('unavailable')}});assert.equal(report.complete,false);assert.equal(report.releases.length,0);assert.ok(report.issues.includes('MOUNT_INVENTORY_UNAVAILABLE'))
 }finally{await f.close()}
})

test('unknown top-level and redirected root prevent a complete plan without opening their contents',async()=>{
 const f=await fixture();try{
  await symlink(f.outside,join(f.releases,'unexpected'),process.platform==='win32'?'junction':'dir')
  const report=await inventoryReleaseRoot(f.releases,opts);assert.equal(report.complete,false);assert.equal(report.unknownTopLevel,1);assert.ok(!JSON.stringify(report).includes('sensitive'))
  const redirected=join(f.root,'redirect');await symlink(f.releases,redirected,process.platform==='win32'?'junction':'dir');await assert.rejects(inventoryReleaseRoot(redirected,opts),/canonical/)
 }finally{await f.close()}
})
