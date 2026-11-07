// PM integration probe: cloud NativeImportDialog — real folder set dedup, re-import
// dedup, dropzone drag/drop, over-limit budget message, lost-ACK exact retry.
// The isolated authority is a fixture, NOT validation of the Java/MySQL deployment.
// Source set: FLYMIND_IMPORT_PROBE_DIR points at a real exported folder (copied,
// never modified); otherwise a synthetic 58-diagram export set is generated via a
// second isolated cloud data root so identical assertions hold everywhere.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,writeFile,cp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {createCloudHTTP} from '../server/cloud/http.ts'
import {launchHiddenBrowser} from '../server/rendering/hidden-browser.ts'
import {resolveRuntimeAssets} from '../server/rendering/assets.ts'
const sourceMode=process.env.FLYMIND_IMPORT_PROBE_DIR?'real':'synthetic'
const output=resolve('output/playwright/cloud-import',sourceMode),root=await mkdtemp(join(tmpdir(),'flymind-import-ui-'))
const tokens={alice:'alice_fixture_abcdefghijklmnopqrstuvwxyz_0123456789'}
const report={startedAt:new Date().toISOString(),authority:'isolated fixture; Java deployment NOT exercised',sourceMode,...(process.env.FLYMIND_IMPORT_PROBE_DIR?{sourceDir:process.env.FLYMIND_IMPORT_PROBE_DIR}:{}),cases:[],errors:[],external:[],previewFailures:[]},clients=[]
const authority=createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):{},token=req.headers.authorization?.slice(7),user=Object.keys(tokens).find(k=>tokens[k]===token)
 res.setHeader('Content-Type','application/json');const reply=(status,data)=>{res.statusCode=status;res.end(JSON.stringify({code:status,message:'fixture',data}))}
 if(req.url==='/app/flymind/auth/login'&&tokens[body.phone]&&body.password==='fixture-password')return reply(200,{sessionToken:tokens[body.phone],expiresAt:Date.now()+3600000,user:{id:body.phone,name:body.phone}})
 if(!user)return reply(401,{})
 const team={id:'team-a',name:'协同测试团队',role:'editor'}
 if(req.url==='/app/flymind/auth/me')return reply(200,{user:{id:user,name:user},expiresAt:Date.now()+3600000,teams:[team]})
 if(req.url==='/app/flymind/session/introspect'&&body.teamId==='team-a')return reply(200,{user:{id:user,name:user},session:{id:'session-'+user,expiresAt:Date.now()+3600000},team})
 return reply(404,{})
})
let server=createServer(),cloud,owned,sourceCloud
async function listen(server,port=0){await new Promise(r=>server.listen(port,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port}
async function stop(server){server.closeAllConnections();await new Promise(r=>server.close(r))}
const content={schemaVersion:1,id:'live-ui',title:'导入验证种子',kind:'flowchart',nodes:[{id:'a',kind:'start',label:'核对材料'},{id:'b',kind:'task',label:'确认交付'},{id:'c',kind:'end',label:'完成交付'}],edges:[{id:'ab',source:'a',target:'b'},{id:'bc',source:'b',target:'c'}],lanes:[],phases:[],groups:[]}
const draft=(id,title)=>({...content,id,title})
try{
 await mkdir(output,{recursive:true});const controlPlaneURL=await listen(authority),origin=await listen(server)
 cloud=createCloudHTTP({controlPlaneURL,publicOrigin:origin,cloudDataRoot:join(root,'data'),allowInsecureLoopback:true,collaborationIntervalMs:150});server.on('request',cloud.app)
 await cloud.workspaces.run(tokens.alice,'team-a','diagram:write',workspace=>workspace.diagrams.create({content,requestId:'fixture-create'},workspace.dataRootId))
 const exportCopy=join(root,'export-set');await mkdir(exportCopy,{recursive:true})
 if(sourceMode==='real')await cp(process.env.FLYMIND_IMPORT_PROBE_DIR,exportCopy,{recursive:true})
 else{
  // Build genuine exported projects in an isolated data root: the tested workspace must not already own these sources.
  sourceCloud=createCloudHTTP({controlPlaneURL,publicOrigin:origin,cloudDataRoot:join(root,'source-data'),allowInsecureLoopback:true,collaborationIntervalMs:150})
  try{
   for(let i=0;i<58;i++){
    const diagram=draft('synthetic-import-'+i,'合成图形 '+(i+1)),name='synthetic-'+String(i).padStart(2,'0')
    await sourceCloud.workspaces.run(tokens.alice,'team-a','diagram:write',workspace=>workspace.diagrams.create({content:diagram,requestId:'fixture-source-'+i},workspace.dataRootId))
    const drawn=await sourceCloud.workspaces.run(tokens.alice,'team-a','diagram:read',workspace=>workspace.diagrams.getDrawing(diagram.id))
    // Write the stored content verbatim so the pair dedups exactly like a real export.
    await writeFile(join(exportCopy,name+'.json'),JSON.stringify(drawn.document.content));await writeFile(join(exportCopy,name+'.project.json'),JSON.stringify(drawn.document))
   }
   await writeFile(join(exportCopy,'manifest.json'),JSON.stringify({not:'a diagram'}))
  }finally{await sourceCloud.close();sourceCloud=undefined}
 }
 owned=await launchHiddenBrowser(resolveRuntimeAssets().browserExecutable)
 const context=await owned.browser.newContext({viewport:{width:1440,height:950},serviceWorkers:'block'}),page=await context.newPage()
 page.on('pageerror',error=>report.errors.push('alice: '+error.message));page.on('console',msg=>{if(msg.type()==='error')report.errors.push('alice: '+msg.text())})
 page.on('response',response=>{if(response.url().includes('/native/imports/items/preview')&&response.status()>=400)report.previewFailures.push({status:response.status(),url:response.url()})})
 await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();report.external.push(url);return route.abort()})
 clients.push({name:'alice',context,page})
 await page.goto(origin+'/#/cloud?team=team-a');await page.getByLabel('手机号',{exact:true}).fill('alice');await page.getByLabel('密码',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'登录',exact:true}).click()
 await page.getByRole('button',{name:'导入到列表',exact:true}).waitFor({timeout:40000})
 await page.getByRole('button',{name:'关闭引导',exact:true}).click({timeout:15000}).catch(()=>{})
 const dialog=()=>page.getByRole('dialog',{name:'导入图形',exact:true})
 async function openImport(){await page.getByRole('button',{name:'导入到列表',exact:true}).click();const d=dialog();await d.waitFor();return d}
 async function closeImport(){await dialog().getByRole('button',{name:'关闭',exact:true}).click();await dialog().waitFor({state:'detached'})}
 const status=d=>d.getByRole('status')
 // Resolves only when exactly n chips show the given text and no row is still being previewed.
 async function chips(n,text){await page.waitForFunction(([n,text])=>{const rows=[...document.querySelectorAll('.import-dialog .import-chip')];const busy=[...document.querySelectorAll('.import-dialog [role=status]')].some(s=>(s.textContent??'').includes('处理中'));return rows.filter(c=>c.textContent===text).length===n&&!busy},[n,text],{timeout:180000})}
 const files=()=>cloud.workspaces.run(tokens.alice,'team-a','workspace:read',async workspace=>workspace.diagrams.list())
 // a. Real exported folder: 117 rows collapse to 58 distinct project.json sources.
 let d=await openImport()
 const emptySubmit=d.getByRole('button',{name:'导入',exact:true});assert.equal((await emptySubmit.innerText()).trim(),'导入');assert.ok(await emptySubmit.isDisabled(),'empty dialog submit must read 导入 and stay disabled')
 await d.locator('input[webkitdirectory]').setInputFiles(exportCopy)
 await chips(58,'可导入')
 await d.getByLabel('导入目标',{exact:true}).selectOption('new')
 await d.locator('.import-chip').filter({hasText:'待填写分组名'}).first().waitFor({timeout:30000});assert.equal(report.previewFailures.length,0,'an unnamed new group must not fire target-invalid previews')
 await d.getByLabel('导入新分组名称',{exact:true}).fill('PBS导入');await d.getByLabel('导入新分组名称',{exact:true}).blur()
 await chips(58,'可导入')
 assert.equal(await d.locator('.import-row').count(),117,'117 files must each list a row')
 const checked=d.locator('.import-row').filter({has:page.locator('input[type="checkbox"]:checked')})
 assert.equal(await checked.count(),58,'exactly 58 ready rows must be checked')
 assert.deepEqual([...new Set(await checked.locator('.import-format').allInnerTexts())],['project'],'all checked rows must be .project.json')
 assert.equal(await d.locator('.import-chip').filter({hasText:'重复来源'}).count(),58,'content .json siblings must be marked duplicate source')
 assert.equal(await d.locator('.import-row').filter({hasText:'manifest.json'}).locator('.import-chip').innerText(),'不支持')
 assert.equal(await d.getByRole('alert').count(),0,'no alert expected for the 58-source folder set')
 await d.screenshot({path:join(output,'dialog-folder-ready.png')})
 await d.getByRole('button',{name:/^导入 \d+ 份$/}).click();await status(d).filter({hasText:'已导入 58 张'}).waitFor({timeout:180000})
 const doneSubmit=d.getByRole('button',{name:'导入完成',exact:true});await doneSubmit.waitFor();assert.equal((await doneSubmit.innerText()).trim(),'导入完成','a fully committed batch must read 导入完成')
 await d.screenshot({path:join(output,'dialog-folder-done.png')})
 const afterFolder=await cloud.workspaces.run(tokens.alice,'team-a','workspace:read',async workspace=>({files:await workspace.diagrams.list(),groups:await workspace.diagrams.groups()}))
 assert.equal(afterFolder.files.length,59,'seed plus 58 imported diagrams');const pbs=afterFolder.groups.find(g=>g.name==='PBS导入');assert.ok(pbs,'PBS导入 group must exist');assert.equal(afterFolder.files.filter(f=>f.workspaceGroupId===pbs.id).length,58,'all 58 imports must land in PBS导入')
 report.cases.push({name:'real-folder-117-files-58-project-imports-to-new-group',passed:true})
 await closeImport();await page.locator('.workspace-folder-open').filter({hasText:'PBS导入'}).waitFor()
 // b. Re-import the identical folder into the same group: every item resolves to the existing record.
 d=await openImport()
 await d.getByLabel('导入目标',{exact:true}).selectOption({label:'PBS导入'})
 await d.locator('input[webkitdirectory]').setInputFiles(exportCopy)
 await chips(58,'已存在')
 await d.getByRole('button',{name:/^导入 \d+ 份$/}).click();await chips(58,'已存在，未重复导入')
 assert.equal((await files()).length,59,'re-import must not create any diagram')
 report.cases.push({name:'reimport-same-folder-all-duplicates-zero-new',passed:true})
 await closeImport()
 // c. Real drop event on the dropzone: one content json plus a companion png.
 d=await openImport()
 const dropContent=draft('drop-imported-diagram','拖放导入')
 await page.evaluate(documentContent=>{const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(documentContent)],'drop-diagram.json',{type:'application/json'}));dt.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])],'companion.png',{type:'image/png'}));window.__dropTransfer=dt;document.querySelector('.import-dropzone').dispatchEvent(new DragEvent('dragenter',{dataTransfer:dt,bubbles:true,cancelable:true}))},dropContent)
 await d.locator('.import-dropzone.dragging').waitFor();await d.screenshot({path:join(output,'dropzone-dragging.png')})
 await page.evaluate(()=>{document.querySelector('.import-dropzone').dispatchEvent(new DragEvent('drop',{dataTransfer:window.__dropTransfer,bubbles:true,cancelable:true}))})
 await d.locator('.import-row').first().waitFor();await chips(1,'可导入')
 assert.equal(await d.locator('.import-row').count(),2,'drop must list the json and the png')
 assert.equal(await d.locator('.import-row').filter({hasText:'companion.png'}).locator('.import-chip').innerText(),'不支持')
 await d.getByRole('button',{name:/^导入 \d+ 份$/}).click();await status(d).filter({hasText:'已导入 1 张'}).waitFor({timeout:60000})
 assert.equal((await files()).length,60);report.cases.push({name:'dropzone-real-drop-content-json-and-png',passed:true})
 await closeImport()
 // d. 151 distinct sources exceed the 150-source precheck budget.
 d=await openImport()
 await d.locator('input[type="file"]').first().setInputFiles(Array.from({length:151},(_,i)=>({name:'d'+i+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(draft('over-'+i,'超限 '+i)))})))
 const alert=d.getByRole('alert');await alert.waitFor({timeout:60000});const alertText=await alert.innerText()
 assert.ok(alertText.includes('151')&&alertText.includes('150'),'over-limit alert must name actual and budget counts: '+alertText)
 report.cases.push({name:'151-sources-over-limit-alert',passed:true,alert:alertText})
 await closeImport()
 // e. Lost successful commit ACK retries the identical request exactly once.
 d=await openImport()
 await d.locator('input[type="file"]').first().setInputFiles([{name:'retry.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(draft('lost-ack-import','重试验证')))}])
 await chips(1,'可导入')
 let lost=false,commits=[];await page.route('**/native/imports/items',async route=>{commits.push(route.request().postDataJSON());if(!lost){lost=true;await route.fetch();await route.abort('failed')}else await route.continue()})
 await d.getByRole('button',{name:/^导入 \d+ 份$/}).click();await d.getByText('结果待确认，可重试',{exact:true}).first().waitFor({timeout:60000})
 await d.getByRole('button',{name:'重试未完成项',exact:true}).click();await status(d).filter({hasText:'已导入 1 张'}).waitFor({timeout:60000})
 await page.unroute('**/native/imports/items');assert.equal(commits.length,2);assert.deepEqual(commits[0],commits[1],'retry must resend the identical request')
 assert.equal((await files()).length,61,'lost-ACK retry must yield exactly one new diagram')
 report.cases.push({name:'lost-ack-exact-retry-one-diagram',passed:true})
 assert.equal(report.previewFailures.length,0,'no preview request may fail: '+JSON.stringify(report.previewFailures))
 assert.ok(!report.errors.some(e=>e.includes(' 400 ')||e.includes('status of 400')),'no 400 console errors allowed: '+JSON.stringify(report.errors))
 report.ok=true
}catch(error){report.error=error.stack;process.exitCode=1;for(const c of clients){await c.page.screenshot({path:join(output,'failure-'+c.name+'.png')}).catch(()=>{});await writeFile(join(output,c.name+'-body.txt'),await c.page.locator('body').innerText().catch(()=>''))}}
finally{
 for(const c of clients)await c.context.close().catch(()=>{});await owned?.close();if(cloud)await cloud.close();await sourceCloud?.close().catch(()=>{});await stop(server);await stop(authority)
 assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-import-ui-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})
 report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,sourceMode,cases:report.cases,error:report.error,errors:report.errors,previewFailures:report.previewFailures,output},null,2))
}
