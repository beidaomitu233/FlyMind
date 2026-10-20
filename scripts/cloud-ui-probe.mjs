// PM integration probe: actual CloudStudio + HTTP/SSE + two native draw.io frames.
// The isolated authority is a fixture, NOT validation of the Java/MySQL deployment.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {createCloudHTTP} from '../server/cloud/http.ts'
import {launchHiddenBrowser} from '../server/rendering/hidden-browser.ts'
import {resolveRuntimeAssets} from '../server/rendering/assets.ts'
import {sameNativeState} from '../src/drawing/engine/collaboration/state.ts'
const output=resolve('output/playwright/v11-cloud-ui'),root=await mkdtemp(join(tmpdir(),'flymind-v11-ui-'))
const tokens={alice:'alice_fixture_abcdefghijklmnopqrstuvwxyz_0123456789',bob:'bob_fixture_abcdefghijklmnopqrstuvwxyz_0123456789'}
const report={startedAt:new Date().toISOString(),authority:'isolated fixture; Java deployment NOT exercised',cases:[],errors:[],external:[]},clients=[]
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
const server=createServer();let cloud,owned
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port}
async function stop(server){server.closeAllConnections();await new Promise(r=>server.close(r))}
const content={schemaVersion:1,id:'live-ui',title:'多人画布集成',kind:'flowchart',nodes:[{id:'a',kind:'task',label:'核对材料'},{id:'b',kind:'task',label:'确认交付'}],edges:[{id:'ab',source:'a',target:'b'}],lanes:[],phases:[],groups:[]}
try{
 await mkdir(output,{recursive:true});const controlPlaneURL=await listen(authority),origin=await listen(server)
 cloud=createCloudHTTP({controlPlaneURL,publicOrigin:origin,cloudDataRoot:join(root,'data'),allowInsecureLoopback:true,collaborationIntervalMs:150});server.on('request',cloud.app)
 await cloud.workspaces.run(tokens.alice,'team-a','diagram:write',workspace=>workspace.diagrams.create({content,requestId:'fixture-create'},workspace.dataRootId))
 owned=await launchHiddenBrowser(resolveRuntimeAssets().browserExecutable)
 async function client(name){
  const context=await owned.browser.newContext({viewport:{width:1440,height:950},serviceWorkers:'block'}),page=await context.newPage()
  page.on('pageerror',error=>report.errors.push(name+': '+error.message));page.on('console',msg=>{if(msg.type()==='error')report.errors.push(name+': '+msg.text())})
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();report.external.push(url);return route.abort()})
  await page.addInitScript(()=>{window.nativeEvents=[];window.addEventListener('message',e=>{if(e.origin===location.origin&&typeof e.data==='string')try{const data=JSON.parse(e.data);if(data.event)window.nativeEvents.push({event:data.event,error:data.error})}catch{}})})
  const c={name,context,page,sequence:0};clients.push(c)
  await page.goto(origin+'/#/cloud?team=team-a&diagram=live-ui');await page.getByLabel('手机号',{exact:true}).fill(name);await page.getByLabel('密码',{exact:true}).fill('fixture-password');await page.getByRole('button',{name:'登录',exact:true}).click()
  await page.locator('iframe.drawio-host:not(.drawio-host-pending)').waitFor({timeout:40000});c.frame=()=>page.frames().find(f=>f.url().startsWith(origin+'/drawio/'))
  await page.getByRole('status').filter({hasText:'协同已连接'}).waitFor({timeout:20000})
  c.xml=async()=>{const key=name+':probe:'+(++c.sequence);return page.evaluate(async key=>await new Promise((yes,no)=>{const frame=document.querySelector('iframe.drawio-host:not(.drawio-host-pending)'),timer=setTimeout(()=>{removeEventListener('message',receive);no(Error('capture timeout'))},10000);function receive(e){if(e.origin!==location.origin||e.source!==frame.contentWindow||typeof e.data!=='string')return;const value=JSON.parse(e.data);if(value.event==='export'&&value.message?.message===key){clearTimeout(timer);removeEventListener('message',receive);yes(value.xml)}}addEventListener('message',receive);frame.contentWindow.postMessage(JSON.stringify({action:'export',format:'xml',message:key}),location.origin)}),key)}
  c.label=async(before,after)=>{await c.frame().getByText(before,{exact:true}).first().dblclick();const editor=c.frame().locator('.mxCellEditor:visible').first();await editor.waitFor();await page.keyboard.press('Control+a');await page.keyboard.insertText(after);await page.keyboard.press('Control+Enter');await editor.waitFor({state:'hidden'})}
  c.labelPresent=async text=>{await c.frame().getByText(text,{exact:true}).first().waitFor({timeout:20000})}
  return c
 }
 const a=await client('alice'),b=await client('bob')
 await Promise.all([a.label('核对材料','甲核对材料'),b.label('确认交付','乙确认交付')])
 await Promise.all([a.labelPresent('乙确认交付'),b.labelPresent('甲核对材料')])
 await Promise.all(clients.map(c=>c.page.locator('[data-status="ready"]').waitFor({timeout:20000})))
 assert.ok(sameNativeState(await a.xml(),await b.xml()));report.cases.push({name:'two-real-cloud-studio-editors',converged:true})
 await a.page.getByRole('button',{name:'撤销',exact:true}).click();await b.labelPresent('核对材料');await a.labelPresent('乙确认交付')
 report.cases.push({name:'local-undo-keeps-peer-edit',passed:true})
 const loads=await Promise.all(clients.map(c=>c.page.evaluate(()=>window.nativeEvents.filter(e=>e.event==='load').length)))
 assert.deepEqual(loads,[1,1]);report.cases.push({name:'no-document-reload-on-sync',loads})
 await b.context.setOffline(true);await b.label('乙确认交付','乙断线修改');await a.label('核对材料','甲在线修改');await a.page.locator('[data-status="ready"]').waitFor({timeout:20000});await b.context.setOffline(false)
 await Promise.all([a.labelPresent('乙断线修改'),b.labelPresent('甲在线修改')]);report.cases.push({name:'offline-dirty-reconnect',passed:true})
 await Promise.all(clients.map(c=>c.page.locator('[data-status="ready"]').waitFor({timeout:20000})))
 assert.ok(sameNativeState(await a.xml(),await b.xml()))
 const source=await cloud.workspaces.run(tokens.alice,'team-a','diagram:read',workspace=>workspace.diagrams.getDrawing(content.id))
 await a.page.getByRole('button',{name:'工作区菜单：新建分组、导入、排序',exact:true}).click();await a.page.getByRole('button',{name:'导入图形',exact:true}).click()
 const dialog=a.page.getByRole('dialog',{name:'导入图形',exact:true})
 await dialog.locator('input[type="file"]').first().setInputFiles([
  {name:'all.project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source.document))},
  {name:'all.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source.document.content))},
  {name:'all.drawio',mimeType:'application/xml',buffer:Buffer.from(source.document.rendering.engine.xml)},
  {name:'all.png',mimeType:'image/png',buffer:Buffer.from('companion-not-read')},
  {name:'all.svg',mimeType:'image/svg+xml',buffer:Buffer.from('companion-not-read')}
 ])
 await dialog.getByRole('button',{name:'导入',exact:true}).waitFor();await dialog.getByLabel('导入目标',{exact:true}).selectOption('new');await dialog.getByLabel('导入新分组名称',{exact:true}).fill('导入验收');await dialog.getByLabel('导入新分组名称',{exact:true}).blur()
 await dialog.getByRole('button',{name:'导入',exact:true}).click();await dialog.getByRole('status').filter({hasText:'已导入 1 张'}).waitFor({timeout:20000});await dialog.getByRole('button',{name:'关闭导入',exact:true}).click()
 const afterImport=await cloud.workspaces.run(tokens.alice,'team-a','workspace:read',async workspace=>({files:await workspace.diagrams.list(),groups:await workspace.diagrams.groups(),activity:await workspace.store.listActivity({},workspace.dataRootId)}))
 assert.equal(afterImport.files.length,2);assert.equal(afterImport.groups.length,1);assert.equal(afterImport.files.filter(f=>f.workspaceGroupId===afterImport.groups[0].id).length,1)
 await a.page.locator('.workspace-folder-open').filter({hasText:'导入验收'}).click();assert.equal(await a.page.locator('.workspace-group-files .workspace-file').count(),1);assert.equal(await a.page.locator('.workspace-root-files .workspace-file').count(),1)
 report.cases.push({name:'all-formats-one-editable-import-in-folder',passed:true})
 assert.ok(afterImport.activity.items.some(e=>e.actor.userId==='alice'&&e.actor.channel==='web'));assert.ok(afterImport.activity.items.some(e=>e.actor.userId==='bob'&&e.actor.channel==='web'))
 await a.page.getByRole('button',{name:'工作区菜单：新建分组、导入、排序',exact:true}).click();await a.page.getByRole('button',{name:'操作记录',exact:true}).click();const activity=a.page.getByRole('dialog',{name:'操作记录',exact:true});await activity.locator('article').first().waitFor();assert.ok((await activity.innerText()).includes('alice'));await activity.getByRole('button',{name:'关闭操作记录',exact:true}).click()
 report.cases.push({name:'trusted-actors-and-real-activity-dialog',passed:true})
 await a.page.screenshot({path:join(output,'alice.png')});await b.page.screenshot({path:join(output,'bob.png')})
 report.ok=true
}catch(error){report.error=error.stack;process.exitCode=1;for(const c of clients){await c.page.screenshot({path:join(output,'failure-'+c.name+'.png')}).catch(()=>{});await writeFile(join(output,c.name+'-body.txt'),await c.page.locator('body').innerText().catch(()=>''));await writeFile(join(output,c.name+'-events.json'),JSON.stringify(await c.page.evaluate(()=>window.nativeEvents).catch(()=>[])))}}
finally{
 for(const c of clients)await c.context.close().catch(()=>{});await owned?.close();if(cloud)await cloud.close();await stop(server);await stop(authority)
 assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-v11-ui-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})
 report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,cases:report.cases,error:report.error,output},null,2))
}
