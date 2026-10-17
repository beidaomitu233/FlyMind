import {runtimeAllowedOrigins} from './runtime-instance/origin'
import express from 'express'
import { join,basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import { DiagramStore, PROJECT_ROOT } from './store'
import { renderArtifacts } from './artifacts'
import { VERSION } from './version'
import {drawingGuide,drawingStandard} from './drawing-guide'
import {nativePilotConfiguration,workspaceDataRootId} from './native-pilot'
import {NativeDiagramService} from './application/native-diagrams'
import {nativeRouter,nativeError} from './native-routes'
import {NativeExportService} from './application/native-exports'
import {NativeExportWorker} from './exports/worker'
import {NativeDrawioRenderer} from './rendering/renderer'
import {runtimeAssetsRouter} from './rendering/assets'
import {prepareNativeRuntime} from './runtime-instance/boot'
import {runtimeSessionMiddleware,explicitRuntimeShutdown} from './runtime-instance/session'
import {challengeProof} from './runtime-instance/protocol'
// Guard the pilot root before any store construction/init can touch SQLite.
const pilot=nativePilotConfiguration(process.env,PROJECT_ROOT)
const nativeBoot=pilot.enabled?await prepareNativeRuntime():undefined
export const store=new DiagramStore(pilot.dataRoot)
let exportWorker:NativeExportWorker|undefined
try{
await store.init()
const app=express(),port=nativeBoot?.port??Number(process.env.FLYMIND_PORT||5179)
const nativeService=new NativeDiagramService(store,pilot.enabled),workspaceId=store.nativeWorkspaceId(false),dataRootId=nativeService.dataRootId||(workspaceId?workspaceDataRootId(workspaceId):pilot.dataRootId)
// Local tools and editor only; reject cross-origin writes and DNS rebinding.
app.use((req,res,next)=>{const host=req.hostname;if(!['localhost','127.0.0.1','[::1]'].includes(host)){res.status(403).json({error:'仅限本机访问',code:'LOCAL_ACCESS_ONLY'});return}const origin=req.headers.origin;if(origin&&!runtimeAllowedOrigins(port).has(origin)){res.status(403).json({error:'来源不允许',code:'ORIGIN_FORBIDDEN'});return}next()})
app.use(express.json({limit:'4mb'}))
const currentDataRootId=()=>{const current=store.nativeWorkspaceId(false);return current?workspaceDataRootId(current):dataRootId}
app.get('/studio-api/health',(req,res)=>{const identity=currentDataRootId(),health=nativeBoot?nativeBoot.health(identity):{name:'flymind',version:VERSION,storage:'sqlite',dataRootId:identity,capabilities:{nativePilot:pilot.enabled,nativeDocumentWrites:pilot.enabled,mixedWorkspace:pilot.enabled}};res.set('Cache-Control','no-store');const challenge=req.get('X-FlyMind-Challenge');if(nativeBoot&&challenge&&/^[a-f0-9]{64}$/.test(challenge))res.json({...health,proof:challengeProof(nativeBoot.sessionToken,challenge,nativeBoot.health(identity))});else res.json(health)})
if(nativeBoot)app.use('/studio-api',runtimeSessionMiddleware(nativeBoot,currentDataRootId))
if(nativeBoot)app.post('/studio-api/runtime/shutdown',explicitRuntimeShutdown(nativeBoot,currentDataRootId,shutdown))
const nativeExports=new NativeExportService(store,pilot.enabled)
app.use('/studio-api/native',nativeRouter(nativeService,nativeExports))
if(pilot.enabled){app.use(runtimeAssetsRouter());exportWorker=new NativeExportWorker(store,new NativeDrawioRenderer());exportWorker.start()}
app.get('/studio-api/guide',async(_req,res)=>res.type('text/markdown').send((await drawingGuide()).guide))
app.get('/studio-api/drawing-standard',async(_req,res)=>res.type('text/markdown').send(await drawingStandard()))
app.get('/studio-api/diagrams',async(_req,res)=>res.json(await store.list()))
app.get('/studio-api/workspace',async(_req,res)=>{res.set('Cache-Control','no-store');res.json(await store.snapshot())})
app.get('/studio-api/trash',async(_req,res)=>res.json(await store.listTrash()))
app.post('/studio-api/trash/:id/restore',async(req,res)=>res.json(await store.restoreStored(req.params.id,req.body.expectedRevision,req.body.deletedAt)))
app.delete('/studio-api/trash/:id',async(req,res)=>{await store.purge(req.params.id,Number(req.query.revision),Number(req.query.deletedAt));res.status(204).end()})
app.post('/studio-api/workspace/backup',async(_req,res)=>{const path=await store.backup();res.json({downloadUrl:'/studio-api/workspace/backups/'+basename(path)})})
app.get('/studio-api/workspace/backups/:name',(req,res)=>{if(!/^flymind-\d+-[a-f0-9]{8}\.sqlite$/.test(req.params.name)){res.status(400).json({error:'备份名称无效'});return}res.download(join(store.root,'backups',req.params.name))})
app.get('/studio-api/groups',async(_req,res)=>res.json(await store.listGroups()))
app.post('/studio-api/groups',async(req,res)=>res.status(201).json(await store.createGroup(req.body.name)))
app.put('/studio-api/groups/:id',async(req,res)=>res.json(await store.updateGroup(req.params.id,req.body.expectedRevision,req.body.name)))
app.delete('/studio-api/groups/:id',async(req,res)=>{await store.deleteGroup(req.params.id,Number(req.query.revision));res.status(204).end()})
app.post('/studio-api/diagrams',async(req,res)=>res.status(201).json(await store.create(req.body.document,req.body.workspaceGroupId)))
app.put('/studio-api/diagrams/:id/group',async(req,res)=>res.json(await store.moveStoredToGroup(req.params.id,req.body.workspaceGroupId,req.body.expectedWorkspaceGroupId)))
app.get('/studio-api/diagrams/:id',async(req,res)=>res.json(await store.get(req.params.id)))
app.put('/studio-api/diagrams/:id',async(req,res)=>res.json(await store.update(req.params.id,req.body.expectedRevision,req.body.document)))
app.patch('/studio-api/diagrams/:id',async(req,res)=>res.json(await store.patch(req.params.id,req.body.expectedRevision,req.body.operations)))
app.delete('/studio-api/diagrams/:id',async(req,res)=>{await store.delete(req.params.id,Number(req.query.revision));res.status(204).end()})
app.post('/studio-api/diagrams/:id/export',async(req,res)=>{const record=await store.get(req.params.id),result=await renderArtifacts(record,store.root);res.json({revision:record.revision,exportedAt:result.exportedAt,files:result.files,urls:result.urls})})
if(pilot.enabled)app.use('/artifacts',(_req,res)=>res.status(403).json({error:'Native pilot仅通过认证制品API下载',code:'LEGACY_ARTIFACT_DISABLED'}))
else app.use('/artifacts',async(req,_res,next)=>{try{await store.get(req.path.split('/')[1]||'');next()}catch(e){next(e)}},express.static(join(store.root,'artifacts'),{setHeaders:res=>res.setHeader('Cache-Control','no-cache')}))
app.use(express.static(join(PROJECT_ROOT,'dist')))
app.get('/',(_req,res)=>res.sendFile(join(PROJECT_ROOT,'dist/index.html')))
app.use((err:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const result=nativeError(err);res.status(result.status).json(result.body)})
const httpServer=nativeBoot?.server??app.listen(port,'127.0.0.1',()=>console.error(`FlyMind runtime http://127.0.0.1:${port}`))
if(nativeBoot){nativeBoot.attachRequestHandler(app);await nativeBoot.ready(currentDataRootId());console.error(`FlyMind native runtime http://127.0.0.1:${port}`)}
let stopping:Promise<void>|undefined
function shutdown(){
  if(stopping)return stopping
  stopping=(async()=>{await exportWorker?.close();const closed=new Promise<void>(resolve=>httpServer.close(()=>resolve()));httpServer.closeIdleConnections();httpServer.closeAllConnections();await closed;await nativeBoot?.lease.release()})()
  return stopping
}
const terminate=()=>void shutdown().then(()=>process.exit(0),()=>process.exit(1))
process.once('SIGINT',terminate);process.once('SIGTERM',terminate)
// This is a private parent/child IPC hook for isolated probes, never an HTTP API.
if(process.connected)process.on('message',message=>{if(message&&typeof message==='object'&&(message as {type?:string}).type==='flymind-test-shutdown')terminate()})
}catch(error){
  try{await exportWorker?.close()}catch{/* Preserve the startup failure. */}
  finally{try{await nativeBoot?.close()}catch{/* Preserve the startup failure. */}}
  throw error
}
