import {ensureNativeRuntime} from '../../server/runtime-instance/client.ts'
// Real Vue + Runtime + native iframe + IndexedDB. Only a fresh OS temp data root.
import {chromium} from 'playwright-core'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join,sep,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=join(root,'output/playwright/native-studio')
await mkdir(out,{recursive:true})
const dataRoot=await mkdtemp(join(tmpdir(),'flymind-native-studio-'))
const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r))
const origin=`http://127.0.0.1:${port}`,result={startedAt:new Date().toISOString(),checks:{},errors:[],externalRequests:[]}
const child=spawn(process.execPath,['server/start.mjs','--runtime'],{cwd:root,env:{...process.env,FLYMIND_DATA_DIR:dataRoot,FLYMIND_PORT:String(port),FLYMIND_NATIVE_PILOT:'1',FLYMIND_PRIVATE_RUNTIME_DIR:join(dataRoot,'.private-runtime')},stdio:['ignore','ignore','pipe'],windowsHide:true})
let apiConnection,runtimeLog='',browser,context,page,identity,saveRoutes=[]
child.stderr.on('data',b=>runtimeLog+=b.toString())
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function api(path,method='GET',body){if(path!=='/health'&&!apiConnection)apiConnection=await ensureNativeRuntime({dataRoot,privateRuntimeRoot:join(dataRoot,'.private-runtime'),port:Number(new URL(origin).port),env:{FLYMIND_NATIVE_PILOT:'1'}});const response=await fetch(origin+'/studio-api'+path,{method,headers:{...apiConnection?.headers(),'Content-Type':'application/json','X-FlyMind-DataRoot-Id':identity||''},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error),{status:response.status,...data});return data}
async function until(fn,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await fn())return;await sleep(100)}throw Error('Condition timed out')}
const localDrafts=p=>p.evaluate(()=>new Promise((yes,no)=>{const r=indexedDB.open('flymind-native-drafts-v1',1);r.onerror=()=>no(r.error);r.onsuccess=()=>{const db=r.result;if(!db.objectStoreNames.contains('drafts')){db.close();yes([]);return}const tx=db.transaction('drafts'),q=tx.objectStore('drafts').getAll();q.onsuccess=()=>yes(q.result);q.onerror=()=>no(q.error);tx.oncomplete=()=>db.close()}}))
async function open(p,id){await p.locator(`[data-diagram-id="${id}"]`).click();await p.locator('iframe.drawio-host').waitFor();const f=p.frameLocator('iframe.drawio-host');await f.locator('.geDiagramContainer').waitFor();await f.getByText('办理事项',{exact:true}).first().waitFor();return f}
async function editText(p,f,oldLabel,newLabel,commit=true){await f.getByText(oldLabel,{exact:true}).first().dblclick();const editor=f.locator('[contenteditable="true"]').first();await editor.waitFor();await editor.fill(newLabel);if(commit){await f.locator('.geDiagramContainer').click({position:{x:20,y:20}});await p.keyboard.press('Control+s')}}
try{
  await until(async()=>{try{const h=await api('/health');identity=h.dataRootId;return true}catch{return false}})
  const pbs=JSON.parse(await readFile(join(root,'tests/fixtures/drawio-baseline/pbs-main.content.json'),'utf8'));pbs.id='browser-pbs';pbs.title='PBS 脱敏原生验证'
  await api('/native/diagrams','POST',{content:pbs,requestId:'browser-bootstrap-pbs'})
  const minimal={schemaVersion:1,id:'browser-minimal',title:'保存时序验证',kind:'swimlane',nodes:[{id:'a',kind:'start',label:'开始',laneId:'owner',phaseId:'work'},{id:'b',kind:'task',label:'办理事项',laneId:'owner',phaseId:'work'},{id:'c',kind:'end',label:'完成',laneId:'owner',phaseId:'work'}],edges:[{id:'ab',source:'a',target:'b'},{id:'bc',source:'b',target:'c'}],lanes:[{id:'owner',label:'办理人员'}],phases:[{id:'work',label:'办理阶段'}],groups:[]}
  await api('/native/diagrams','POST',{content:minimal,requestId:'browser-bootstrap-minimal'})
  await api('/diagrams','POST',{document:{...minimal,id:'browser-legacy',title:'未迁移旧图',kind:'flowchart',nodes:minimal.nodes.map(({laneId,phaseId,...n})=>n),lanes:[],phases:[],updatedAt:Date.now()}})
  browser=await chromium.launch({headless:true,executablePath:process.env.DRAWIO_PROBE_BROWSER||join(root,'resources/browsers/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe')});result.browser=browser.version()
  context=await browser.newContext({viewport:{width:1600,height:1000},serviceWorkers:'block',acceptDownloads:true})
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();result.externalRequests.push(url);return route.abort()})
  page=await context.newPage();page.on('pageerror',error=>result.errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
  await page.addInitScript(()=>{window.nativeProbeMessages=[];addEventListener('message',e=>{if(e.origin!==location.origin)return;try{const d=JSON.parse(e.data);if(d.event==='export'&&window.blockNativeExport){e.stopImmediatePropagation();return}if(['load','save','autosave'].includes(d.event))window.nativeProbeMessages.push({event:d.event,xml:d.xml})}catch{}},true)})
  await page.goto(origin+'/#/native');await page.locator('[data-diagram-id="browser-pbs"]').waitFor();const legacyEntry=page.locator('[data-legacy-id="browser-legacy"]');await legacyEntry.waitFor();assert.match(await legacyEntry.innerText(),/未迁移/);assert.equal(await legacyEntry.evaluate(el=>el.tagName),'SPAN');assert.equal(await legacyEntry.locator('a,button').count(),0);result.checks.realVueMixedList=true
  await page.locator('[data-diagram-id="browser-pbs"]').click();await page.frameLocator('iframe.drawio-host').locator('.geDiagramContainer').waitFor();await page.screenshot({path:join(out,'pbs-native.png')});result.checks.pbsBootstrap=true
  await page.locator('[data-diagram-id="browser-minimal"]').click();let frame=page.frameLocator('iframe.drawio-host');await frame.getByText('办理事项',{exact:true}).first().waitFor()
  let release,entered,releaseLatest,latestEntered;const gate=new Promise(r=>release=r),reached=new Promise(r=>entered=r),latestGate=new Promise(r=>releaseLatest=r),latestReached=new Promise(r=>latestEntered=r)
  await page.route('**/native/diagrams/browser-minimal/editor-save',async route=>{saveRoutes.push(JSON.parse(route.request().postData()));if(saveRoutes.length===1){entered();await gate}else if(saveRoutes.length===2){latestEntered();await latestGate}await route.continue()})
  await editText(page,frame,'办理事项','编辑甲');await reached
  await editText(page,frame,'编辑甲','编辑乙');await editText(page,frame,'编辑乙','编辑丙')
  const during=await localDrafts(page);const pending=during.find(d=>d.diagramId==='browser-minimal');assert.ok(pending?.inflight);assert.ok(pending.inflight.request.xml.includes('编辑甲'));assert.ok(pending.latestXML.includes('编辑丙'));assert.equal(saveRoutes.length,1)
  await frame.getByText('编辑丙',{exact:true}).first().click();await frame.locator('.geDiagramContainer').hover();await page.mouse.wheel(0,70);await page.mouse.move(250,80)
  const view=()=>frame.locator('.geDiagramContainer').evaluate(el=>({left:el.scrollLeft,top:el.scrollTop,svgStyle:el.querySelector('svg')?.getAttribute('style'),rects:Array.from(el.querySelectorAll('svg rect')).map(r=>[r.getAttribute('x'),r.getAttribute('y'),r.getAttribute('width'),r.getAttribute('height'),r.getAttribute('fill'),r.getAttribute('stroke')])}))
  const beforeAckView=await view();assert.ok(beforeAckView.top>0)
  const loadsBefore=await page.evaluate(()=>window.nativeProbeMessages.filter(m=>m.event==='load').length)
  release();await latestReached
  const migrated=(await localDrafts(page)).filter(d=>d.diagramId==='browser-minimal');assert.equal(migrated.length,1);assert.equal(migrated[0].baseRevision,2);assert.equal(migrated[0].inflight.request.expectedRevision,2);result.checks.realIDBAtomicKeyMigration=true
  releaseLatest();await until(async()=>{const r=await api('/native/diagrams/browser-minimal');return r.document.content.nodes.some(n=>n.label==='编辑丙')})
  await until(async()=>!(await localDrafts(page)).some(d=>d.diagramId==='browser-minimal'))
  assert.equal(saveRoutes.length,2);assert.equal(saveRoutes[1].expectedRevision,2);assert.equal(await page.evaluate(()=>window.nativeProbeMessages.filter(m=>m.event==='load').length),loadsBefore)
  assert.deepEqual(await view(),beforeAckView);result.checks.viewportAndSelectionDOMPreserved=true
  result.checks.slowAcoalescesBC=true;result.checks.realIndexedDBPendingAndCleanup=true;result.checks.ackDoesNotReload=true
  await page.screenshot({path:join(out,'saved-native.png')})
  // Native geometry edit through actual pointer drag; no graph/model API.
  const label=frame.getByText('编辑丙',{exact:true}).first(),box=await label.boundingBox();assert.ok(box)
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2+16,{steps:12});await page.mouse.up();await page.keyboard.press('Control+s')
  await until(async()=>(await api('/native/diagrams/browser-minimal')).revision>=4);result.checks.realPointerDrag=true
  const startBox=await frame.getByText('开始',{exact:true}).first().boundingBox(),endBox=await frame.getByText('完成',{exact:true}).first().boundingBox();assert.ok(startBox&&endBox)
  await page.mouse.move(startBox.x+startBox.width/2,startBox.y+startBox.height/2);const arrows=frame.locator('.geDiagramContainer img[title]:visible');await arrows.first().waitFor();const arrowBoxes=[];for(let i=0;i<await arrows.count();i++){const b=await arrows.nth(i).boundingBox();if(b)arrowBoxes.push(b)}const east=arrowBoxes.sort((a,b)=>b.x-a.x)[0]
  await page.mouse.move(east.x+east.width/2,east.y+east.height/2);await page.mouse.down();await page.mouse.move(endBox.x+endBox.width/2,endBox.y+endBox.height/2,{steps:24});await page.mouse.up();await page.keyboard.press('Control+s')
  await until(async()=>(await api('/native/diagrams/browser-minimal')).document.content.edges.some(e=>e.source==='a'&&e.target==='c'));result.checks.realNativeConnectionAutosave=true
  await page.unroute('**/native/diagrams/browser-minimal/editor-save')
  let lateRelease,lateEntered;const lateGate=new Promise(r=>lateRelease=r),lateReached=new Promise(r=>lateEntered=r)
  await page.route('**/native/diagrams/browser-minimal/editor-save',async route=>{lateEntered();await lateGate;await route.continue()})
  await editText(page,frame,'编辑丙','迟到请求');await lateReached
  await page.locator('[data-diagram-id="browser-pbs"]').click();await page.locator('.native-editor h1').filter({hasText:'PBS 脱敏原生验证'}).waitFor();lateRelease()
  await until(async()=>(await api('/native/diagrams/browser-minimal')).document.content.nodes.some(n=>n.label==='迟到请求'));assert.ok(await page.locator('[data-diagram-id="browser-pbs"]').evaluate(el=>el.classList.contains('selected')));result.checks.switchLateAckIsolated=true
  const closedDraft=(await localDrafts(page)).find(d=>d.diagramId==='browser-minimal');assert.ok(closedDraft)
  await page.getByRole('button',{name:'刷新',exact:true}).click();await page.locator('.native-drafts summary').click();await page.locator(`[data-draft-session="${closedDraft.sessionId}"]`).getByRole('button',{name:'移除本机草稿',exact:true}).click();await until(async()=>!(await localDrafts(page)).some(d=>d.sessionId===closedDraft.sessionId));result.checks.realIDBExplicitGuardedRemove=true
  await page.locator('[data-diagram-id="browser-minimal"]').click();frame=page.frameLocator('iframe.drawio-host');await frame.getByText('迟到请求',{exact:true}).first().waitFor()
  // An offline committed-model edit persists in real IDB and survives a reload.
  await page.unroute('**/native/diagrams/browser-minimal/editor-save');await page.route('**/native/diagrams/browser-minimal/editor-save',route=>route.abort('connectionfailed'))
  await editText(page,frame,'迟到请求','离线草稿');await until(async()=>(await localDrafts(page)).some(d=>d.diagramId==='browser-minimal'&&d.latestXML.includes('离线草稿')))
  const source=(await localDrafts(page)).find(d=>d.diagramId==='browser-minimal');assert.ok(source.inflight)
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'下载恢复数据',exact:true}).click();const download=await downloadPromise;await download.saveAs(join(out,'recovery-download.json'));assert.ok(JSON.parse(await readFile(join(out,'recovery-download.json'),'utf8')).draft.latestXML.includes('离线草稿'));result.checks.download=true
  await page.reload();await page.locator('.native-drafts summary').click();await page.locator(`[data-draft-session="${source.sessionId}"]`).waitFor();assert.equal(await page.locator('iframe.drawio-host').count(),0);result.checks.refreshDoesNotAutoReplay=true
  const other=await context.newPage();other.on('dialog',d=>d.accept());await other.goto(origin+'/#/native');await other.locator('.native-drafts summary').click()
  await Promise.all([page,other].map(p=>p.locator(`[data-draft-session="${source.sessionId}"]`).getByRole('button',{name:'恢复',exact:true}).click()))
  await until(async()=>{const ds=(await localDrafts(page)).filter(d=>d.diagramId==='browser-minimal');return ds.length===3&&new Set(ds.map(d=>d.sessionId)).size===3})
  const branches=(await localDrafts(page)).filter(d=>d.diagramId==='browser-minimal');for(const d of branches)assert.deepEqual(d.inflight.request,source.inflight.request)
  result.checks.realIDBConcurrentRecoveryFork=true
  await page.unroute('**/native/diagrams/browser-minimal/editor-save');await page.getByRole('button',{name:'重试保存',exact:true}).click();await until(async()=>(await api('/native/diagrams/browser-minimal')).document.content.nodes.some(n=>n.label==='离线草稿'))
  await until(async()=>(await localDrafts(page)).filter(d=>d.diagramId==='browser-minimal').length===2)
  result.checks.oldAckCannotClearOtherRecovery=true
  await other.close()
  frame=page.frameLocator('iframe.drawio-host');await frame.getByText('离线草稿',{exact:true}).first().waitFor()
  await editText(page,frame,'离线草稿','导航提交文字',false)
  await page.locator('[data-diagram-id="browser-pbs"]').click();await page.locator('.native-editor h1').filter({hasText:'PBS 脱敏原生验证'}).waitFor()
  assert.ok((await api('/native/diagrams/browser-minimal')).document.content.nodes.some(n=>n.label==='导航提交文字'));result.checks.navigationCommitsActiveText=true
  await page.locator('[data-diagram-id="browser-minimal"]').click();frame=page.frameLocator('iframe.drawio-host');await frame.getByText('导航提交文字',{exact:true}).first().waitFor()
  await editText(page,frame,'导航提交文字','捕获失败保留',false);await page.evaluate(()=>window.blockNativeExport=true)
  await page.locator('[data-diagram-id="browser-pbs"]').click();await page.getByRole('alert').filter({hasText:'抓取超时'}).waitFor({timeout:15000})
  assert.ok(await page.locator('[data-diagram-id="browser-minimal"]').evaluate(el=>el.classList.contains('selected')));assert.equal(await page.locator('iframe.drawio-host').count(),1)
  result.checks.captureFailureBlocksNavigation=true
  let downloads=0;const countDownload=()=>downloads++;page.on('download',countDownload)
  await page.getByRole('button',{name:'下载恢复数据',exact:true}).click();await page.getByRole('button',{name:'下载恢复数据',exact:true}).waitFor({state:'visible'});await until(async()=>!await page.getByRole('button',{name:'下载恢复数据',exact:true}).isDisabled(),15000)
  assert.equal(downloads,0);page.off('download',countDownload);result.checks.captureFailureDoesNotDownloadOldSnapshot=true
  await page.evaluate(()=>window.blockNativeExport=false);await page.getByRole('button',{name:'重试保存',exact:true}).click();await until(async()=>(await api('/native/diagrams/browser-minimal')).document.content.nodes.some(n=>n.label==='捕获失败保留'))
  const concurrentBase=await api('/native/diagrams/browser-minimal');await api('/native/diagrams/browser-minimal/content-patch','POST',{operations:[{op:'set_title',title:'外部修订'}],expectedRevision:concurrentBase.revision,requestId:'browser-external-conflict'})
  await editText(page,frame,'捕获失败保留','冲突本机草稿');await page.locator('[data-status="conflict"]').waitFor();assert.ok((await localDrafts(page)).some(d=>d.latestXML.includes('冲突本机草稿')));assert.ok(!(await api('/native/diagrams/browser-minimal')).document.content.nodes.some(n=>n.label==='冲突本机草稿'));result.checks.real409PreservesDraft=true
  await page.getByRole('button',{name:'重新读取远端',exact:true}).click();frame=page.frameLocator('iframe.drawio-host');await frame.getByText('捕获失败保留',{exact:true}).first().waitFor()
  const quotaBase=await api('/native/diagrams/browser-minimal')
  await page.evaluate(()=>{window.originalDraftPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='drafts')throw new DOMException('Controlled quota failure','QuotaExceededError');return window.originalDraftPut.apply(this,args)}})
  await editText(page,frame,'捕获失败保留','配额未备份');await page.locator('[data-status="draft-error"]').waitFor();assert.equal((await api('/native/diagrams/browser-minimal')).revision,quotaBase.revision)
  const unbackedDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载恢复数据',exact:true}).click();await (await unbackedDownload).saveAs(join(out,'unbacked-download.json'));assert.ok(JSON.parse(await readFile(join(out,'unbacked-download.json'),'utf8')).draft.latestXML.includes('配额未备份'));result.checks.realIDBTransactionAbortAllowsCurrentDownload=true
  await page.evaluate(()=>IDBObjectStore.prototype.put=window.originalDraftPut);await page.getByRole('button',{name:'重试保存',exact:true}).click();await until(async()=>(await api('/native/diagrams/browser-minimal')).document.content.nodes.some(n=>n.label==='配额未备份'))
  // Identity replacement at the same path, with same diagram/revision: mutation must refuse.
  const before=await api('/native/diagrams/browser-minimal'),db=new Database(join(dataRoot,'flymind.sqlite'))
  const counts=()=>({versions:db.prepare('SELECT count(*) n FROM diagram_versions').get().n,requests:db.prepare('SELECT count(*) n FROM native_mutation_requests').get().n})
  const beforeCounts=counts();db.prepare("UPDATE metadata SET value=? WHERE key='native_workspace_id'").run(randomUUID())
  frame=page.frameLocator('iframe.drawio-host');await frame.getByText('配额未备份',{exact:true}).first().waitFor();await editText(page,frame,'配额未备份','身份变化后草稿')
  await page.locator('[data-status="conflict"]').waitFor();assert.deepEqual(counts(),beforeCounts);assert.equal(db.prepare('SELECT revision FROM diagrams WHERE id=?').get('browser-minimal').revision,before.revision);db.close()
  await assert.rejects(api('/native/diagrams/browser-minimal'),e=>e.code==='WORKSPACE_MISMATCH');result.checks.samePathIdentityMutationRefused=true
  await page.screenshot({path:join(out,'workspace-mismatch.png')});assert.deepEqual(result.errors,[]);assert.deepEqual(result.externalRequests,[]);result.ok=true
}catch(error){result.ok=false;result.error=error.stack;result.lastRecord=await api('/native/diagrams/browser-minimal').catch(()=>undefined);result.lastRequests=saveRoutes;if(page)result.lastDrafts=await localDrafts(page).catch(()=>[]);process.exitCode=1;if(page)await page.screenshot({path:join(out,'failure.png')}).catch(()=>{})}
finally{
  if(browser)await browser.close();if(child.exitCode===null){child.kill();await once(child,'exit')}
  await writeFile(join(out,'runtime.log'),runtimeLog);await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
  assert.ok(resolve(dataRoot).startsWith(resolve(tmpdir())+sep)&&dataRoot.includes('flymind-native-studio-'));await rm(dataRoot,{recursive:true,force:true})
}
