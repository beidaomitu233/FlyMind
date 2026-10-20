// Actual browser + compiled local Runtime. The account authority is a fixture.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
import {tmpdir} from 'node:os'
import {localAuthorityFixture} from '../tests/helpers/local-authority.ts'
import {launchHiddenBrowser} from '../server/rendering/hidden-browser.ts'
import {resolveRuntimeAssets} from '../server/rendering/assets.ts'
const root=await mkdtemp(join(tmpdir(),'flymind-local-auth-ui-')),output=resolve('output/playwright/local-auth-ui'),authority=await localAuthorityFixture(),report={authority:'fixture, not Java/MySQL',checks:[]}
let child,closed,owned
try{
 await mkdir(output,{recursive:true});child=spawn(process.execPath,['lib/server/runtime.js'],{cwd:resolve('.'),env:{...process.env,FLYMIND_CONTROL_PLANE_ORIGIN:authority.origin,FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:join(root,'data'),FLYMIND_PRIVATE_RUNTIME_DIR:join(root,'private'),FLYMIND_PORT:'0'},windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});closed=new Promise(r=>child.once('exit',r));let error='';child.stderr.on('data',b=>error+=String(b))
 await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Runtime readiness failed: '+error)),20000);child.once('error',no);child.on('message',m=>{if(m.type==='flymind-runtime-ready'){clearTimeout(timer);yes()}})})
 const credential=JSON.parse(await readFile(join(root,'private',(await readdir(join(root,'private'))).find(n=>n.endsWith('.json'))),'utf8')),base='http://127.0.0.1:'+credential.port
 owned=await launchHiddenBrowser(resolveRuntimeAssets().browserExecutable);const page=await owned.browser.newPage({viewport:{width:1440,height:950}})
 await page.goto(base+'/#/native');await page.getByRole('heading',{name:'登录 FlyMind',exact:true}).waitFor();assert.equal(await page.locator('iframe.drawio-host').count(),0)
 await page.getByLabel('手机号',{exact:true}).fill('13800000001');await page.getByLabel('密码',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'授权本地工作区',exact:true}).click();await page.getByRole('button',{name:'新建图形',exact:true}).waitFor();report.checks.push('browser-login-team-grant-opens-original-studio')
 await page.getByRole('button',{name:'新建图形',exact:true}).click();await page.getByRole('button',{name:'流程图',exact:true}).click();await page.locator('iframe.drawio-host:not(.drawio-host-pending)').waitFor({timeout:40000});await page.locator('[data-status=ready]').waitFor();report.checks.push('compiled-runtime-real-canvas-create')
 await page.getByRole('button',{name:'Test · 退出',exact:true}).click();await page.getByRole('heading',{name:'登录 FlyMind',exact:true}).waitFor();assert.equal(await page.locator('iframe.drawio-host').count(),0);const denied=await page.request.get(base+'/studio-api/native/workspace');assert.equal(denied.status(),401);report.checks.push('logout-hides-business-ui-and-API-denies')
 await page.screenshot({path:join(output,'logged-out.png')});report.ok=true
}catch(error){report.error=error.stack;process.exitCode=1}
finally{
 await owned?.close();if(child?.exitCode===null){child.send({type:'flymind-test-shutdown'});let timer;try{await Promise.race([closed,new Promise((_,no)=>timer=setTimeout(()=>no(Error('Own Runtime stop timeout')),10000))])}finally{clearTimeout(timer);if(child.exitCode===null){child.kill();await closed}}}
 await authority.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-local-auth-ui-'));await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100});await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
