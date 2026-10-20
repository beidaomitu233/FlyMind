// PM acceptance: actual STDIO MCP -> isolated Runtime -> draw.io PNG/artifacts.
import assert from 'node:assert/strict'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'
import sharp from 'sharp'
import {ensureNativeRuntime,requestNativeRuntimeShutdown} from '../../server/runtime-instance/client.ts'
import {DiagramStore} from '../../server/store.ts'
import {composeDocument} from '../../src/drawing/core/layers.ts'

const directory=await mkdtemp(join(tmpdir(),'flymind-quality-acceptance-')),dataRoot=join(directory,'data'),output=resolve('output/playwright/drawing-quality-acceptance')
const env={...process.env,FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:dataRoot,FLYMIND_PRIVATE_RUNTIME_DIR:join(directory,'private'),FLYMIND_PORT:'0'}
const options={env,dataRoot,privateRuntimeRoot:env.FLYMIND_PRIVATE_RUNTIME_DIR,port:0}
const content=(kind,id,title,nodes,edges=[],extra={})=>({schemaVersion:1,id,title,kind,nodes,edges,lanes:[],phases:[],groups:[],...extra})
const architecture=content('architecture','quality-gpu-architecture','双卡云 GPU 与内存缓存',[
 {id:'gateway',kind:'module',label:'网关与任务队列',groupId:'access',items:['并发准入','Token 预算','请求限流']},
 {id:'inference',kind:'module',label:'vLLM 推理服务',groupId:'inference-layer',items:['TP=2 单副本','INT8 权重','GPU 热缓存']},
 {id:'cache',kind:'module',label:'LMCache 内存缓存',groupId:'inference-layer',items:['CPU 缓存 64 GiB','前缀与多轮复用','LRU 淘汰']},
 {id:'gpu',kind:'module',label:'同机双卡资源',groupId:'resources',items:['2 × L20 48 GB','32 vCPU / 230 GiB']},
 {id:'storage',kind:'module',label:'持久化存储',groupId:'resources',items:['模型与数据盘','待处理任务与日志']}
],[{id:'admit',source:'gateway',target:'inference',label:'准入请求'},{id:'write',source:'inference',target:'cache',label:'缓存写入'},{id:'hit',source:'cache',target:'inference',label:'命中加载'}],{groups:[{id:'access',label:'接入与调度'},{id:'inference-layer',label:'推理与缓存'},{id:'resources',label:'云端计算与存储'}]})
const flow=content('flowchart','quality-request-flow','按请求条件选择推理通道',[
 {id:'start',kind:'start',label:'接收请求'},
 {id:'route',kind:'decision',label:'选择哪种推理通道？'},
 {id:'dual',kind:'task',label:'执行双卡推理',description:'严格精度的超长请求'},
 {id:'api',kind:'task',label:'调用云模型 API',description:'经授权的通用请求'},
 {id:'single',kind:'task',label:'执行单卡推理',description:'常规或定制任务'},
 {id:'result',kind:'task',label:'返回模型结果'},
 {id:'end',kind:'end',label:'请求结束'}
],[{id:'s-r',source:'start',target:'route'},{id:'r-d',source:'route',target:'dual',label:'严格精度超长任务'},{id:'r-a',source:'route',target:'api',label:'经授权通用任务'},{id:'r-s',source:'route',target:'single',label:'常规或定制任务'},...['dual','api','single'].map(id=>({id:id+'-result',source:id,target:'result'})),{id:'result-end',source:'result',target:'end'}])
const mindmap=content('mindmap','quality-deployment-options','三条低成本部署路径',[
 {id:'root',kind:'topic',label:'Qwen 部署方案'},
 {id:'cloud',kind:'topic',label:'云 GPU 自部署',parentId:'root'},
 {id:'private',kind:'topic',label:'企业内网自购',parentId:'root'},
 {id:'hybrid',kind:'topic',label:'MaaS + 云 GPU',parentId:'root'},
 {id:'cloud-hardware',kind:'topic',label:'同机双 L20 48 GB',parentId:'cloud'},
 {id:'cloud-concurrency',kind:'topic',label:'TP=2 / 常规 30 路',parentId:'cloud'},
 {id:'cloud-cost',kind:'topic',label:'Spot 月算例约 4705 元',parentId:'cloud'},
 {id:'private-hardware',kind:'topic',label:'双 A6000 48 GB',parentId:'private'},
 {id:'private-price',kind:'topic',label:'整机采购约 8 万元',parentId:'private'},
 {id:'private-running',kind:'topic',label:'月运行算例约 1501 元',parentId:'private'},
 {id:'hybrid-hardware',kind:'topic',label:'单 L20 + 云 API',parentId:'hybrid'},
 {id:'hybrid-price',kind:'topic',label:'月运行算例约 1889 元',parentId:'hybrid'},
 {id:'hybrid-routing',kind:'topic',label:'按权限与任务长度分流',parentId:'hybrid'}
])
const report={startedAt:new Date().toISOString(),scope:'synthetic engineering fixtures based on visible supplied diagrams; no current user database writes',negative:[],positive:[],checks:{}}
let connection,client,transport,stderr=''
async function call(name,args){return client.callTool({name,arguments:args})}
function data(result){if(result.isError)throw Error(JSON.stringify(result));return result.structuredContent}
async function toolError(name,args,code){const result=await call(name,args);assert.equal(result.isError,true,JSON.stringify(result));const value=JSON.parse(result.content.find(c=>c.type==='text').text).error;assert.equal(value.code,code);return value}
async function api(path){const r=await connection.authenticatedFetch('/studio-api/native'+path);assert.equal(r.ok,true);return r.json()}
try{
 await mkdir(output,{recursive:true});connection=await ensureNativeRuntime(options)
 transport=new StdioClientTransport({command:process.execPath,args:['server/start.mjs'],cwd:process.cwd(),env:Object.fromEntries(Object.entries(env).filter(([,value])=>typeof value==='string')),stderr:'pipe'})
 transport.stderr?.on('data',bytes=>stderr+=bytes);client=new Client({name:'quality-acceptance',version:'1'});await client.connect(transport)
 const guide=data(await call('get_drawing_guide',{}));assert.equal(guide.standardVersion,'1.1');report.checks.guideMatchesStandard=true
 const negatives=[
  {name:'architecture-with-decision',value:{...architecture,id:'reject-mixed',nodes:architecture.nodes.map((n,index)=>index===0?{...n,kind:'decision'}:n)},issue:'node_type'},
  {name:'components-as-process',value:content('flowchart','reject-components','组件协作误标流程', [{id:'a',kind:'task',label:'API网关'},{id:'b',kind:'task',label:'Redis'}],[{id:'ab',source:'a',target:'b'}]),issue:'component_as_task'},
  {name:'paragraph-in-description',value:{...flow,id:'reject-description',nodes:flow.nodes.map(n=>n.id==='dual'?{...n,description:'多个动作与方案说明'.repeat(30)}:n)},issue:'long_description'},
  {name:'items-bypass',value:{...flow,id:'reject-items',nodes:flow.nodes.map(n=>n.id==='dual'?{...n,items:['将解释塞到其他字段']}:n)},issue:'node_field_items'}
 ]
 for(const entry of negatives){
  const before=(await api('/records')).length,validation=data(await call('validate_diagram',{content:entry.value}));assert.equal(validation.valid,false);assert.ok(validation.quality.issues.some(i=>i.code===entry.issue))
  const error=await toolError('create_diagram',{content:entry.value,requestId:'create-'+entry.value.id},'QUALITY_FAILED');assert.ok(error.quality.issues.some(i=>i.code===entry.issue));assert.equal((await api('/records')).length,before)
  report.negative.push({name:entry.name,issue:entry.issue,valid:false,noWrite:true})
 }
 for(const value of [architecture,flow,mindmap]){
  const validated=data(await call('validate_diagram',{content:value}));assert.equal(validated.valid,true,JSON.stringify(validated))
  let created=data(await call('create_diagram',{content:value,requestId:'create-'+value.id}))
  if(created.exportStatus==='waiting_timeout')created=data(await call('export_diagram',{id:value.id,jobId:created.jobId,requestId:'resume-'+value.id}))
  assert.equal(created.exportStatus,'succeeded',JSON.stringify(created));assert.equal(created.revision,1);assert.ok(created.editorUrl.includes('/#/native?diagram='));assert.equal(created.quality.passed,true)
  const png=await readFile(created.files.png),meta=await sharp(png).metadata();assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(meta.width,created.width);assert.equal(meta.height,created.height)
  for(const [format,file] of Object.entries(created.files)){assert.ok(resolve(file).startsWith(resolve(dataRoot)+sep));await writeFile(join(output,value.kind+'.'+format),await readFile(file))}
  if(value.kind==='mindmap')assert.ok(meta.width/meta.height<3,'default mindmap must not produce the original very wide single leaf row')
  report.positive.push({kind:value.kind,revision:1,width:meta.width,height:meta.height,sha256:createHash('sha256').update(png).digest('hex'),files:Object.keys(created.files),orientation:(await api('/diagrams/'+value.id)).document.rendering.preferences.orientation})
 }
 const before=await api('/diagrams/'+flow.id)
 await toolError('patch_diagram',{id:flow.id,expectedRevision:1,requestId:'reject-patch',operations:[{op:'update_node',id:'dual',changes:{items:['注释充当步骤']}}]},'QUALITY_FAILED')
 await toolError('update_diagram',{id:flow.id,expectedRevision:1,requestId:'reject-update',content:{...flow,nodes:flow.nodes.map(n=>n.id==='dual'?{...n,label:'段落说明'.repeat(20)}:n)}},'QUALITY_FAILED')
 const after=await api('/diagrams/'+flow.id);assert.deepEqual(after,before);report.checks.patchAndUpdateRefusedWithoutChangingRevision=true
 const goodPatch=data(await call('patch_diagram',{id:flow.id,expectedRevision:1,requestId:'good-patch',editIntent:'wording',operations:[{op:'update_node',id:'dual',changes:{label:'运行双卡推理'}}]}));assert.equal(goodPatch.revision,2)
 const reread=data(await call('get_diagram',{id:flow.id}));assert.equal(reread.content.nodes.find(n=>n.id==='dual').label,'运行双卡推理');assert.equal(reread.content.nodes.find(n=>n.id==='dual').description,'严格精度的超长请求');report.checks.legitimatePatchAndPropertyRoundtrip=true
 // The current older Codex registration still selects the compatibility MCP.
 // Its quality gate must be the same policy; don't migrate its real database.
 await client.close();await transport.close();client=undefined;transport=undefined
 const legacyRoot=join(directory,'legacy'),legacyStore=new DiagramStore(legacyRoot);await legacyStore.init();await legacyStore.create(composeDocument(flow))
 const legacyEnv={...env,FLYMIND_NATIVE_PILOT:'0',FLYMIND_DATA_DIR:legacyRoot,FLYMIND_AUTO_WEB:'0'}
 transport=new StdioClientTransport({command:process.execPath,args:['server/start.mjs'],cwd:process.cwd(),env:Object.fromEntries(Object.entries(legacyEnv).filter(([,value])=>typeof value==='string')),stderr:'pipe'})
 transport.stderr?.on('data',bytes=>stderr+=bytes);client=new Client({name:'quality-legacy-acceptance',version:'1'});await client.connect(transport)
 assert.equal(data(await call('get_drawing_guide',{})).standardVersion,'1.1')
 for(const entry of negatives){const validation=data(await call('validate_diagram',{content:entry.value}));assert.equal(validation.valid,false);await toolError('create_diagram',{content:entry.value},'QUALITY_FAILED')}
 await toolError('patch_diagram',{id:flow.id,expectedRevision:1,operations:[{op:'update_node',id:'dual',changes:{items:['转移说明绕过']}}]},'QUALITY_FAILED')
 assert.equal((await legacyStore.get(flow.id)).revision,1);report.checks.compatibilityMcpHasSameQualityGatesWithoutUserDataMigration=true
 report.ok=true
}catch(error){report.error=error.stack;process.exitCode=1}
finally{
 await client?.close().catch(()=>{});await transport?.close().catch(()=>{});if(connection){await requestNativeRuntimeShutdown(connection).catch(error=>report.cleanupError=error.message);await connection.close()}
 await mkdir(output,{recursive:true});await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await writeFile(join(output,'stderr.log'),stderr)
 if(!report.cleanupError){assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep)&&directory.includes('flymind-quality-acceptance-'));await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
 console.log(JSON.stringify({ok:report.ok,negative:report.negative,positive:report.positive,checks:report.checks,error:report.error,cleanupError:report.cleanupError,output}))
}
