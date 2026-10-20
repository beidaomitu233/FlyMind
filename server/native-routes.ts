import express,{Router} from 'express'
import {realpathSync} from 'node:fs'
import {resolve,sep} from 'node:path'
import type {NativeDiagramService} from './application/native-diagrams'
import type {NativeExportService} from './application/native-exports'
import {StoreError} from './store'
import {NativeImportService} from './application/native-imports'
import {nativeDocumentCapabilities} from '../src/drawing/services/native-capabilities'
import {applicationDrawingGuide} from './mcp-native/guide'
import type {CloudReleaseManifest} from './cloud/mcp-compat'

export function nativeError(error:unknown){
  const e=error as {message?:string;status?:number;code?:string;currentRevision?:number;quality?:unknown}
  const code=e.code||e.message?.match(/^([A-Z][A-Z0-9_]+):/)?.[1]||'VALIDATION_FAILED'
  return {status:e.status&&e.status>=400&&e.status<=599?e.status:400,body:{error:e.message||'原生文档操作失败',code,...(e.currentRevision!==undefined?{currentRevision:e.currentRevision}:{}),...(e.quality?{quality:e.quality}:{})}}
}
export function nativeRouter(service:NativeDiagramService,exports?:NativeExportService,options:{release?:CloudReleaseManifest}={}){
  const router=Router()
  const imports=new NativeImportService(service)
  router.use((_req,_res,next)=>{if(!service.enabled)next(new StoreError('Native pilot 未启用',404,undefined,'NATIVE_PILOT_DISABLED'));else next()})
  router.use((req,_res,next)=>{try{if(['POST','PUT','PATCH','DELETE'].includes(req.method))service.assertWorkspaceIdentity(req.get('X-FlyMind-DataRoot-Id'));next()}catch(error){next(error)}})
  router.get('/diagrams',async(_req,res)=>res.json(await service.list()))
  router.get('/capabilities',(_req,res)=>res.json(nativeDocumentCapabilities()))
  router.get('/guide',async(req,res)=>{if(Object.keys(req.query).some(k=>k!=='kind')||req.query.kind!==undefined&&typeof req.query.kind!=='string')throw new StoreError('绘图规则参数无效');res.json(await applicationDrawingGuide(req.query.kind,options.release))})
  router.post('/imports',async(req,res)=>res.status(201).json(await imports.import(req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.post('/imports/preview',async(req,res)=>res.json(await imports.preview(req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.post('/imports/items/preview',async(req,res)=>res.json(await imports.previewItem(req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.post('/imports/items',async(req,res)=>res.status(201).json(await imports.commitItem(req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.get('/diagrams/:id/import-source',async(req,res)=>{const source=await imports.source(req.params.id);res.set('Cache-Control','no-store');res.attachment(source.source.format.startsWith('drawio-')?'source.drawio':'source.json');res.type(source.source.format.startsWith('drawio-')?'application/xml':'application/json');res.send(source.buffer)})
  router.get('/diagrams/:id/rendering',async(req,res)=>res.json(await service.rendering(req.params.id)))
  router.post('/diagrams/:id/rendering',async(req,res)=>res.json(await service.configureRendering(req.params.id,req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.get('/workspace',async(_req,res)=>{res.set('Cache-Control','no-store');res.json(await service.workspace())})
  router.get('/activity',async(req,res)=>{
    const allowed=['diagramId','groupId','actorUserId','channel','action','limit','cursor']
    if(Object.keys(req.query).some(k=>!allowed.includes(k))||Object.values(req.query).some(v=>typeof v!=='string'))throw new StoreError('操作记录筛选无效',400,undefined,'ACTIVITY_QUERY_INVALID')
    const query={...req.query,...(req.query.limit!==undefined?{limit:Number(req.query.limit)}:{})} as Parameters<typeof service.store.listActivity>[0]
    res.json(await service.store.listActivity(query,req.get('X-FlyMind-DataRoot-Id')))
  })
  router.get('/records',async(_req,res)=>res.json(await service.listRecords()))
  router.get('/records/:id',async(req,res)=>res.json(await service.readContent(req.params.id)))
  router.get('/groups',async(_req,res)=>res.json({groups:await service.groups()}))
  router.get('/trash',async(_req,res)=>res.json({diagrams:await service.trash()}))
  router.post('/groups',async(req,res)=>res.status(201).json(await service.organize('create-group',undefined,req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.put('/groups/:id',async(req,res)=>res.json(await service.organize('rename-group',req.params.id,req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.delete('/groups/:id',async(req,res)=>res.json(await service.organize('delete-group',req.params.id,{expectedRevision:Number(req.query.revision)},req.get('X-FlyMind-DataRoot-Id'))))
  router.put('/diagrams/:id/group',async(req,res)=>res.json(await service.organize('move',req.params.id,req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.delete('/diagrams/:id',async(req,res)=>res.json(await service.organize('delete',req.params.id,{expectedRevision:Number(req.query.revision)},req.get('X-FlyMind-DataRoot-Id'))))
  router.post('/trash/:id/restore',async(req,res)=>res.json(await service.organize('restore',req.params.id,req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.delete('/trash/:id',async(req,res)=>res.json(await service.organize('purge',req.params.id,{expectedRevision:Number(req.query.revision),deletedAt:Number(req.query.deletedAt)},req.get('X-FlyMind-DataRoot-Id'))))
  router.post('/diagrams',async(req,res)=>res.status(201).json(await service.create(req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.get('/diagrams/:id',async(req,res)=>res.json(await service.getDrawing(req.params.id)))
  router.post('/diagrams/:id/business-mapping',async(req,res)=>res.json(await service.mapCanvas(req.params.id,req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.get('/diagrams/:id/business-mapping',async(req,res)=>res.json(await service.canvasMappingCells(req.params.id)))
  router.post('/diagrams/:id/business-mapping/preview',async(req,res)=>res.json(await service.previewCanvasMapping(req.params.id,req.body)))
  router.post('/diagrams/:id/editor-save',async(req,res)=>res.json(await service.saveEditor(req.params.id,req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.post('/diagrams/:id/content-patch',async(req,res)=>res.json(await service.patchContent(req.params.id,req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.post('/ai/diagrams',async(req,res)=>res.status(201).json(await service.createAI(req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.post('/ai/validate',async(req,res)=>res.json(await service.validateAI(req.body.content)))
  router.post('/ai/diagrams/:id/content-patch',async(req,res)=>res.json(await service.patchAI(req.params.id,req.body,req.get('X-FlyMind-DataRoot-Id'))))
  router.post('/ai/diagrams/:id/content-update',async(req,res)=>res.json(await service.updateAI(req.params.id,req.body,req.get('X-FlyMind-DataRoot-Id'))))
  if(exports){
    router.post('/diagrams/:id/exports/snapshot',async(req,res)=>res.status(202).json(await exports.createSnapshot(req.params.id,req.body,req.get('X-FlyMind-DataRoot-Id'))))
    router.post('/diagrams/:id/exports',async(req,res)=>res.status(202).json(await exports.create(req.params.id,req.body,req.get('X-FlyMind-DataRoot-Id'))))
    router.get('/exports/:jobId',async(req,res)=>{res.set('Cache-Control','no-store');res.json(await exports.get(req.params.jobId))})
    router.get('/exports/:jobId/delivery',async(req,res)=>{res.set('Cache-Control','no-store');res.json(await exports.delivery(req.params.jobId))})
    router.get('/exports/:jobId/snapshot',async(req,res)=>{res.set('Cache-Control','no-store');res.json(await exports.snapshot(req.params.jobId))})
    router.post('/exports/:jobId/retry',async(req,res)=>res.status(202).json(await exports.retry(req.params.jobId,req.body,req.get('X-FlyMind-DataRoot-Id'))))
    router.get('/exports/:jobId/files/:format',async(req,res)=>{const file=await exports.file(req.params.jobId,req.params.format);res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');res.attachment(file.filename);res.type(file.mediaType);res.send(file.buffer)})
  }
  router.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const result=nativeError(error);res.status(result.status).json(result.body)})
  return router
}

/** Serve only public, local vendor assets; never expose WAR internals or symlink escapes. */
export function drawioStaticRouter(vendor:string){
  const root=realpathSync.native(resolve(vendor)),router=Router()
  router.use((req,res,next)=>{
    try{
      const path=decodeURIComponent(req.path),segments=path.split('/').filter(Boolean)
      if(segments.some(x=>x==='.'||x==='..'||x.startsWith('.')||/^(web-inf|meta-inf)$/i.test(x))||/[\\\u0000:%]/.test(path)){res.sendStatus(404);return}
      const target=realpathSync.native(resolve(root,...segments))
      if(target!==root&&!target.startsWith(root+sep)){res.sendStatus(404);return}
      next()
    }catch{res.sendStatus(404)}
  })
  router.use(express.static(root,{dotfiles:'deny',index:'index.html',fallthrough:false,redirect:true,setHeaders:res=>{res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' data: blob:; form-action 'none'; base-uri 'self'")}}))
  return router
}
