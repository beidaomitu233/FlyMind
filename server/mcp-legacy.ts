import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { DiagramStore, StoreError, PROJECT_ROOT, type DiagramRecord } from './store'
import { renderArtifacts,readExportFile } from './artifacts'
import { sampleFor } from '../src/drawing/core/samples'
import { extractContent,composeDocument,replaceContent,applyContentOperations,replaceRendering } from '../src/drawing/core/layers'
import { standardNodePresets,nodePreset,edgePreset } from '../src/drawing/core/render-config'
import { diagramKind,diagramId,revision,contentSchema,operationSchema,renderingSchema,diagramOutput,guideOutput,listOutput,renderingOutput,validationOutput,readAnnotations,createAnnotations,editAnnotations } from './contracts'
import { VERSION } from './version'
import {drawingGuide,drawingStandard} from './drawing-guide'
import {inspectDrawing,requireDrawingQuality,DrawingQualityError} from '../src/drawing/core/drawing-quality'
import {editIntent} from './contracts'
import { groupOutput,groupsOutput,successOutput,trashOutput } from './contracts'
import { byCreationNewest,byModifiedNewest } from '../src/drawing/core/metadata'
const store=new DiagramStore();await store.init()
const server=new McpServer({name:'flymind',version:VERSION},{instructions:'FlyMind 为 AI 提供五类绘图。先 get_drawing_guide 获取技术规则与绘图内容标准 1.0；创建和修改必须通过内容质量检查，判断出口要齐全，节点只写简短动作/概念，不用解释段落充当步骤。修改流程必须真正修改业务节点或关系，禁止仅补说明交差。create_diagram 返回图片及编辑链接。修改前 get_diagram，使用最新 revision 调用 patch_diagram 或 update_diagram；绝不覆盖版本冲突。用户二次编辑后重新读取。内容层只包含业务信息和关系，可选 color；不要在内容里放 order、坐标、尺寸、形状、图标、字体、线型或 presentation。泳道图普通边表示先后，跨角色同样推进；独立分支分别连出、汇合分别接入；退回/驳回/重试边显式 kind=feedback。无需为排版补写节点 description，业务关系不清时先确认。渲染器自动美化，仅在用户要求时使用 get_rendering_config / configure_rendering。独立说明使用 kind=note，不参与主图布局，无需填写归属或坐标。回收站恢复先 list_deleted_diagrams，再用最新 revision/deletedAt；永久删除仅在用户明确要求时执行。最终给用户 PNG 预览、SVG/JSON 下载与 editorUrl。'})
const kinds=diagramKind,id=diagramId
const base=`http://127.0.0.1:${process.env.FLYMIND_PORT||5179}`
const editorUrl=(id:string)=>`${process.env.FLYMIND_EDITOR_URL||base}/#/?diagram=${encodeURIComponent(id)}`
let runtime:Promise<void>|undefined
async function ensureRuntime(){
  if(runtime)return runtime
  runtime=(async()=>{try{const r=await fetch(base+'/studio-api/health');if(r.ok&&((await r.json()).storage==='sqlite'))return}catch{}
    if(process.env.FLYMIND_AUTO_WEB==='0')return
    const child=spawn(process.execPath,[join(PROJECT_ROOT,'server/start.mjs'),'--runtime'],{cwd:PROJECT_ROOT,env:process.env,stdio:'ignore',detached:true,windowsHide:true});child.unref()
    for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,200));try{const r=await fetch(base+'/studio-api/health');if(r.ok&&((await r.json()).storage==='sqlite'))return}catch{}}
    throw new StoreError('本地编辑服务未能启动，请运行 npm run dev',503)
  })().catch(e=>{runtime=undefined;throw e});return runtime
}
function metadata(r:DiagramRecord){return {diagramId:r.document.id,title:r.document.title,kind:r.document.kind,revision:r.revision,createdAt:r.createdAt,updatedAt:r.document.updatedAt,workspaceGroupId:r.workspaceGroupId||null,editorUrl:editorUrl(r.document.id)}}
async function result(r:DiagramRecord,preview=true){
  await ensureRuntime()
  if(!preview){const data={...metadata(r),quality:inspectDrawing(r.document),content:extractContent(r.document)};return {content:[{type:'text' as const,text:JSON.stringify(data)}],structuredContent:data}}
  const artifacts=await renderArtifacts(r,store.root),urls=Object.fromEntries(Object.entries(artifacts.urls).map(([k,url])=>[k,base+url]))
  const resources=Object.fromEntries(Object.keys(artifacts.files).map(k=>[k,`flymind://exports/${r.document.id}/${r.revision}/${artifacts.exportId}/${k}`]))
  const data={...metadata(r),quality:inspectDrawing(r.document),exportedAt:artifacts.exportedAt,documentPath:artifacts.files.json,files:artifacts.files,urls,resources,width:artifacts.width,height:artifacts.height}
  return {content:[{type:'text' as const,text:JSON.stringify(data)},{type:'image' as const,mimeType:'image/png',data:artifacts.png.toString('base64')},...Object.keys(artifacts.files).filter(k=>k!=='png').map(k=>({type:'resource_link' as const,uri:resources[k],name:`${r.document.title}.${k}`,mimeType:artifactMime(k)}))],structuredContent:data}
}
function artifactMime(format:string){return format==='png'?'image/png':format==='svg'?'image/svg+xml':format.endsWith('json')?'application/json':'application/xml'}
const wrap=(fn:()=>Promise<any>)=>fn().catch(e=>{
  const status=e instanceof StoreError?e.status:400
  const code=e instanceof DrawingQualityError?'QUALITY_FAILED':status===409?'CONFLICT':status===410?'DELETED':status===404?'NOT_FOUND':status===423?'BUSY':status>=500||(e as NodeJS.ErrnoException).code?'INTERNAL_ERROR':'VALIDATION_FAILED'
  const error={code,message:(e as Error).message,...(e instanceof DrawingQualityError?{quality:e.quality}:{}),...(e instanceof StoreError&&e.currentRevision?{currentRevision:e.currentRevision}:{})}
  return {isError:true,content:[{type:'text',text:JSON.stringify({error})}]}
})
server.registerTool('get_drawing_guide',{title:'绘图规则',outputSchema:guideOutput,description:'读取技术规则与绘图内容标准 1.0，包含五类图形的简洁表达、闭环和修改约束。可返回指定图形的可运行完整模板。',inputSchema:{kind:kinds.optional()},annotations:readAnnotations},({kind})=>wrap(async()=>{const guide=await drawingGuide();const data={...guide,...(kind?{sample:extractContent(sampleFor(kind))}:{})};return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}))
server.registerTool('list_diagrams',{title:'图形列表',outputSchema:listOutput,description:'列出图形、创建/修改时间、所属工作区分组与编辑链接。默认最近修改在前；workspaceGroupId=null 筛选未分组，省略则全部。',inputSchema:{sortBy:z.enum(['updated','created']).default('updated'),workspaceGroupId:id.nullable().optional()},annotations:readAnnotations},({sortBy,workspaceGroupId})=>wrap(async()=>{const records=(await store.list()).filter(r=>workspaceGroupId===undefined||(r.workspaceGroupId||null)===workspaceGroupId).sort((a,b)=>(sortBy==='created'?byCreationNewest:byModifiedNewest)(a.document,b.document));const data={diagrams:records.map(metadata)};return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}))
server.registerTool('get_diagram',{title:'读取图形',outputSchema:diagramOutput,description:'只读取最新内容 JSON（content）与 revision，不包含渲染配置。每次修改前调用，尤其在用户网页编辑后。preview=true 同时获得图片和制品。',inputSchema:{id,preview:z.boolean().default(false)},annotations:readAnnotations},({id,preview})=>wrap(async()=>result(await store.get(id),preview)))
server.registerTool('create_diagram',{title:'创建图形',outputSchema:diagramOutput,description:'保存纯业务内容，自动布局生成 PNG、SVG/JSON/draw.io 和编辑链接。可用独立 workspaceGroupId 放入图形列表分组；不要把它写进 content。已删除 ID 禁止重建。内容标准不合格时 QUALITY_FAILED，不保存。',inputSchema:{content:contentSchema,workspaceGroupId:id.optional()},annotations:createAnnotations},({content,workspaceGroupId})=>wrap(async()=>{const d=composeDocument(content);requireDrawingQuality(d);return result(await store.create(d,workspaceGroupId))}))
server.registerTool('update_diagram',{title:'替换图形内容',outputSchema:diagramOutput,description:'仅替换完整内容 JSON，保留已有渲染配置，必须携带刚读取的 expectedRevision。版本冲突时重新读取，合并人工修改。',inputSchema:{id,expectedRevision:revision,content:contentSchema,editIntent},annotations:editAnnotations},({id,expectedRevision,content,editIntent})=>wrap(async()=>result(await store.change(id,expectedRevision,d=>{const next=replaceContent(d,content);requireDrawingQuality(next,d,editIntent);return next}))))
server.registerTool('patch_diagram',{title:'增量修改内容',outputSchema:diagramOutput,description:'对图形执行原子增量修改，保留其余人工编辑。仅含增删改节点/连线、分组迁移与重排、标题；渲染样式须独立调用 configure_rendering。必须真正修改原业务或文案，默认拒绝只补说明。规则见 get_drawing_guide。',inputSchema:{id,expectedRevision:revision,operations:z.array(operationSchema).min(1).max(500),editIntent},annotations:editAnnotations},({id,expectedRevision,operations,editIntent})=>wrap(async()=>result(await store.change(id,expectedRevision,d=>{const next=applyContentOperations(d,operations);requireDrawingQuality(next,d,editIntent);return next}))))
server.registerTool('get_rendering_config',{title:'读取渲染配置',outputSchema:renderingOutput,description:'仅在用户明确要求调整视觉表现时读取独立渲染配置。普通绘图不需要调用，内容不包含坐标/样式。',inputSchema:{id},annotations:readAnnotations},({id})=>wrap(async()=>{const r=await store.get(id);const data={...metadata(r),rendering:r.document.presentation,standards:{nodes:standardNodePresets,effectiveNodes:Object.fromEntries(Object.keys(standardNodePresets).map(k=>[k,nodePreset(r.document,k as keyof typeof standardNodePresets)])),edges:edgePreset(r.document)}};return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}))
server.registerTool('configure_rendering',{title:'配置渲染',outputSchema:diagramOutput,description:'独立替换渲染配置，保持内容不变。支持节点标准大小/形状/配色、连线标准与手动覆盖。先 get_rendering_config，保留未修改的配置并携带 expectedRevision。',inputSchema:{id,expectedRevision:revision,rendering:renderingSchema},annotations:editAnnotations},({id,expectedRevision,rendering})=>wrap(async()=>result(await store.change(id,expectedRevision,d=>replaceRendering(d,rendering)))))
server.registerTool('export_diagram',{title:'交付图形',outputSchema:diagramOutput,description:'重新渲染当前图形，返回 PNG 图片与 SVG、JSON、draw.io 文件路径和下载链接。绘制与修改完成后可直接交付用户。',inputSchema:{id},annotations:readAnnotations},({id})=>wrap(async()=>result(await store.get(id))))
server.registerTool('validate_diagram',{title:'验证内容',outputSchema:validationOutput,description:'验证纯内容结构及绘图内容标准：短标题、匹配的节点类型、判断出口与流程连通性。返回 valid、quality 分数/问题及尺寸，不创建文档。error 修复后才创建；warning 需业务核对。',inputSchema:{content:contentSchema},annotations:readAnnotations},({content})=>wrap(async()=>{const {layoutDocument}=await import('../src/drawing/core/layout');const d=composeDocument(content),s=layoutDocument(d);const quality=inspectDrawing(d),data={valid:quality.passed,quality,width:s.width,height:s.height,nodes:s.nodes.length,edges:s.edges.length};return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}))
const jsonResult=(data:Record<string,unknown>)=>({content:[{type:'text' as const,text:JSON.stringify(data)}],structuredContent:data})
server.registerTool('list_deleted_diagrams',{title:'回收站',description:'列出回收站图形及 revision/deletedAt，恢复或永久删除前必须读取。',inputSchema:{},outputSchema:trashOutput,annotations:readAnnotations},()=>wrap(async()=>jsonResult({diagrams:await store.listTrash()})))
server.registerTool('restore_diagram',{title:'恢复已删除图形',description:'仅用户明确要求恢复时使用。携带回收站最新 revision 与 deletedAt，恢复原 ID 并增加修订，保留内容、渲染及原分组。',inputSchema:{id,expectedRevision:revision,deletedAt:z.number().positive()},outputSchema:diagramOutput,annotations:editAnnotations},({id,expectedRevision,deletedAt})=>wrap(async()=>result(await store.restore(id,expectedRevision,deletedAt),true)))
server.registerTool('permanently_delete_diagram',{title:'永久删除回收站图形',description:'不可恢复；仅用户明确要求永久删除指定图形时调用，禁止把普通删除或整理视为授权。先读回收站，提供最新 revision/deletedAt。',inputSchema:{id,expectedRevision:revision,deletedAt:z.number().positive()},outputSchema:successOutput,annotations:editAnnotations},({id,expectedRevision,deletedAt})=>wrap(async()=>{await store.purge(id,expectedRevision,deletedAt);return jsonResult({success:true})}))
server.registerTool('list_workspace_groups',{title:'工作区分组列表',description:'读取图形列表分组，独立于架构分层和画布组合。',inputSchema:{},outputSchema:groupsOutput,annotations:readAnnotations},()=>wrap(async()=>jsonResult({groups:await store.listGroups()})))
server.registerTool('create_workspace_group',{title:'创建工作区分组',description:'创建图形列表分组。返回 group.id，随后 create_diagram 的 workspaceGroupId 或 move_diagram_to_group 使用该 ID。',inputSchema:{name:z.string().trim().min(1).max(80)},outputSchema:groupOutput,annotations:createAnnotations},({name})=>wrap(async()=>jsonResult({group:await store.createGroup(name)})))
server.registerTool('rename_workspace_group',{title:'重命名工作区分组',description:'重命名图形列表分组，使用 list_workspace_groups 刚读取的 revision。',inputSchema:{id,expectedRevision:revision,name:z.string().trim().min(1).max(80)},outputSchema:groupOutput,annotations:editAnnotations},({id,expectedRevision,name})=>wrap(async()=>jsonResult({group:await store.updateGroup(id,expectedRevision,name)})))
server.registerTool('delete_workspace_group',{title:'删除工作区分组',description:'删除图形列表分组，保留组内图形并移至未分组。使用最新分组 revision。',inputSchema:{id,expectedRevision:revision},outputSchema:successOutput,annotations:editAnnotations},({id,expectedRevision})=>wrap(async()=>{await store.deleteGroup(id,expectedRevision);return jsonResult({success:true})}))
server.registerTool('move_diagram_to_group',{title:'移动图形到分组',description:'改变图形列表归属，保持绘图内容和渲染不变。workspaceGroupId=null 移至未分组；expectedWorkspaceGroupId 必须与刚读取的图形元数据一致。',inputSchema:{id,workspaceGroupId:id.nullable(),expectedWorkspaceGroupId:id.nullable()},outputSchema:diagramOutput,annotations:editAnnotations},({id,workspaceGroupId,expectedWorkspaceGroupId})=>wrap(async()=>result(await store.moveToGroup(id,workspaceGroupId,expectedWorkspaceGroupId),false)))
server.registerResource('drawing-guide','flymind://guide',{mimeType:'text/markdown'},async uri=>({contents:[{uri:uri.href,mimeType:'text/markdown',text:(await drawingGuide()).guide}]}))
server.registerResource('drawing-standard','flymind://drawing-standard',{mimeType:'text/markdown',description:'五类图形的内容、简洁程度、业务闭环与修改标准'},async uri=>({contents:[{uri:uri.href,mimeType:'text/markdown',text:await drawingStandard()}]}))
server.registerResource('diagram',new ResourceTemplate('flymind://diagrams/{id}',{list:async()=>({resources:(await store.list()).map(r=>({uri:`flymind://diagrams/${r.document.id}`,name:r.document.title,mimeType:'application/json'}))})}),{mimeType:'application/json'},async(uri,{id})=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(await store.get(String(id)).then(r=>({...metadata(r),content:extractContent(r.document)})))}]}))
server.registerResource('artifact',new ResourceTemplate('flymind://artifacts/{id}/{revision}/{format}',{list:undefined}),{description:'按版本读取 PNG、SVG、内容 JSON、工作区 JSON 或 draw.io；制品资源只读'},async(uri,params)=>{
  const artifactId=id.parse(String(params.id)),version=revision.parse(Number(params.revision)),format=z.enum(['png','svg','json','project.json','drawio']).parse(String(params.format))
  await store.get(artifactId)
  const file=join(store.root,'artifacts',artifactId,'r'+version,'diagram.'+format),bytes=await readFile(file),mimeType=artifactMime(format)
  return {contents:[format==='png'?{uri:uri.href,mimeType,blob:bytes.toString('base64')}:{uri:uri.href,mimeType,text:bytes.toString('utf8')}]}
})
server.registerResource('export',new ResourceTemplate('flymind://exports/{id}/{revision}/{exportId}/{format}',{list:undefined}),{description:'读取本次导出的独立文件；导出时间不改变文档时间或修订'},async(uri,params)=>{
  const artifactId=id.parse(String(params.id)),version=revision.parse(Number(params.revision)),format=z.enum(['png','svg','json','project.json','drawio']).parse(String(params.format));await store.get(artifactId)
  const bytes=await readExportFile(store.root,artifactId,version,String(params.exportId),format),mimeType=artifactMime(format)
  return {contents:[format==='png'?{uri:uri.href,mimeType,blob:bytes.toString('base64')}:{uri:uri.href,mimeType,text:bytes.toString('utf8')}]}
})
await server.connect(new StdioServerTransport())
