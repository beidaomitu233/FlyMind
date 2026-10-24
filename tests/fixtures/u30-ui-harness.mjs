// Explicit loopback UI acceptance harness. Identity and management are real Java HTTP.
import express from 'express'
import {createServer,request as upstreamRequest} from 'node:http'
import {readFile,writeFile,access} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createCloudHTTP} from '../../server/cloud/http.ts'

let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>16384)throw Error('HARNESS_INPUT_LIMIT')}
const config=JSON.parse(raw),origin='http://127.0.0.1:5208',provider=new URL(config.controlPlaneURL)
if(provider.hostname!=='127.0.0.1'||provider.protocol!=='http:')throw Error('HARNESS_PROVIDER_REFUSED')
const output=resolve(config.outputDirectory),adminDist=resolve('integrations/xinghui-admin/frontend/apps/web-ele/dist')
await access(join(adminDist,'index.html'));await access(resolve('dist/index.html'))
const app=express()
// Preserve the existing Vben /api contract, including raw admin JWT Authorization.
app.use('/api',(req,res)=>{
 const headers={...req.headers,host:provider.host};delete headers.connection
 const upstream=upstreamRequest(new URL(provider.origin+(req.originalUrl.slice(4)||'/')),{method:req.method,headers},reply=>{res.writeHead(reply.statusCode??502,reply.headers);reply.on('error',()=>res.destroy());reply.pipe(res)})
 upstream.setTimeout(15000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.status(502).json({code:502,message:'隔离Java服务暂时不可用'});else res.destroy()});req.on('aborted',()=>upstream.destroy());req.pipe(upstream)
})
app.use('/admin',express.static(adminDist,{index:'index.html'}),(_req,res)=>res.sendFile(join(adminDist,'index.html')))
const cloud=createCloudHTTP({controlPlaneURL:provider.origin,publicOrigin:origin,cloudDataRoot:join(output,'data'),gatewayKey:config.gatewayKey,allowInsecureLoopback:true,collaborationIntervalMs:150})
app.use(cloud.app)
const server=createServer(app);await new Promise((yes,no)=>{server.once('error',no);server.listen(5208,'127.0.0.1',yes)})
const privateFile=join(output,'connection.json'),details=JSON.parse(await readFile(privateFile,'utf8'))
await writeFile(privateFile,JSON.stringify({...details,origin,cloudURL:origin+'/#/cloud',adminURL:origin+'/admin/',nodePid:process.pid,ready:true},null,2))
console.error('U30 isolated real-Java UI ready on loopback port 5208; connection file updated')
let stopping=false
async function stop(){if(stopping)return;stopping=true;clearInterval(timer);try{await cloud.quiesce({timeoutMs:20000});server.closeAllConnections();await new Promise(r=>server.close(r));await cloud.close();process.exitCode=0}catch{process.exitCode=1}finally{process.exit(process.exitCode)}}
const timer=setInterval(()=>{void access(join(output,'stop')).then(stop,()=>{})},500)
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop())
