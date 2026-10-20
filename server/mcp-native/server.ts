import {McpServer,ResourceTemplate} from '@modelcontextprotocol/sdk/server/mcp.js'
import {z} from 'zod'
import {McpError} from '@modelcontextprotocol/sdk/types.js'
import {createHash,randomUUID} from 'node:crypto'
import type {NativeRuntimeConnection} from '../runtime-instance/types'
import type {NativeExportJob,NativeExportFormat} from '../exports/types'
import {EXPORT_FORMATS} from '../exports/types'
import {inspectDrawing} from '../../src/drawing/core/drawing-quality'
import {sampleFor} from '../../src/drawing/core/samples'
import {extractContent} from '../../src/drawing/core/layers'
import {VERSION} from '../version'
import {readAnnotations,createAnnotations,editAnnotations,editIntent,groupOutput,groupsOutput,successOutput} from '../contracts'
import {diagramId as id,diagramKind,revision,requestId,nativeContentSchema,operationSchema,renderingChangesSchema,nativeDiagramOutput,nativeListOutput,nativeValidationOutput,nativeRenderingOutput,nativeGuideOutput,nativeTrashOutput} from './contracts'
import {drawioCapabilities} from '../../src/drawing/engine/profiles'
import {nativeGuide,guideData} from './guide'
import {drawingStandard} from '../drawing-guide'

