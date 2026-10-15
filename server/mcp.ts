import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { DiagramStore, StoreError, PROJECT_ROOT, type DiagramRecord } from './store'
import { renderArtifacts } from './artifacts'
import { sampleFor } from '../src/drawing/core/samples'
import { extractContent,composeDocument,replaceContent,applyContentOperations,replaceRendering } from '../src/drawing/core/layers'
import { standardNodePresets,nodePreset,edgePreset } from '../src/drawing/core/render-config'
import { diagramKind,diagramId,revision,contentSchema,operationSchema,renderingSchema,diagramOutput,guideOutput,listOutput,renderingOutput,validationOutput,readAnnotations,createAnnotations,editAnnotations } from './contracts'
import { VERSION } from './version'
const store=new DiagramStore();await store.init()
const server=new McpServer({name:'flymind',version:VERSION},{instructions:'FlyMind 为 AI 提供五类绘图。先 get_drawing_guide 获取规则；create_diagram 返回图片及编辑链接。修改前 get_diagram，使用最新 revision 调用 patch_diagram 或 update_diagram；绝不覆盖版本冲突。用户二次编辑后重新读取。内容层只包含业务信息和关系，可选 color；不要在内容里放 order、坐标、尺寸、形状、图标、字体、线型或 presentation。渲染器自动美化，仅在用户要求时使用 get_rendering_config / configure_rendering。最终给用户 PNG 预览、SVG/JSON 下载与 editorUrl。'})
const kinds=diagramKind,id=diagramId
const base=`http://127.0.0.1:${process.env.FLYMIND_PORT||5179}`
const editorUrl=(id:string)=>`${process.env.FLYMIND_EDITOR_URL||base}/#/?diagram=${encodeURIComponent(id)}`
let runtime:Promise<void>|undefined
async function ensureRuntime(){
  if(runtime)return runtime
  runtime=(async()=>{try{const r=await fetch(base+'/studio-api/health');if(r.ok&&(await r.json()).name==='flymind')return}catch{}
    if(process.env.FLYMIND_AUTO_WEB==='0')return
    const child=spawn(process.execPath,[join(PROJECT_ROOT,'server/start.mjs'),'--runtime'],{cwd:PROJECT_ROOT,env:process.env,stdio:'ignore',detached:true,windowsHide:true});child.unref()
    for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,200));try{const r=await fetch(base+'/studio-api/health');if(r.ok&&(await r.json()).name==='flymind')return}catch{}}
    throw new StoreError('本地编辑服务未能启动，请运行 npm run dev',503)
  })().catch(e=>{runtime=undefined;throw e});return runtime
}
function metadata(r:DiagramRecord){return {diagramId:r.document.id,title:r.document.title,kind:r.document.kind,revision:r.revision,createdAt:r.createdAt,editorUrl:editorUrl(r.document.id)}}
async function result(r:DiagramRecord,preview=true){
  await ensureRuntime()
  if(!preview){const data={...metadata(r),content:extractContent(r.document)};return {content:[{type:'text' as const,text:JSON.stringify(data)}],structuredContent:data}}
  const artifacts=await renderArtifacts(r,store.root),urls=Object.fromEntries(Object.keys(artifacts.files).map(k=>[k,`${base}/artifacts/${r.document.id}/r${r.revision}/diagram.${k}`]))
  const resources=Object.fromEntries(Object.keys(artifacts.files).map(k=>[k,`flymind://artifacts/${r.document.id}/${r.revision}/${k}`]))
  const data={...metadata(r),documentPath:artifacts.files.json,files:artifacts.files,urls,resources,width:artifacts.width,height:artifacts.height}
  return {content:[{type:'text' as const,text:JSON.stringify(data)},{type:'image' as const,mimeType:'image/png',data:artifacts.png.toString('base64')},...Object.keys(artifacts.files).filter(k=>k!=='png').map(k=>({type:'resource_link' as const,uri:resources[k],name:`${r.document.title}.${k}`,mimeType:artifactMime(k)}))],structuredContent:data}
}
function artifactMime(format:string){return format==='png'?'image/png':format==='svg'?'image/svg+xml':format.endsWith('json')?'application/json':'application/xml'}
const wrap=(fn:()=>Promise<any>)=>fn().catch(e=>{
  const status=e instanceof StoreError?e.status:400
  const code=status===409?'CONFLICT':status===404?'NOT_FOUND':status===423?'BUSY':status>=500||(e as NodeJS.ErrnoException).code?'INTERNAL_ERROR':'VALIDATION_FAILED'
  const error={code,message:(e as Error).message,...(e instanceof StoreError&&e.currentRevision?{currentRevision:e.currentRevision}:{})}
  return {isError:true,content:[{type:'text',text:JSON.stringify({error})}]}
})
server.registerTool('get_drawing_guide',{title:'绘图规则',outputSchema:guideOutput,description:'读取 AI 绘图规则，支持的图形、配色、节点字段、渲染导出与后续修改方式。可返回指定图形的可运行完整模板。',inputSchema:{kind:kinds.optional()},annotations:readAnnotations},({kind})=>wrap(async()=>{const guide=await readFile(join(PROJECT_ROOT,'docs/AI_DRAWING_GUIDE.md'),'utf8');const data={guide,...(kind?{sample:extractContent(sampleFor(kind))}:{})};return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}))
server.registerTool('list_diagrams',{title:'图形列表',outputSchema:listOutput,description:'列出共享工作区的图形 ID、标题、类型、最新版本与编辑链接。',inputSchema:{},annotations:readAnnotations},()=>wrap(async()=>{const data={diagrams:(await store.list()).map(metadata)};return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}))
server.registerTool('get_diagram',{title:'读取图形',outputSchema:diagramOutput,description:'只读取最新内容 JSON（content）与 revision，不包含渲染配置。每次修改前调用，尤其在用户网页编辑后。preview=true 同时获得图片和制品。',inputSchema:{id,preview:z.boolean().default(false)},annotations:readAnnotations},({id,preview})=>wrap(async()=>result(await store.get(id),preview)))
server.registerTool('create_diagram',{title:'创建图形',outputSchema:diagramOutput,description:'保存 AI 编写的内容 JSON（content），禁止坐标、order、尺寸、形状、图标、线型；自动布局与美化，生成 PNG 预览、SVG/JSON/draw.io 制品及可编辑链接。id 必须唯一；先读取规则。',inputSchema:{content:contentSchema},annotations:createAnnotations},({content})=>wrap(async()=>result(await store.create(composeDocument(content)))))
server.registerTool('update_diagram',{title:'替换图形内容',outputSchema:diagramOutput,description:'仅替换完整内容 JSON，保留已有渲染配置，必须携带刚读取的 expectedRevision。版本冲突时重新读取，合并人工修改。',inputSchema:{id,expectedRevision:revision,content:contentSchema},annotations:editAnnotations},({id,expectedRevision,content})=>wrap(async()=>result(await store.change(id,expectedRevision,d=>replaceContent(d,content)))))
server.registerTool('patch_diagram',{title:'增量修改内容',outputSchema:diagramOutput,description:'对图形执行原子增量修改，保留其余人工编辑。仅含增删改节点/连线、分组迁移与重排、标题；渲染样式须独立调用 configure_rendering。规则见 get_drawing_guide。',inputSchema:{id,expectedRevision:revision,operations:z.array(operationSchema).min(1).max(500)},annotations:editAnnotations},({id,expectedRevision,operations})=>wrap(async()=>result(await store.change(id,expectedRevision,d=>applyContentOperations(d,operations)))))
server.registerTool('get_rendering_config',{title:'读取渲染配置',outputSchema:renderingOutput,description:'仅在用户明确要求调整视觉表现时读取独立渲染配置。普通绘图不需要调用，内容不包含坐标/样式。',inputSchema:{id},annotations:readAnnotations},({id})=>wrap(async()=>{const r=await store.get(id);const data={...metadata(r),rendering:r.document.presentation,standards:{nodes:standardNodePresets,effectiveNodes:Object.fromEntries(Object.keys(standardNodePresets).map(k=>[k,nodePreset(r.document,k as keyof typeof standardNodePresets)])),edges:edgePreset(r.document)}};return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}))
server.registerTool('configure_rendering',{title:'配置渲染',outputSchema:diagramOutput,description:'独立替换渲染配置，保持内容不变。支持节点标准大小/形状/配色、连线标准与手动覆盖。先 get_rendering_config，保留未修改的配置并携带 expectedRevision。',inputSchema:{id,expectedRevision:revision,rendering:renderingSchema},annotations:editAnnotations},({id,expectedRevision,rendering})=>wrap(async()=>result(await store.change(id,expectedRevision,d=>replaceRendering(d,rendering)))))
server.registerTool('export_diagram',{title:'交付图形',outputSchema:diagramOutput,description:'重新渲染当前图形，返回 PNG 图片与 SVG、JSON、draw.io 文件路径和下载链接。绘制与修改完成后可直接交付用户。',inputSchema:{id},annotations:readAnnotations},({id})=>wrap(async()=>result(await store.get(id))))
server.registerTool('validate_diagram',{title:'验证内容',outputSchema:validationOutput,description:'验证纯内容 JSON（content），禁止美化字段。返回尺寸与节点/边数量，不创建文档。',inputSchema:{content:contentSchema},annotations:readAnnotations},({content})=>wrap(async()=>{const {layoutDocument}=await import('../src/drawing/core/layout');const d=composeDocument(content),s=layoutDocument(d);const data={valid:true,width:s.width,height:s.height,nodes:s.nodes.length,edges:s.edges.length};return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}))
server.registerResource('drawing-guide','flymind://guide',{mimeType:'text/markdown'},async uri=>({contents:[{uri:uri.href,mimeType:'text/markdown',text:await readFile(join(PROJECT_ROOT,'docs/AI_DRAWING_GUIDE.md'),'utf8')}]}))
server.registerResource('diagram',new ResourceTemplate('flymind://diagrams/{id}',{list:async()=>({resources:(await store.list()).map(r=>({uri:`flymind://diagrams/${r.document.id}`,name:r.document.title,mimeType:'application/json'}))})}),{mimeType:'application/json'},async(uri,{id})=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(await store.get(String(id)).then(r=>({...metadata(r),content:extractContent(r.document)})))}]}))
server.registerResource('artifact',new ResourceTemplate('flymind://artifacts/{id}/{revision}/{format}',{list:undefined}),{description:'按版本读取 PNG、SVG、内容 JSON、工作区 JSON 或 draw.io；制品资源只读'},async(uri,params)=>{
  const artifactId=id.parse(String(params.id)),version=revision.parse(Number(params.revision)),format=z.enum(['png','svg','json','project.json','drawio']).parse(String(params.format))
  const file=join(store.root,'artifacts',artifactId,'r'+version,'diagram.'+format),bytes=await readFile(file),mimeType=artifactMime(format)
  return {contents:[format==='png'?{uri:uri.href,mimeType,blob:bytes.toString('base64')}:{uri:uri.href,mimeType,text:bytes.toString('utf8')}]}
})
await server.connect(new StdioServerTransport())
