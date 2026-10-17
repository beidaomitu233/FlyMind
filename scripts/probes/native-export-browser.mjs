import {ensureNativeRuntime} from '../../server/runtime-instance/client.ts'
import {chromium} from 'playwright-core'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:net'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,dirname,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import sharp from 'sharp'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),out=join(root,'output/playwright/native-export-browser');await mkdir(out,{recursive:true})
const dataRoot=await mkdtemp(join(tmpdir(),'flymind-export-browser-')),server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));const origin=`http://127.0.0.1:${port}`
const result={checks:{},pageErrors:[],externalRequests:[]};let child,browser,page,runtimeLog='',identity,apiConnection
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function api(path,method='GET',body){if(path!=='/health'&&!apiConnection)apiConnection=await ensureNativeRuntime({dataRoot,privateRuntimeRoot:join(dataRoot,'.private-runtime'),port:Number(new URL(origin).port),env:{FLYMIND_NATIVE_PILOT:'1'}});const response=await fetch(origin+'/studio-api'+path,{method,headers:{...apiConnection?.headers(),'Content-Type':'application/json','X-FlyMind-DataRoot-Id':identity||''},body:body===undefined?undefined:JSON.stringify(body)}),value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value}
async function until(fn,timeout=15000){for(let deadline=Date.now()+timeout;Date.now()<deadline;){if(await fn())return;await sleep(100)}throw Error('Condition timed out')}
try{
  child=spawn(process.execPath,['server/start.mjs','--runtime'],{cwd:root,env:{...process.env,FLYMIND_DATA_DIR:dataRoot,FLYMIND_PORT:String(port),FLYMIND_NATIVE_PILOT:'1',FLYMIND_PRIVATE_RUNTIME_DIR:join(dataRoot,'.private-runtime')},stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});child.stderr.on('data',b=>runtimeLog+=b.toString())
  await until(async()=>{try{identity=(await api('/health')).dataRootId;return true}catch{return false}})
  const content={schemaVersion:1,id:'ui-export',title:'页面导出验证',kind:'swimlane',nodes:[{id:'a',label:'开始',kind:'start',laneId:'owner',phaseId:'work'},{id:'b',label:'办理事项',kind:'task',laneId:'owner',phaseId:'work'},{id:'c',label:'完成',kind:'end',laneId:'owner',phaseId:'work'}],edges:[{id:'ab',source:'a',target:'b'},{id:'bc',source:'b',target:'c'}],lanes:[{id:'owner',label:'办理人员'}],phases:[{id:'work',label:'办理'}],groups:[]}
  await api('/native/diagrams','POST',{content,requestId:'ui-export-create'})
  browser=await chromium.launch({headless:true,executablePath:join(root,'resources/browsers/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe')});result.browser=browser.version()
  const context=await browser.newContext({viewport:{width:1600,height:1000},serviceWorkers:'block',acceptDownloads:true});await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();result.externalRequests.push(url);return route.abort()})
  page=await context.newPage();page.on('pageerror',error=>result.pageErrors.push(error.message));page.on('dialog',d=>d.accept());const exports=[];page.on('request',req=>{if(req.method()==='POST'&&req.url().endsWith('/ui-export/exports'))exports.push(JSON.parse(req.postData()))})
  await page.goto(origin+'/#/native');await page.locator('[data-diagram-id="ui-export"]').click();let frame=page.frameLocator('iframe.drawio-host');await frame.getByText('办理事项',{exact:true}).first().waitFor()
  await frame.getByText('办理事项',{exact:true}).first().dblclick();await frame.locator('.mxCellEditor:visible').fill('导出前提交文字')
  await page.locator('.native-export-menu summary').click();await page.getByRole('button',{name:'生成五种制品',exact:true}).click();await page.locator('.native-export-status').filter({hasText:'导出完成'}).waitFor({timeout:60000})
  assert.equal(exports.length,1);const record=await api('/native/diagrams/ui-export');assert.ok(record.document.content.nodes.some(n=>n.label==='导出前提交文字'));assert.equal(exports[0].expectedRevision,record.revision);assert.equal(await page.locator('.native-export-menu a').count(),5);result.checks.explicitCommitAndSavePrecedesNativeExport=true
  const downloadPromise=page.waitForEvent('download');await page.locator('.native-export-menu').getByRole('link',{name:'png',exact:true}).click();const download=await downloadPromise;await download.saveAs(join(out,'download.png'));assert.ok((await sharp(join(out,'download.png')).metadata()).width>0);result.checks.realPNGDownload=true
  await page.route('**/ui-export/editor-save',route=>route.abort('connectionfailed'))
  await frame.getByText('导出前提交文字',{exact:true}).first().dblclick();await frame.locator('.mxCellEditor:visible').fill('保存失败时只保留草稿');await frame.locator('.geDiagramContainer').click({position:{x:20,y:20}});await page.keyboard.press('Control+s');await page.locator('[data-status="offline"]').waitFor()
  await page.getByRole('button',{name:'生成五种制品',exact:true}).click();await until(async()=>!await page.getByRole('button',{name:'生成五种制品',exact:true}).isDisabled());assert.equal(exports.length,1);assert.equal(await page.locator('.native-export-menu a').count(),0);assert.equal((await api('/native/diagrams/ui-export')).revision,record.revision);result.checks.failedSaveDoesNotExportOrOfferOldFiles=true
  const recoveryPromise=page.waitForEvent('download');await page.getByRole('button',{name:'下载恢复数据',exact:true}).click();await (await recoveryPromise).saveAs(join(out,'recovery.json'));assert.ok(JSON.parse(await readFile(join(out,'recovery.json'),'utf8')).draft.latestXML.includes('保存失败时只保留草稿'));result.checks.failedSaveOffersLatestRecoveryDownload=true
  await page.screenshot({path:join(out,'save-failure.png')})
  await page.unroute('**/ui-export/editor-save');await page.getByRole('button',{name:'重试保存',exact:true}).click();await until(async()=>(await api('/native/diagrams/ui-export')).document.content.nodes.some(n=>n.label==='保存失败时只保留草稿'))
  await page.getByRole('button',{name:'生成五种制品',exact:true}).click();await page.locator('.native-export-status').filter({hasText:'导出完成'}).waitFor({timeout:60000});assert.equal(exports.length,2);assert.equal(await page.locator('.native-export-menu a').count(),5);result.checks.correctedSaveCanExportNewRevision=true
  await page.screenshot({path:join(out,'export-success.png')});assert.deepEqual(result.pageErrors,[]);assert.deepEqual(result.externalRequests,[]);result.ok=true
}catch(error){result.ok=false;result.error=error.stack;process.exitCode=1;if(page){result.lastUI=await page.locator('.native-toolbar,.native-message').allTextContents().catch(()=>[]);await page.screenshot({path:join(out,'failure.png')}).catch(()=>{})}}
finally{
  if(browser)await browser.close()
  if(child&&child.exitCode===null){let timer;const exited=once(child,'exit');child.send({type:'flymind-test-shutdown'});const graceful=await Promise.race([exited.then(()=>true),new Promise(r=>timer=setTimeout(()=>r(false),10000))]);clearTimeout(timer);result.gracefulShutdown=graceful;if(!graceful){child.kill();await exited;result.ok=false;process.exitCode=1}}
  await writeFile(join(out,'runtime.log'),runtimeLog);await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));assert.ok(resolve(dataRoot).startsWith(resolve(tmpdir())+sep)&&dataRoot.includes('flymind-export-browser-'));await rm(dataRoot,{recursive:true,force:true})
}
