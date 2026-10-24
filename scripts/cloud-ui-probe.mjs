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
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
const output=resolve('output/playwright/v11-cloud-ui'),root=await mkdtemp(join(tmpdir(),'flymind-v11-ui-'))
const tokens={alice:'alice_fixture_abcdefghijklmnopqrstuvwxyz_0123456789',bob:'bob_fixture_abcdefghijklmnopqrstuvwxyz_0123456789'}
const mcpToken='fm_mcp_'+'m'.repeat(43),gatewayKey='fixture_gateway_'+'k'.repeat(40)
let publicOrigin,mcpClient
const report={startedAt:new Date().toISOString(),authority:'isolated fixture; Java deployment NOT exercised',cases:[],errors:[],external:[]},clients=[]
const authority=createServer(async(req,res)=>{
 let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):{},token=req.headers.authorization?.slice(7),user=Object.keys(tokens).find(k=>tokens[k]===token)
 res.setHeader('Content-Type','application/json');const reply=(status,data)=>{res.statusCode=status;res.end(JSON.stringify({code:status,message:'fixture',data}))}
 if(req.url==='/app/flymind/auth/login'&&tokens[body.phone]&&body.password==='fixture-password')return reply(200,{sessionToken:tokens[body.phone],expiresAt:Date.now()+3600000,user:{id:body.phone,name:body.phone}})
 if(req.url==='/app/flymind/oauth/introspect'&&token===mcpToken&&req.headers['x-flymind-gateway-key']===gatewayKey)return reply(200,{user:{id:'alice',name:'alice'},session:{id:'mcp-session',expiresAt:Date.now()+3600000},team:{id:'team-a',name:'协同测试团队',role:'editor'},authorization:{purpose:'mcp',resource:publicOrigin+'/mcp',scopes:['flymind:read','flymind:write'],clientId:'ui-probe'}})
 if(!user)return reply(401,{})
 const team={id:'team-a',name:'协同测试团队',role:'editor'}
 if(req.url==='/app/flymind/auth/me')return reply(200,{user:{id:user,name:user},expiresAt:Date.now()+3600000,teams:[team]})
 if(req.url==='/app/flymind/session/introspect'&&body.teamId==='team-a')return reply(200,{user:{id:user,name:user},session:{id:'session-'+user,expiresAt:Date.now()+3600000},team})
 return reply(404,{})
})
let server=createServer(),cloud,owned
async function listen(server,port=0){await new Promise(r=>server.listen(port,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port}
async function stop(server){server.closeAllConnections();await new Promise(r=>server.close(r))}
const content={schemaVersion:1,id:'live-ui',title:'多人画布集成',kind:'flowchart',nodes:[{id:'a',kind:'start',label:'核对材料'},{id:'b',kind:'task',label:'确认交付'},{id:'c',kind:'end',label:'完成交付'}],edges:[{id:'ab',source:'a',target:'b'},{id:'bc',source:'b',target:'c'}],lanes:[],phases:[],groups:[]}
try{
 await mkdir(output,{recursive:true});const controlPlaneURL=await listen(authority),origin=await listen(server)
 publicOrigin=origin;cloud=createCloudHTTP({controlPlaneURL,publicOrigin:origin,cloudDataRoot:join(root,'data'),allowInsecureLoopback:true,gatewayKey,collaborationIntervalMs:150});server.on('request',cloud.app)
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
  // First-visit onboarding must be dismissible before the existing canvas checks.
  await page.getByRole('button',{name:'关闭引导',exact:true}).click()
  c.xml=async()=>{const key=name+':probe:'+(++c.sequence);return page.evaluate(async key=>await new Promise((yes,no)=>{const frame=document.querySelector('iframe.drawio-host:not(.drawio-host-pending)'),timer=setTimeout(()=>{removeEventListener('message',receive);no(Error('capture timeout'))},10000);function receive(e){if(e.origin!==location.origin||e.source!==frame.contentWindow||typeof e.data!=='string')return;const value=JSON.parse(e.data);if(value.event==='export'&&value.message?.message===key){clearTimeout(timer);removeEventListener('message',receive);yes(value.xml)}}addEventListener('message',receive);frame.contentWindow.postMessage(JSON.stringify({action:'export',format:'xml',message:key}),location.origin)}),key)}
  c.beginLabel=async before=>{await c.frame().getByText(before,{exact:true}).first().dblclick();const editor=c.frame().locator('.mxCellEditor:visible').first();await editor.waitFor();assert.ok(await editor.isVisible(),'native text editor must be open before concurrent work')}
  c.finishLabel=async after=>{const editor=c.frame().locator('.mxCellEditor:visible').first();assert.ok(await editor.isVisible(),'native text editor must remain open before input');await page.keyboard.press('Control+a');await page.keyboard.insertText(after);await page.keyboard.press('Control+Enter');await editor.waitFor({state:'hidden'})}
  c.label=async(before,after)=>{await c.beginLabel(before);await c.finishLabel(after)}
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
 await b.label('甲在线修改','乙后续核对');await a.labelPresent('乙后续核对');await Promise.all(clients.map(c=>c.page.locator('[data-status="ready"]').waitFor({timeout:20000})))
 await a.page.getByRole('button',{name:'撤销',exact:true}).click();await a.page.getByRole('alert').filter({hasText:'这次撤销会覆盖其他成员'}).waitFor();await a.labelPresent('乙后续核对');await b.labelPresent('乙后续核对')
 await a.label('乙后续核对','甲最后修改');await b.labelPresent('甲最后修改');await a.page.locator('[data-status="ready"]').waitFor({timeout:20000});await a.frame().getByText('甲最后修改',{exact:true}).first().click();await a.page.keyboard.press('Control+z');await Promise.all([a.labelPresent('乙后续核对'),b.labelPresent('乙后续核对')]);assert.ok(sameNativeState(await a.xml(),await b.xml()))
 report.cases.push({name:'older-undo-cannot-overwrite-peer-later-edit',passed:true})
 mcpClient=new Client({name:'v11-ui-probe',version:'1.0.0'});await mcpClient.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+mcpToken}}}))
 await a.beginLabel('乙后续核对')
 const beforeAI=await cloud.workspaces.run(tokens.alice,'team-a','diagram:read',workspace=>workspace.diagrams.get(content.id))
 const [,aiResult]=await Promise.all([a.finishLabel('甲继续核对'),mcpClient.callTool({name:'patch_diagram',arguments:{id:content.id,expectedRevision:beforeAI.revision,requestId:'ai-concurrent',editIntent:'wording',operations:[{op:'update_node',id:'b',changes:{label:'AI确认交付'}}]}})])
 assert.ok(!aiResult.isError,JSON.stringify(aiResult));assert.equal(aiResult.structuredContent.exportStatus,'succeeded');assert.ok(aiResult.content.some(c=>c.type==='image'))
 await Promise.all([a.labelPresent('AI确认交付'),b.labelPresent('AI确认交付'),a.labelPresent('甲继续核对'),b.labelPresent('甲继续核对')]);report.cases.push({name:'two-browsers-and-real-MCP-edit-converge-with-PNG',passed:true})
 await Promise.all(clients.map(c=>c.page.locator('[data-status="ready"]').waitFor({timeout:20000})));await b.context.setOffline(true);await b.label('AI确认交付','乙维护草稿');await a.label('甲继续核对','甲维护前修改');await a.page.locator('[data-status="ready"]').waitFor({timeout:20000})
 await mcpClient.close();mcpClient=undefined;await cloud.quiesce({timeoutMs:5000});await cloud.close();await stop(server);server=createServer();assert.equal(await listen(server,+new URL(origin).port),origin)
 cloud=createCloudHTTP({controlPlaneURL,publicOrigin:origin,cloudDataRoot:join(root,'data'),allowInsecureLoopback:true,gatewayKey,collaborationIntervalMs:150});server.on('request',cloud.app);await b.context.setOffline(false)
 await Promise.all([a.labelPresent('乙维护草稿'),b.labelPresent('甲维护前修改')]);await Promise.all(clients.map(c=>c.page.locator('[data-status="ready"]').waitFor({timeout:20000})));assert.ok(sameNativeState(await a.xml(),await b.xml()));assert.deepEqual(await Promise.all(clients.map(c=>c.page.evaluate(()=>window.nativeEvents.filter(e=>e.event==='load').length))),[1,1]);report.cases.push({name:'application-drain-restart-keeps-live-canvas-and-offline-draft',passed:true})
 const source=await cloud.workspaces.run(tokens.alice,'team-a','diagram:read',workspace=>workspace.diagrams.getDrawing(content.id))
 await a.page.getByRole('button',{name:'导入图形',exact:true}).click()
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
 // A real webkitdirectory selection plus one lost successful server response.
 const directory=join(root,'chosen');await mkdir(join(directory,'nested'),{recursive:true});await writeFile(join(directory,'nested','valid.json'),JSON.stringify({...content,id:'directory-source',title:'目录导入'}));await writeFile(join(directory,'broken.json'),'{broken')
 await a.page.getByRole('button',{name:'工作区菜单：新建分组、导入、排序',exact:true}).click();await a.page.getByRole('button',{name:'导入图形',exact:true}).click();await dialog.locator('input[webkitdirectory]').setInputFiles(directory);await dialog.getByRole('button',{name:'导入',exact:true}).waitFor();await dialog.getByText('可导入',{exact:true}).waitFor()
 let lost=false,commits=[];await a.page.route('**/native/imports/items',async route=>{commits.push(route.request().postDataJSON());if(!lost){lost=true;await route.fetch();await route.abort('failed')}else await route.continue()})
 await dialog.getByRole('button',{name:'导入',exact:true}).click();await dialog.getByText('结果待确认，可重试',{exact:true}).waitFor();await dialog.getByRole('button',{name:'重试未完成项',exact:true}).click();await dialog.getByRole('status').filter({hasText:'已导入 1 张'}).waitFor();await a.page.unroute('**/native/imports/items');assert.equal(commits.length,2);assert.deepEqual(commits[0],commits[1]);await dialog.getByRole('button',{name:'关闭导入',exact:true}).click()
 const afterDirectory=await cloud.workspaces.run(tokens.alice,'team-a','workspace:read',async workspace=>({files:await workspace.diagrams.list(),activity:await workspace.store.listActivity({},workspace.dataRootId)}));assert.equal(afterDirectory.files.length,3);assert.equal(afterDirectory.activity.items.filter(e=>e.action==='import').length,2)
 report.cases.push({name:'actual-directory-partial-invalid-and-lost-ACK-exact-retry',passed:true})
 assert.ok(afterImport.activity.items.some(e=>e.actor.userId==='alice'&&e.actor.channel==='web'));assert.ok(afterImport.activity.items.some(e=>e.actor.userId==='bob'&&e.actor.channel==='web'))
 await a.page.getByRole('button',{name:'工作区菜单：新建分组、导入、排序',exact:true}).click();await a.page.getByRole('button',{name:'操作记录',exact:true}).click();const activity=a.page.getByRole('dialog',{name:'操作记录',exact:true});await activity.locator('article').first().waitFor();assert.ok((await activity.innerText()).includes('alice'));await activity.getByRole('button',{name:'关闭操作记录',exact:true}).click()
 report.cases.push({name:'trusted-actors-and-real-activity-dialog',passed:true})
 await a.page.screenshot({path:join(output,'alice.png')});await b.page.screenshot({path:join(output,'bob.png')})
 await b.context.setOffline(true);await b.label('乙维护草稿','乙冲突草稿');await b.labelPresent('乙冲突草稿');await b.page.locator('[data-status="offline"]').waitFor({timeout:20000})
 const aCommitted=a.page.waitForResponse(response=>response.status()===200&&response.request().method()==='POST'&&new URL(response.url()).pathname==='/cloud-api/teams/team-a/studio-api/native/collaboration/live-ui/commit'&&response.request().postDataJSON()?.xml?.includes('甲确认结果'))
 await a.label('乙维护草稿','甲确认结果');await aCommitted
 const beforeConflict=await cloud.workspaces.run(tokens.alice,'team-a','diagram:read',workspace=>workspace.diagrams.get(content.id));assert.equal(beforeConflict.document.content.nodes.find(n=>n.id==='b').label,'甲确认结果')
 await b.context.setOffline(false);await b.page.locator('[data-status="conflict"]').waitFor({timeout:20000});await b.labelPresent('乙冲突草稿');await a.labelPresent('甲确认结果')
 const [download]=await Promise.all([b.page.waitForEvent('download'),b.page.getByRole('button',{name:'下载恢复数据',exact:true}).click()]);const recovery=await (await import('node:fs/promises')).readFile(await download.path(),'utf8');assert.ok(recovery.includes('乙冲突草稿'));b.page.once('dialog',dialog=>dialog.accept());await b.page.getByRole('button',{name:'载入最新',exact:true}).click();await b.page.waitForFunction(()=>document.querySelectorAll('iframe.drawio-host').length===1&&window.nativeEvents.filter(e=>e.event==='load').length>=2);await b.page.locator('[data-status=ready]').waitFor();await b.labelPresent('甲确认结果');report.cases.push({name:'same-field-conflict-preserves-downloadable-draft-and-explicit-reload',passed:true})
 await b.context.setOffline(true);await b.label('甲确认结果','乙删除冲突草稿');await b.labelPresent('乙删除冲突草稿');await b.page.locator('[data-status="offline"]').waitFor({timeout:20000});const current=await cloud.workspaces.run(tokens.alice,'team-a','diagram:read',workspace=>workspace.diagrams.get(content.id));const deleted=await a.context.request.delete(origin+'/cloud-api/teams/team-a/studio-api/native/diagrams/'+content.id+'?revision='+current.revision,{headers:{Origin:origin,'X-FlyMind-User-Id':'alice','X-FlyMind-DataRoot-Id':await cloud.workspaces.run(tokens.alice,'team-a','workspace:read',async workspace=>workspace.dataRootId)}});assert.equal(deleted.status(),200,await deleted.text());await b.context.setOffline(false);await b.page.getByRole('status').filter({hasText:'图形已删除，草稿已保留'}).waitFor({timeout:20000});await b.labelPresent('乙删除冲突草稿');assert.ok(!(await cloud.workspaces.run(tokens.alice,'team-a','workspace:read',workspace=>workspace.diagrams.list())).some(row=>row.id===content.id))
 const [deletedDraftDownload]=await Promise.all([b.page.waitForEvent('download'),b.page.getByRole('button',{name:'下载恢复数据',exact:true}).click()]);const deletedDraft=await (await import('node:fs/promises')).readFile(await deletedDraftDownload.path(),'utf8');assert.ok(deletedDraft.includes('乙删除冲突草稿'));report.cases.push({name:'remote-delete-keeps-unsaved-draft-without-resurrection',description:'remote deletion signaled, unconfirmed local draft recoverable, no resurrection',passed:true})
 report.ok=true
}catch(error){report.error=error.stack;process.exitCode=1;for(const c of clients){await c.page.screenshot({path:join(output,'failure-'+c.name+'.png')}).catch(()=>{});await writeFile(join(output,c.name+'-body.txt'),await c.page.locator('body').innerText().catch(()=>''));await writeFile(join(output,c.name+'-events.json'),JSON.stringify(await c.page.evaluate(()=>window.nativeEvents).catch(()=>[])))}}
finally{
 await mcpClient?.close().catch(()=>{});for(const c of clients)await c.context.close().catch(()=>{});await owned?.close();if(cloud)await cloud.close();await stop(server);await stop(authority)
 assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-v11-ui-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})
 report.finishedAt=new Date().toISOString();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:report.ok,cases:report.cases,error:report.error,output},null,2))
}
