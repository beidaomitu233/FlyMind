import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { DiagramStore, PROJECT_ROOT, type DiagramRecord } from './store'
import { renderArtifacts } from './artifacts'
import { sampleFor } from '../src/drawing/core/samples'
import { extractContent,composeDocument,replaceContent,applyContentOperations,replaceRendering } from '../src/drawing/core/layers'
import { standardNodePresets,nodePreset,edgePreset } from '../src/drawing/core/render-config'
const store=new DiagramStore();await store.init()
const server=new McpServer({name:'flymind',version:'0.3.0'},{instructions:'FlyMind 为 AI 提供五类绘图。先 get_drawing_guide 获取规则；create_diagram 返回图片及编辑链接。修改前 get_diagram，使用最新 revision 调用 patch_diagram 或 update_diagram；绝不覆盖版本冲突。用户二次编辑后重新读取。内容层只包含业务信息和关系，可选 color；不要在内容里放 order、坐标、尺寸、形状、图标、字体、线型或 presentation。渲染器自动美化，仅在用户要求时使用 get_rendering_config / configure_rendering。最终给用户 PNG 预览、SVG/JSON 下载与 editorUrl。'})
const kinds=z.enum(['swimlane','flowchart','architecture','mindmap','dataflow']),id=z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),revision=z.number().int().positive()
const base=`http://127.0.0.1:${process.env.FLYMIND_PORT||5179}`
const editorUrl=(id:string)=>`${process.env.FLYMIND_EDITOR_URL||base}/#/?diagram=${encodeURIComponent(id)}`
let runtime:Promise<void>|undefined
async function ensureRuntime(){
  if(runtime)return runtime
  runtime=(async()=>{try{const r=await fetch(base+'/studio-api/health');if(r.ok&&(await r.json()).name==='flymind')return}catch{}
    if(process.env.FLYMIND_AUTO_WEB==='0')return
    const child=spawn(process.execPath,[join(PROJECT_ROOT,'server/start.mjs'),'--runtime'],{cwd:PROJECT_ROOT,env:process.env,stdio:'ignore',detached:true,windowsHide:true});child.unref()
    for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,200));try{const r=await fetch(base+'/studio-api/health');if(r.ok&&(await r.json()).name==='flymind')return}catch{}}
    throw new Error('本地编辑服务未能启动，请运行 npm run dev')
  })().catch(e=>{runtime=undefined;throw e});return runtime
}
function metadata(r:DiagramRecord){return {diagramId:r.document.id,title:r.document.title,kind:r.document.kind,revision:r.revision,editorUrl:editorUrl(r.document.id)}}
async function result(r:DiagramRecord,preview=true){
  await ensureRuntime()
  if(!preview){const data={...metadata(r),content:extractContent(r.document)};return {content:[{type:'text' as const,text:JSON.stringify(data)}],structuredContent:data}}
  const artifacts=await renderArtifacts(r,store.root),urls=Object.fromEntries(Object.keys(artifacts.files).map(k=>[k,`${base}/artifacts/${r.document.id}/r${r.revision}/diagram.${k}`]))
  const data={...metadata(r),documentPath:artifacts.files.json,files:artifacts.files,urls,width:artifacts.width,height:artifacts.height}
  return {content:[{type:'text' as const,text:JSON.stringify(data)},{type:'image' as const,mimeType:'image/png',data:artifacts.png.toString('base64')},...Object.entries(artifacts.files).filter(([k])=>k!=='png').map(([k,file])=>({type:'resource_link' as const,uri:pathToFileURL(file).href,name:`${r.document.title}.${k}`,mimeType:k==='svg'?'image/svg+xml':k.endsWith('json')?'application/json':'application/xml'}))],structuredContent:data}
}
const wrap=(fn:()=>Promise<any>)=>fn().catch(e=>({isError:true,content:[{type:'text',text:(e as Error).message}]}))
server.registerTool('get_drawing_guide',{description:'读取 AI 绘图规则，支持的图形、配色、节点字段、渲染导出与后续修改方式。可返回指定图形的可运行完整模板。',inputSchema:{kind:kinds.optional()},annotations:{readOnlyHint:true}},({kind})=>wrap(async()=>{const guide=await readFile(join(PROJECT_ROOT,'docs/AI_DRAWING_GUIDE.md'),'utf8');return {content:[{type:'text',text:guide},...(kind?[{type:'text',text:JSON.stringify(extractContent(sampleFor(kind)),null,2)}]:[])]}}))
server.registerTool('list_diagrams',{description:'列出共享工作区的图形 ID、标题、类型、最新版本与编辑链接。',inputSchema:{},annotations:{readOnlyHint:true}},()=>wrap(async()=>({content:[{type:'text',text:JSON.stringify((await store.list()).map(metadata))}]})))
server.registerTool('get_diagram',{description:'只读取最新内容 JSON（content）与 revision，不包含渲染配置。每次修改前调用，尤其在用户网页编辑后。preview=true 同时获得图片和制品。',inputSchema:{id,preview:z.boolean().default(false)},annotations:{readOnlyHint:true}},({id,preview})=>wrap(async()=>result(await store.get(id),preview)))
server.registerTool('create_diagram',{description:'保存 AI 编写的内容 JSON（content），禁止坐标、order、尺寸、形状、图标、线型；自动布局与美化，生成 PNG 预览、SVG/JSON/draw.io 制品及可编辑链接。id 必须唯一；先读取规则。',inputSchema:{content:z.record(z.string(),z.unknown())},annotations:{destructiveHint:false}},({content})=>wrap(async()=>result(await store.create(composeDocument(content)))))
server.registerTool('update_diagram',{description:'仅替换完整内容 JSON，保留已有渲染配置，必须携带刚读取的 expectedRevision。版本冲突时重新读取，合并人工修改。',inputSchema:{id,expectedRevision:revision,content:z.record(z.string(),z.unknown())},annotations:{destructiveHint:true}},({id,expectedRevision,content})=>wrap(async()=>result(await store.change(id,expectedRevision,d=>replaceContent(d,content)))))
server.registerTool('patch_diagram',{description:'对图形执行原子增量修改，保留其余人工编辑。仅含增删改节点/连线、分组迁移与重排、标题；渲染样式须独立调用 configure_rendering。规则见 get_drawing_guide。',inputSchema:{id,expectedRevision:revision,operations:z.array(z.record(z.string(),z.unknown())).min(1).max(500)},annotations:{destructiveHint:true}},({id,expectedRevision,operations})=>wrap(async()=>result(await store.change(id,expectedRevision,d=>applyContentOperations(d,operations)))))
server.registerTool('get_rendering_config',{description:'仅在用户明确要求调整视觉表现时读取独立渲染配置。普通绘图不需要调用，内容不包含坐标/样式。',inputSchema:{id},annotations:{readOnlyHint:true}},({id})=>wrap(async()=>{const r=await store.get(id);const data={...metadata(r),rendering:r.document.presentation,standards:{nodes:standardNodePresets,effectiveNodes:Object.fromEntries(Object.keys(standardNodePresets).map(k=>[k,nodePreset(r.document,k as keyof typeof standardNodePresets)])),edges:edgePreset(r.document)}};return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}}))
server.registerTool('configure_rendering',{description:'独立替换渲染配置，保持内容不变。支持节点标准大小/形状/配色、连线标准与手动覆盖。先 get_rendering_config，保留未修改的配置并携带 expectedRevision。',inputSchema:{id,expectedRevision:revision,rendering:z.record(z.string(),z.unknown())},annotations:{destructiveHint:true}},({id,expectedRevision,rendering})=>wrap(async()=>result(await store.change(id,expectedRevision,d=>replaceRendering(d,rendering)))))
server.registerTool('export_diagram',{description:'重新渲染当前图形，返回 PNG 图片与 SVG、JSON、draw.io 文件路径和下载链接。绘制与修改完成后可直接交付用户。',inputSchema:{id},annotations:{readOnlyHint:true}},({id})=>wrap(async()=>result(await store.get(id))))
server.registerTool('validate_diagram',{description:'验证纯内容 JSON（content），禁止美化字段。返回尺寸与节点/边数量，不创建文档。',inputSchema:{content:z.record(z.string(),z.unknown())},annotations:{readOnlyHint:true}},({content})=>wrap(async()=>{const {layoutDocument}=await import('../src/drawing/core/layout');const d=composeDocument(content),s=layoutDocument(d);return {content:[{type:'text',text:JSON.stringify({valid:true,width:s.width,height:s.height,nodes:s.nodes.length,edges:s.edges.length})}]}}))
server.registerResource('drawing-guide','flymind://guide',{mimeType:'text/markdown'},async uri=>({contents:[{uri:uri.href,mimeType:'text/markdown',text:await readFile(join(PROJECT_ROOT,'docs/AI_DRAWING_GUIDE.md'),'utf8')}]}))
server.registerResource('diagram',new ResourceTemplate('flymind://diagrams/{id}',{list:async()=>({resources:(await store.list()).map(r=>({uri:`flymind://diagrams/${r.document.id}`,name:r.document.title,mimeType:'application/json'}))})}),{mimeType:'application/json'},async(uri,{id})=>({contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(await store.get(String(id)).then(r=>({...metadata(r),content:extractContent(r.document)})))}]}))
await server.connect(new StdioServerTransport())
