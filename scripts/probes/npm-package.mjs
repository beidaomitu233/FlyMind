// Independent production-tarball acceptance. No source imports or user workspace writes.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,stat,access} from 'node:fs/promises'
import {resolve,join,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
const arg=name=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1)
const packageRoot=resolve(arg('--package-root')||'INVALID'),profileRoot=resolve(arg('--profile-root')||'INVALID'),resourcesRoot=resolve(arg('--resources-root')||'INVALID'),out=resolve(arg('--output')||'output/npm-release/acceptance')
for(const key of ['--package-root','--profile-root','--resources-root'])assert.ok(arg(key),'Required '+key)
await mkdir(out,{recursive:true})
const require=createRequire(join(packageRoot,'package.json'))
const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href)
const {StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href)
const control=await import(pathToFileURL(join(packageRoot,'lib/server/runtime-instance/client.js')).href)
const dataRoot=join(profileRoot,'FlyMind/data'),privateRoot=join(profileRoot,'FlyMind/runtime')
const env={...process.env,LOCALAPPDATA:profileRoot,FLYMIND_RESOURCES_DIR:resourcesRoot}
for(const key of ['FLYMIND_NATIVE_PILOT','FLYMIND_DATA_DIR','FLYMIND_PRIVATE_RUNTIME_DIR','FLYMIND_PORT','NODE_OPTIONS','NODE_PATH'])delete env[key]
const options={projectRoot:packageRoot,dataRoot,privateRuntimeRoot:privateRoot,port:0,env:{...env,FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:dataRoot,FLYMIND_PRIVATE_RUNTIME_DIR:privateRoot,FLYMIND_PORT:'0'}}
const report={startedAt:new Date().toISOString(),packageRoot,profileRoot,resourcesRoot,checks:{},diagrams:[],stderr:''}
let client,connection
const exists=async file=>{try{await access(file);return true}catch{return false}}
async function connect(){
 const transport=new StdioClientTransport({command:process.execPath,args:[join(packageRoot,'bin/flymind.mjs')],cwd:profileRoot,env:Object.fromEntries(Object.entries(env).filter(([,v])=>typeof v==='string')),stderr:'pipe'})
 transport.stderr?.on('data',data=>report.stderr+=data.toString())
 client=new Client({name:'flymind-package-acceptance',version:'1.0.0'})
 await client.connect(transport)
}
async function call(name,args){const response=await client.callTool({name,arguments:args},undefined,{timeout:120000});assert.notEqual(response.isError,true,JSON.stringify(response));return response}
async function delivered(response,key){
 let data=response.structuredContent
 const deadline=Date.now()+90000
 while(data.exportStatus==='waiting_timeout'&&Date.now()<deadline){response=await call('export_diagram',{id:data.diagramId,jobId:data.jobId,requestId:'resume-'+key});data=response.structuredContent}
 assert.equal(data.exportStatus,'succeeded',JSON.stringify(data));assert.ok(response.content.some(v=>v.type==='image'))
 const digests={}
 for(const format of ['png','svg','drawio','json','project.json']){
  assert.ok(resolve(data.files[format]).startsWith(resolve(dataRoot)+sep),'delivery outside isolated data root')
  const bytes=await readFile(data.files[format]);assert.ok(bytes.length>0);digests[format]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}
  if(format==='png'){assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),data.width);assert.equal(bytes.readUInt32BE(20),data.height);await writeFile(join(out,key+'.png'),bytes)}
 }
 assert.ok(data.editorUrl.includes('/#/native?diagram='));const page=await fetch(data.editorUrl);assert.equal(page.status,200);assert.match(await page.text(),/<script[^>]+src="\/assets\//)
 return {...data,digests}
}
function content(kind){
 const c={schemaVersion:1,id:'package-'+kind,title:'安装验证 · '+kind,kind,nodes:[],edges:[],lanes:[],phases:[],groups:[]}
 if(kind==='flowchart'||kind==='swimlane'){
  c.nodes=[{id:'start',kind:'start',label:'接收申请'},{id:'task',kind:'task',label:'核对资料'},{id:'end',kind:'end',label:'完成受理'}];c.edges=[{id:'a',source:'start',target:'task'},{id:'b',source:'task',target:'end'}]
  if(kind==='swimlane'){c.lanes=[{id:'owner',label:'经办人员'}];c.phases=[{id:'work',label:'受理阶段'}];c.nodes.forEach(n=>{n.laneId='owner';n.phaseId='work'})}
 }else if(kind==='architecture'){c.groups=[{id:'app',label:'应用层'},{id:'service',label:'服务层'}];c.nodes=[{id:'entry',kind:'module',label:'申请入口',groupId:'app',items:['提交申请']},{id:'task',kind:'module',label:'审核服务',groupId:'service',items:['核对资料']}];c.edges=[{id:'call',source:'entry',target:'task',label:'审核请求'}]}
 else if(kind==='mindmap')c.nodes=[{id:'root',kind:'topic',label:'申请受理'},{id:'task',kind:'topic',label:'核对资料',parentId:'root'},{id:'deliver',kind:'topic',label:'结果交付',parentId:'root'}]
 else{c.nodes=[{id:'source',kind:'card',label:'申请数据',description:'接收申请数据'},{id:'task',kind:'card',label:'资料校验',description:'输出校验结果'},{id:'sink',kind:'card',label:'结果归档',description:'保存受理结果'}];c.edges=[{id:'a',source:'source',target:'task',label:'申请资料'},{id:'b',source:'task',target:'sink',label:'校验结果'}]}
 return c
}
try{
 assert.equal(await exists(join(packageRoot,'server/mcp.ts')),false);assert.equal(await exists(join(packageRoot,'src')),false)
 for(const dev of ['tsx','typescript','vite'])assert.throws(()=>require.resolve(dev),'development dependency must not resolve: '+dev)
 report.checks.noSourceOrDevDependencies=true
 await connect();assert.equal((await client.listTools()).tools.length,18)
 const guide=(await call('get_drawing_guide',{})).structuredContent;assert.equal(guide.capabilities.supportedKinds.length,5);assert.match(guide.guide,/绘图内容标准/)
 report.checks.stdioHandshakeAndDrawingRules=true
 const baseline=(await call('list_diagrams',{})).structuredContent.diagrams
 report.initialRecords=baseline.length
 for(const kind of ['flowchart','swimlane','architecture','mindmap','dataflow']){
  const data=await delivered(await call('create_diagram',{content:content(kind),requestId:'package-create-'+kind}),kind)
  assert.equal(data.revision,1);assert.equal(data.quality.passed,true)
  report.diagrams.push({id:data.diagramId,kind,revision:data.revision,createdAt:data.createdAt,updatedAt:data.updatedAt,editorUrl:data.editorUrl,digests:data.digests})
 }
 report.checks.fiveKindsRealPngAndFiveArtifacts=true
 connection=await control.ensureNativeRuntime(options);report.baseURL=connection.baseURL;report.instanceId=connection.instanceId
 const original=await call('get_diagram',{id:'package-flowchart'})
 const patched=await delivered(await call('patch_diagram',{id:'package-flowchart',expectedRevision:1,requestId:'package-wording',editIntent:'wording',operations:[{op:'update_node',id:'task',changes:{label:'复核资料'}}]}),'flowchart-patched')
 assert.equal(patched.revision,2);assert.equal(patched.createdAt,original.structuredContent.createdAt);assert.equal(patched.content.nodes.find(n=>n.id==='task').label,'复核资料')
 const replay=await delivered(await call('create_diagram',{content:content('flowchart'),requestId:'package-create-flowchart'}),'flowchart-replayed');assert.equal(replay.revision,1);assert.equal(replay.currentRevision,2)
 report.checks.aiPatchAndIdempotentReplay=true
 const group=(await call('create_workspace_group',{name:'安装验收分组'})).structuredContent
 const groupId=group.id??group.group?.id;assert.ok(groupId,JSON.stringify(group))
 await call('move_diagram_to_group',{id:'package-flowchart',workspaceGroupId:groupId,expectedWorkspaceGroupId:null})
 assert.equal((await call('list_diagrams',{workspaceGroupId:groupId})).structuredContent.diagrams.length,1)
 assert.equal((await call('list_diagrams',{workspaceGroupId:null})).structuredContent.diagrams.length,baseline.filter(row=>row.workspaceGroupId===null).length+4)
 report.checks.workspaceGroupExclusive=true
 await client.close();client=undefined;await connect()
 const after=(await call('list_diagrams',{})).structuredContent.diagrams;assert.equal(after.length,baseline.length+5)
 for(const row of report.diagrams){const current=after.find(d=>d.diagramId===row.id);assert.ok(current);assert.equal(current.createdAt,row.createdAt)}
 assert.equal((await call('get_diagram',{id:'package-flowchart'})).structuredContent.revision,2)
 const same=await control.ensureNativeRuntime(options);assert.equal(same.instanceId,connection.instanceId);await same.close()
 report.checks.reconnectPreservesDataAndInstance=true
 assert.ok((await stat(join(dataRoot,'flymind.sqlite'))).size>0)
 assert.ok(!dataRoot.startsWith(packageRoot+sep));report.checks.userDataOutsideInstallAndCache=true
 report.ok=true
}catch(error){report.ok=false;report.error=error.stack??String(error);process.exitCode=1}
finally{
 await client?.close().catch(()=>{})
 if(!connection){try{connection=await control.ensureNativeRuntime(options)}catch{}}
 if(connection&&!process.argv.includes('--keep-runtime'))await control.requestNativeRuntimeShutdown(connection).catch(error=>{report.shutdownError=error.message;report.ok=false;process.exitCode=1})
 if(connection)await connection.close()
 report.keptRuntime=Boolean(connection&&process.argv.includes('--keep-runtime'))
 await writeFile(join(out,'result.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify(report,null,2))
}
