import express from 'express'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { DiagramStore, PROJECT_ROOT, StoreError } from './store'
import { renderArtifacts } from './artifacts'
import { VERSION } from './version'
export const store=new DiagramStore()
await store.init()
const app=express(),port=Number(process.env.FLYMIND_PORT||5179)
// Local tools and editor only; reject cross-origin writes and DNS rebinding.
app.use((req,res,next)=>{const host=req.hostname;if(!['localhost','127.0.0.1','[::1]'].includes(host)){res.status(403).json({error:'仅限本机访问'});return}const origin=req.headers.origin;if(origin&&!new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`,'http://127.0.0.1:5178','http://localhost:5178']).has(origin)){res.status(403).json({error:'来源不允许'});return}next()})
app.use(express.json({limit:'4mb'}))
app.get('/studio-api/health',(_req,res)=>res.json({name:'flymind',version:VERSION}))
app.get('/studio-api/guide',async(_req,res)=>res.type('text/markdown').send(await readFile(join(PROJECT_ROOT,'docs/AI_DRAWING_GUIDE.md'),'utf8')))
app.get('/studio-api/diagrams',async(_req,res)=>res.json(await store.list()))
app.post('/studio-api/diagrams',async(req,res)=>res.status(201).json(await store.create(req.body.document)))
app.get('/studio-api/diagrams/:id',async(req,res)=>res.json(await store.get(req.params.id)))
app.put('/studio-api/diagrams/:id',async(req,res)=>res.json(await store.update(req.params.id,req.body.expectedRevision,req.body.document)))
app.patch('/studio-api/diagrams/:id',async(req,res)=>res.json(await store.patch(req.params.id,req.body.expectedRevision,req.body.operations)))
app.delete('/studio-api/diagrams/:id',async(req,res)=>{await store.delete(req.params.id,Number(req.query.revision));res.status(204).end()})
app.post('/studio-api/diagrams/:id/export',async(req,res)=>{const record=await store.get(req.params.id),result=await renderArtifacts(record,store.root);res.json({revision:record.revision,files:result.files,urls:Object.fromEntries(Object.keys(result.files).map(k=>[k,`/artifacts/${record.document.id}/r${record.revision}/diagram.${k}`]))})})
app.use('/artifacts',express.static(join(store.root,'artifacts'),{setHeaders:res=>res.setHeader('Cache-Control','no-cache')}))
app.use(express.static(join(PROJECT_ROOT,'dist')))
app.get('/',(_req,res)=>res.sendFile(join(PROJECT_ROOT,'dist/index.html')))
app.use((err:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(err instanceof StoreError?err.status:400).json({error:err.message}))
app.listen(port,'127.0.0.1',()=>console.error(`FlyMind runtime http://127.0.0.1:${port}`))