class ApiError extends Error {constructor(readonly status:number,readonly code:string,message:string,readonly details:Record<string,unknown>={}){super(message)}}
const json=(data:any)=>({content:[{type:'text' as const,text:JSON.stringify(data)}],structuredContent:data})
const mime=(format:string)=>format==='png'?'image/png':format==='svg'?'image/svg+xml':format.endsWith('json')?'application/json':'application/xml'
const exportKey=(...values:unknown[])=>'mcp_'+createHash('sha256').update(JSON.stringify(values)).digest('hex')
export const MCP_INLINE_LIMIT=8*1024*1024
const jsonBytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value),'utf8')
// Reserve JSON escaping/base64 overhead before advertising a resource link.
const inlineReadable=(format:string,bytes:number)=>bytes*(format==='png'?4/3:6)+4096<=MCP_INLINE_LIMIT
export function createNativeMcpServer(connect:()=>Promise<NativeRuntimeConnection>,options:{waitMs?:number;pollMs?:number;editorURL?:(diagramId:string,connection:NativeRuntimeConnection)=>string;remoteApplication?:boolean;resourceURL?:(path:string)=>string}={}){
 const server=new McpServer({name:'flymind',version:VERSION},{instructions:options.remoteApplication?'先读取get_drawing_guide获取当前应用规则。内容不含坐标；修改前读最新revision，稳定requestId重试，冲突不覆盖人工修改。':nativeGuide})
 let connection:Promise<NativeRuntimeConnection>|undefined,boundDataRootId:string|undefined
 function conn():Promise<NativeRuntimeConnection>{
  if(connection)return connection
  const pending=Promise.resolve().then(connect).then(async value=>{
   if(boundDataRootId!==undefined&&value.dataRootId!==boundDataRootId){await value.close().catch(()=>{});throw new ApiError(409,'WORKSPACE_MISMATCH','工作区身份已改变；本MCP会话不会自动改绑或重放写入')}
   boundDataRootId??=value.dataRootId
   return value
  }).catch(error=>{if(connection===pending)connection=undefined;throw error})
  connection=pending;return pending
 }
 async function invalidate(pending:Promise<NativeRuntimeConnection>,value:NativeRuntimeConnection){
  // A late failure from an old request must never clear a newer connection.
  if(connection===pending)connection=undefined
  await value.close().catch(()=>{})
 }
 async function request<T>(path:string,init:RequestInit,consume:(response:Response)=>Promise<T>):Promise<T>{
  const pending=conn(),value=await pending
  try{
   const response=await value.authenticatedFetch(path,init)
   if(response.status===401){
    let denied:any;try{denied=await response.clone().json()}catch{/* A transport denial may have no JSON body. */}
    if(denied?.code==='LOCAL_LOGIN_REQUIRED')throw new ApiError(401,'LOCAL_LOGIN_REQUIRED','请在本机执行 flymind login，并在浏览器完成账号授权；不要向 AI 提供密码。授权后沿用原 requestId 与相同内容重试。')
    await invalidate(pending,value);throw new ApiError(401,'RUNTIME_UNAUTHORIZED','Runtime会话已失效；请沿用原requestId及完全相同payload重试，本次未自动重放')
   }
   return await consume(response)
  }catch(error){
   if(error instanceof ApiError||error instanceof McpError)throw error
   await invalidate(pending,value)
   throw new ApiError(503,'RUNTIME_CONNECTION_LOST','Runtime连接中断，写入结果可能未确认；请沿用原requestId及完全相同payload重试，本次未自动重放')
  }
 }
 async function api(path:string,method='GET',body?:unknown){return request('/studio-api/native'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})},async response=>{let value:any;try{value=await response.json()}catch(error){if(error instanceof SyntaxError)throw new ApiError(response.status,'INVALID_RUNTIME_RESPONSE','Runtime 返回无效 JSON');throw error}if(!response.ok){const {error,...details}=value;throw new ApiError(response.status,value.code??'RUNTIME_ERROR',typeof error==='string'?error:'Runtime 请求失败',details)}return value})}
 const wrap=(fn:()=>Promise<any>)=>fn().catch(error=>{const e=error as any;return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:{...e.details,status:e.status??500,code:e.code??'RUNTIME_UNAVAILABLE',message:e.message}})}]}})
 async function metadata(record:any){const c=await conn(),document=record.document,content=document?.content??record.content,canvas=(document?.mode??record.mode)==='canvas-only',identity=canvas?(document??record):content;if(options.remoteApplication&&!canvas&&!record.quality)throw new ApiError(503,'APPLICATION_QUALITY_MISSING','应用响应缺少同发布的内容质量结果');return {diagramId:identity.id,title:identity.title,...(canvas?{mode:'canvas-only'}:{kind:content.kind}),format:record.format??3,revision:record.revision,createdAt:record.createdAt??document.createdAt,updatedAt:document?.updatedAt??record.updatedAt,workspaceGroupId:record.workspaceGroupId??null,...((record.format??3)===3?{editorUrl:options.editorURL?.(identity.id,c)??c.baseURL+'/#/native?diagram='+encodeURIComponent(identity.id)}:{}),readOnly:record.format===2,syncStatus:canvas?'canvas-only':record.syncStatus??'synced',...(!canvas?{quality:record.quality??inspectDrawing(content)}:{})}}

 async function result(record:any,preview=false,key?:string,saved=false,exportOptions?:unknown,retryJobId?:string,resumeJobId?:string){
  const meta=await metadata(record),content=record.document?.content??record.content
  let data:any={...meta,...(content!==undefined?{content}:{}),saved,exportStatus:'not_requested'}
  if(!preview)return json(data)
  if(meta.format!==3)throw new ApiError(422,'NATIVE_FORMAT_UNSUPPORTED','未迁移 v2 为只读，不使用旧渲染器冒充原生预览')
  let job:NativeExportJob|undefined
  const keyValue=key??randomUUID(),retry={path:`/studio-api/native/diagrams/${meta.diagramId}/exports/snapshot`,requestId:exportKey('snapshot',meta.diagramId,meta.revision,keyValue)}
  try{
   job=resumeJobId?await api(`/exports/${resumeJobId}`):retryJobId?await api(`/exports/${retryJobId}/retry`,'POST',{requestId:exportKey('retry',retryJobId,keyValue)}):await api(`/diagrams/${meta.diagramId}/exports/snapshot`,'POST',{revision:meta.revision,requestId:retry.requestId,...(exportOptions===undefined?{}:{options:exportOptions})})
   if(job!.diagramId!==meta.diagramId||job!.revision!==meta.revision||(job!.dataRootId!==(await conn()).dataRootId))throw new ApiError(409,'EXPORT_SNAPSHOT_MISMATCH','导出任务与指定快照不符')
   const deadline=Date.now()+(options.waitMs??25000)
   while(job!.status==='queued'||job!.status==='running'){if(Date.now()>=deadline)break;await new Promise(resolve=>setTimeout(resolve,options.pollMs??100));job=await api(`/exports/${job!.id}`)}
   const current=await api(`/records/${meta.diagramId}`)
   data={...data,currentRevision:current.revision,isCurrentRevision:current.revision===meta.revision,jobId:job!.id,exportStatus:job!.status,exportRetry:{jobId:job!.id,path:`/studio-api/native/exports/${job!.id}/retry`}}
   if(job!.status==='failed')return json({...data,exportError:job!.error})
   if(job!.status!=='succeeded')return json({...data,exportStatus:'waiting_timeout'})
   const c=await conn(),delivery=await api(`/exports/${job!.id}/delivery`)
   if(delivery.jobId!==job!.id||delivery.diagramId!==meta.diagramId||delivery.revision!==meta.revision||delivery.dataRootId!==c.dataRootId)throw new ApiError(409,'EXPORT_SNAPSHOT_MISMATCH','交付路径与任务身份不符')
   const formats=EXPORT_FORMATS.filter(f=>!!job!.files?.[f])
   const urls=Object.fromEntries(formats.map(f=>[f,options.resourceURL?options.resourceURL(`/studio-api/native/exports/${id.parse(job!.id)}/files/${f}`):c.baseURL+job!.files![f]!.url])),resources=Object.fromEntries(formats.map(f=>[f,`flymind://exports/${meta.diagramId}/${meta.revision}/${job!.id}/${f}`]))
   const png=await request(`/studio-api/native/exports/${job!.id}/files/png`,{},async response=>{if(!response.ok)throw new ApiError(response.status,'EXPORT_ARTIFACT_UNAVAILABLE','PNG 无法读取');return Buffer.from(await response.arrayBuffer())})
   if(png.length<24||png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||png.readUInt32BE(16)!==job!.width||png.readUInt32BE(20)!==job!.height)throw new ApiError(500,'EXPORT_PNG_INVALID','PNG 签名或尺寸不符')
   data={...data,files:options.remoteApplication?urls:delivery.files,urls,resources,exportedAt:job!.exportedAt,width:job!.width,height:job!.height,resourceLimits:Object.fromEntries(formats.map(f=>[f,{bytes:job!.files![f]!.bytes,maxInlineBytes:MCP_INLINE_LIMIT,readable:inlineReadable(f,job!.files![f]!.bytes)}])),previewStatus:'inline'}
   const links=formats.filter(f=>f!=='png'&&inlineReadable(f,job!.files![f]!.bytes)).map(f=>({type:'resource_link' as const,uri:resources[f],name:options.remoteApplication?`${job!.id}.${f}`:job!.files![f]!.filename,mimeType:mime(f),size:job!.files![f]!.bytes}))
   const responseValue={...json(data),content:[...json(data).content,{type:'image' as const,mimeType:'image/png',data:png.toString('base64')},...links]}
   if(jsonBytes(responseValue)+4096<=MCP_INLINE_LIMIT)return responseValue
   return json({...data,previewStatus:'too_large',previewError:{code:'MCP_PREVIEW_TOO_LARGE',message:'PNG预览超过安全STDIO预算；导出已成功，请使用files.png或认证下载，不重新创建'}})
  }catch(error){const e=error as any;if(!saved)throw error;return json({...data,exportStatus:job?.status==='failed'?'failed':'unavailable',...(job?{jobId:job.id}:{}),exportRetry:job?{jobId:job.id,path:`/studio-api/native/exports/${job.id}/retry`}:retry,exportError:{code:e.code??'EXPORT_UNAVAILABLE',message:e.message}})}
 }
 async function currentGuide(kind?:z.infer<typeof diagramKind>){return options.remoteApplication?nativeGuideOutput.parse(await api('/guide'+(kind?'?kind='+encodeURIComponent(kind):''))):{...guideData,guide:nativeGuide+'\n\n'+await drawingStandard(),...(kind?{sample:extractContent(sampleFor(kind))}:{})}}
 server.registerTool('get_drawing_guide',{description:'正式内容标准及原生profile实际支持能力；以能力表为准。',inputSchema:{kind:diagramKind.optional()},outputSchema:nativeGuideOutput,annotations:readAnnotations},({kind})=>wrap(async()=>{if(!options.remoteApplication&&kind&&!drawioCapabilities().supportedKinds.includes(kind))throw new ApiError(422,'NATIVE_KIND_UNSUPPORTED','此类型尚未适配，见实际能力表');return json(await currentGuide(kind))}))
 server.registerTool('list_diagrams',{description:'同库 mixed 列表；v2只读未迁移。',inputSchema:{sortBy:z.enum(['updated','created']).default('updated'),workspaceGroupId:id.nullable().optional()},outputSchema:nativeListOutput,annotations:readAnnotations},args=>wrap(async()=>{const records=await api('/records');const diagrams=await Promise.all(records.filter((r:any)=>args.workspaceGroupId===undefined||(r.workspaceGroupId??null)===args.workspaceGroupId).map(metadata));diagrams.sort((a,b)=>(args.sortBy==='created'?b.createdAt-a.createdAt:b.updatedAt-a.updatedAt)||a.diagramId.localeCompare(b.diagramId));return json({diagrams})}))
 server.registerTool('get_diagram',{description:'默认纯content/revision；preview等待该修订真实PNG。修改前读取。',inputSchema:{id,preview:z.boolean().default(false)},outputSchema:nativeDiagramOutput,annotations:readAnnotations},args=>wrap(async()=>result(await api(`/records/${args.id}`),args.preview)))
 server.registerTool('create_diagram',{description:'AI质量准入后创建；稳定requestId重试。保存成功而导出失败不会重建。',inputSchema:{content:nativeContentSchema,requestId,workspaceGroupId:id.optional()},outputSchema:nativeDiagramOutput,annotations:createAnnotations},args=>wrap(async()=>result(await api('/ai/diagrams','POST',args),true,args.requestId,true)))
 for(const [name,suffix,field,schema] of [['patch_diagram','content-patch','operations',z.array(operationSchema).min(1).max(500)],['update_diagram','content-update','content',nativeContentSchema]] as const){server.registerTool(name,{description:'原生语义修改，保留人工几何；最新expectedRevision与稳定requestId必需。不得新增或加重质量问题。',inputSchema:{id,expectedRevision:revision,requestId,editIntent,[field]:schema},outputSchema:nativeDiagramOutput,annotations:editAnnotations},args=>wrap(async()=>{const {id:diagram,...body}=args;return result(await api(`/ai/diagrams/${diagram}/${suffix}`,'POST',body),true,args.requestId,true)}))}
 server.registerTool('validate_diagram',{description:'真实引擎校验内容和业务质量；未渲染则不返回尺寸。',inputSchema:{content:nativeContentSchema},outputSchema:nativeValidationOutput,annotations:readAnnotations},args=>wrap(async()=>json(await api('/ai/validate','POST',args))))
 server.registerTool('get_rendering_config',{description:'读取真实原生profile/preferences及该类型实际渲染配置能力。',inputSchema:{id},outputSchema:nativeRenderingOutput,annotations:readAnnotations},args=>wrap(async()=>{const r=await api(`/diagrams/${args.id}/rendering`);return json({...await metadata(r.record),rendering:r.rendering,capabilities:r.capabilities})}))
 server.registerTool('configure_rendering',{description:'按profile实际支持字段修改XML渲染；内容不变，使用最新revision及稳定requestId，保存后导出同一修订。',inputSchema:{id,expectedRevision:revision,requestId,rendering:renderingChangesSchema},outputSchema:nativeDiagramOutput,annotations:editAnnotations},args=>wrap(async()=>{const {id:diagram,...body}=args;return result(await api(`/diagrams/${diagram}/rendering`,'POST',body),true,args.requestId,true)}))
 server.registerTool('export_diagram',{description:'导出指定修订五制品；失败可用retryJobId显式重试同一快照，不创建图。',inputSchema:{id,requestId,expectedRevision:revision.optional(),retryJobId:id.optional(),jobId:id.optional(),options:z.object({scale:z.number().min(.1).max(4).optional(),background:z.enum(['white','transparent']).optional()}).strict().optional()},outputSchema:nativeDiagramOutput,annotations:readAnnotations},args=>wrap(async()=>{if(args.retryJobId&&args.jobId)throw new ApiError(400,'EXPORT_RETRY_INVALID','jobId和retryJobId不能同时提供');const anchor=args.retryJobId??args.jobId,r=anchor?await api(`/exports/${anchor}/snapshot`):await api(`/records/${args.id}`);if(r.content.id!==args.id)throw new ApiError(404,'EXPORT_RESOURCE_MISMATCH','任务不属于指定图形');if(anchor&&args.options!==undefined)throw new ApiError(400,'EXPORT_RETRY_INVALID','重试沿用原任务options，不接受更改');if(args.expectedRevision!==undefined&&args.expectedRevision!==r.revision)throw new ApiError(409,'REVISION_CONFLICT','导出目标修订不符',{currentRevision:r.revision});return result(r,true,args.requestId,false,args.options,args.retryJobId,args.jobId)}))
 server.registerTool('list_deleted_diagrams',{description:'读取同库回收站，恢复前获取最新revision/deletedAt。',inputSchema:{},outputSchema:nativeTrashOutput,annotations:readAnnotations},()=>wrap(async()=>json(await api('/trash'))))
 server.registerTool('restore_diagram',{description:'仅用户要求时恢复，原生XML保留；v2恢复后仍只读。',inputSchema:{id,expectedRevision:revision,deletedAt:z.number().positive()},outputSchema:nativeDiagramOutput,annotations:editAnnotations},args=>wrap(async()=>{const {id:diagram,...body}=args;return result(await api(`/trash/${diagram}/restore`,'POST',body),false)}))
 server.registerTool('permanently_delete_diagram',{description:'仅用户明确要求永久删除时使用；不可恢复。',inputSchema:{id,expectedRevision:revision,deletedAt:z.number().positive()},outputSchema:successOutput,annotations:editAnnotations},args=>wrap(async()=>json(await api(`/trash/${args.id}?revision=${args.expectedRevision}&deletedAt=${args.deletedAt}`,'DELETE'))))
 server.registerTool('list_workspace_groups',{description:'读取同库工作区分组。',inputSchema:{},outputSchema:groupsOutput,annotations:readAnnotations},()=>wrap(async()=>json(await api('/groups'))))
 const name=z.string().trim().min(1).max(80)
 server.registerTool('create_workspace_group',{description:'创建同库列表分组。',inputSchema:{name},outputSchema:groupOutput,annotations:createAnnotations},args=>wrap(async()=>json(await api('/groups','POST',args))))
 server.registerTool('rename_workspace_group',{description:'以最新revision重命名分组。',inputSchema:{id,expectedRevision:revision,name},outputSchema:groupOutput,annotations:editAnnotations},args=>wrap(async()=>{const {id:group,...body}=args;return json(await api(`/groups/${group}`,'PUT',body))}))
 server.registerTool('delete_workspace_group',{description:'删除列表分组，图形保留。',inputSchema:{id,expectedRevision:revision},outputSchema:successOutput,annotations:editAnnotations},args=>wrap(async()=>json(await api(`/groups/${args.id}?revision=${args.expectedRevision}`,'DELETE'))))
 server.registerTool('move_diagram_to_group',{description:'仅改变列表归属，保留完整原生XML。',inputSchema:{id,workspaceGroupId:id.nullable(),expectedWorkspaceGroupId:id.nullable()},outputSchema:nativeDiagramOutput,annotations:editAnnotations},args=>wrap(async()=>{const {id:diagram,...body}=args;return result(await api(`/diagrams/${diagram}/group`,'PUT',body))}))
 server.registerResource('drawing-guide','flymind://guide',{mimeType:'text/markdown'},async uri=>({contents:[{uri:uri.href,mimeType:'text/markdown',text:options.remoteApplication?(await currentGuide()).guide:nativeGuide}]}))
 server.registerResource('drawing-standard','flymind://drawing-standard',{mimeType:'text/markdown'},async uri=>({contents:[{uri:uri.href,mimeType:'text/markdown',text:options.remoteApplication?(await currentGuide()).guide:await drawingStandard()}]}))
 server.registerResource('diagram',new ResourceTemplate('flymind://diagrams/{id}',{list:async()=>({resources:(await api('/records')).map((r:any)=>({uri:`flymind://diagrams/${r.content.id}`,name:r.content.title,mimeType:'application/json'}))})}),{mimeType:'application/json'},async(uri,args)=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify((await result(await api(`/records/${id.parse(String(args.id))}`))).structuredContent)}]}))
 server.registerResource('artifact',new ResourceTemplate('flymind://artifacts/{id}/{revision}/{format}',{list:undefined}),{},async()=>{throw new ApiError(422,'EXPORT_ID_REQUIRED','原生制品必须通过包含exportId的flymind://exports资源读取')})
 server.registerResource('export',new ResourceTemplate('flymind://exports/{id}/{revision}/{exportId}/{format}',{list:undefined}),{},async(uri,args)=>{
  const diagram=id.parse(String(args.id)),rev=revision.parse(Number(args.revision)),jobId=id.parse(String(args.exportId)),format=z.enum(EXPORT_FORMATS).parse(String(args.format)) as NativeExportFormat,c=await conn(),job:NativeExportJob=await api(`/exports/${jobId}`)
  if(job.diagramId!==diagram||job.revision!==rev||job.dataRootId!==c.dataRootId||job.status!=='succeeded')throw new ApiError(404,'EXPORT_RESOURCE_MISMATCH','资源不属于指定图形/修订/工作区或尚未成功')
  const bytes=await request(`/studio-api/native/exports/${jobId}/files/${format}`,{},async response=>{if(!response.ok)throw new ApiError(response.status,'EXPORT_ARTIFACT_UNAVAILABLE','制品不可读取');return Buffer.from(await response.arrayBuffer())}),value={contents:[format==='png'?{uri:uri.href,mimeType:mime(format),blob:bytes.toString('base64')}:{uri:uri.href,mimeType:mime(format),text:bytes.toString('utf8')}]}
  if(!inlineReadable(format,bytes.length)||jsonBytes(value)+4096>MCP_INLINE_LIMIT)throw new McpError(-32001,'MCP_RESOURCE_TOO_LARGE: 制品超过安全STDIO预算，请使用导出结果files或认证下载',{code:'MCP_RESOURCE_TOO_LARGE',format,bytes:bytes.length,maxInlineBytes:MCP_INLINE_LIMIT})
  return value
 })
 return {server,async close(){await server.close();if(connection)await(await connection).close()}}
}
