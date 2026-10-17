// Real built Vue/Host deep links. No business graph API or production data.
import {ensureNativeRuntime,requestNativeRuntimeShutdown} from '../../server/runtime-instance/client.ts'
import {chromium} from 'playwright-core'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep,basename} from 'node:path'
import assert from 'node:assert/strict'
const root=await mkdtemp(join(tmpdir(),'flymind-mcp-deeplink-')),out=resolve('output/playwright/native-mcp-deeplink');await mkdir(out,{recursive:true})
const env={...process.env,FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:join(root,'data'),FLYMIND_PRIVATE_RUNTIME_DIR:join(root,'runtime'),FLYMIND_PORT:'0'},result={checks:{},errors:[],externalRequests:[]};let connection,browser
async function api(path,method='GET',body){const response=await connection.authenticatedFetch('/studio-api'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value}
try{
 connection=await ensureNativeRuntime({env,dataRoot:env.FLYMIND_DATA_DIR,privateRuntimeRoot:env.FLYMIND_PRIVATE_RUNTIME_DIR,port:0});result.instanceId=connection.instanceId
 const content={schemaVersion:1,id:'deep-native',title:'定向打开验证',kind:'swimlane',nodes:[{id:'a',kind:'start',label:'开始',laneId:'r',phaseId:'p'},{id:'b',kind:'task',label:'处理申请',laneId:'r',phaseId:'p'},{id:'c',kind:'end',label:'完成',laneId:'r',phaseId:'p'}],edges:[{id:'ab',source:'a',target:'b'},{id:'bc',source:'b',target:'c'}],lanes:[{id:'r',label:'经办人员'}],phases:[{id:'p',label:'办理'}],groups:[]}
 await api('/native/diagrams','POST',{content,requestId:'deep-bootstrap'})
 await api('/diagrams','POST',{document:{...content,id:'deep-legacy',title:'旧版只读验证',kind:'flowchart',nodes:content.nodes.map(({laneId,phaseId,...n})=>n),lanes:[],phases:[],updatedAt:Date.now()}})
 const before=await api('/native/records')
 browser=await chromium.launch({headless:true,executablePath:resolve('resources/browsers/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe')});result.browser=browser.version();const context=await browser.newContext({viewport:{width:1500,height:950},serviceWorkers:'block'})
 await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(connection.baseURL+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();result.externalRequests.push(url);return route.abort()})
 const page=await context.newPage();page.on('pageerror',error=>result.errors.push(error.message))
 await page.goto(connection.baseURL+'/#/native?diagram=deep-native');await page.locator('[data-diagram-id="deep-native"].selected').waitFor();await page.frameLocator('iframe.drawio-host').getByText('处理申请',{exact:true}).first().waitFor();assert.equal(await page.locator('.native-editor h1').innerText(),content.title);await page.screenshot({path:join(out,'deep-native.png')});result.checks.realVueDeepLinkSelectedHost=true
 await page.goto('about:blank');await page.goto(connection.baseURL+'/#/native?diagram=deep-legacy');await page.getByRole('alert').filter({hasText:'尚未迁移'}).waitFor();assert.equal(await page.locator('iframe.drawio-host').count(),0);result.checks.legacyReadOnlyNoFakeEditor=true
 await page.goto('about:blank');await page.goto(connection.baseURL+'/#/native?diagram=missing-diagram');await page.getByRole('alert').filter({hasText:'不存在或已删除'}).waitFor();assert.equal(await page.locator('iframe.drawio-host').count(),0);result.checks.missingNoCreate=true
 await api('/native/diagrams/deep-native?revision=1','DELETE');await page.goto('about:blank');await page.goto(connection.baseURL+'/#/native?diagram=deep-native');await page.getByRole('alert').filter({hasText:'不存在或已删除'}).waitFor();assert.equal(await page.locator('iframe.drawio-host').count(),0);result.checks.deletedNoRecreate=true
 const after=await api('/native/records');assert.equal(after.length,before.length-1);assert.ok(!after.some(r=>r.content.id==='missing-diagram'));assert.equal(result.externalRequests.length,0);assert.equal(result.errors.length,0);result.ok=true
}catch(error){result.ok=false;result.errors.push(error.stack??error.message);process.exitCode=1}
finally{await browser?.close();if(connection){await requestNativeRuntimeShutdown(connection);const deadline=Date.now()+15000;let exited=false;while(Date.now()<deadline){try{await fetch(connection.baseURL+'/studio-api/health',{signal:AbortSignal.timeout(500)})}catch{exited=true;break}await new Promise(r=>setTimeout(r,100))}assert.equal(exited,true);await connection.close();result.shutdown='graceful-exited'}if(result.ok){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&basename(root).startsWith('flymind-mcp-deeplink-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});result.tempCleaned=true}await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
