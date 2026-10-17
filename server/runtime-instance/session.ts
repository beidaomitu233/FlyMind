import type {RequestHandler} from 'express'
import {createHmac} from 'node:crypto'
import {secretEqual} from './protocol'
import type {RuntimeBootContext} from './boot'
/** Pilot API gate. Health and same-origin session bootstrap are explicit exceptions. */
export function runtimeSessionMiddleware(context:RuntimeBootContext,currentDataRootId:()=>string):RequestHandler{
 const name='fm_native_'+context.lease.owner.instanceId.replaceAll('-',''),cookie=(root:string)=>root+'.'+createHmac('sha256',context.sessionToken).update('web-cookie:'+root).digest('hex')
 return (req,res,next)=>{
  if(req.path==='/health')return next()
  const root=currentDataRootId()
  if(req.path==='/session'&&req.method==='POST'){
   if(!req.get('Origin')){res.status(403).json({error:'浏览器会话需要受控同源Origin',code:'ORIGIN_REQUIRED'});return}
   if(req.body?.expectedDataRootId!==undefined&&req.body.expectedDataRootId!==root){res.status(409).json({error:'工作区已改变，不能自动重绑',code:'WORKSPACE_MISMATCH'});return}
   res.setHeader('Cache-Control','no-store');res.cookie(name,cookie(root),{httpOnly:true,sameSite:'strict',path:'/studio-api',maxAge:12*60*60*1000});res.json({instanceId:context.lease.owner.instanceId,dataRootId:root});return
  }
  const authorization=req.get('Authorization')??'',bearer=authorization.startsWith('Bearer ')?authorization.slice(7):'',cookies=(req.get('Cookie')??'').split(';').map(v=>v.trim()),web=cookies.find(v=>v.startsWith(name+'='))?.slice(name.length+1)??''
  if(!secretEqual(bearer,context.sessionToken)&&!secretEqual(web,cookie(root))){res.status(401).json({error:'本机Runtime会话凭据缺失或已失效',code:'SESSION_REQUIRED'});return}
  const expected=req.get('X-FlyMind-DataRoot-Id');if(expected!==undefined&&expected!==root){res.status(409).json({error:'工作区身份已改变，请保留本机草稿',code:'WORKSPACE_MISMATCH'});return}
  next()
 }
}
export function explicitRuntimeShutdown(context:RuntimeBootContext,currentDataRootId:()=>string,shutdown:()=>Promise<void>):RequestHandler{
 return (req,res)=>{
  if(!secretEqual(req.get('Authorization')??'','Bearer '+context.sessionToken)){res.status(403).json({error:'显式停止仅接受本机Bearer凭据',code:'BEARER_REQUIRED'});return}
  if(req.body?.instanceId!==context.lease.owner.instanceId){res.status(409).json({error:'Runtime实例不匹配，未执行停止',code:'INSTANCE_MISMATCH'});return}
  if(req.body?.dataRootId!==currentDataRootId()||req.get('X-FlyMind-DataRoot-Id')!==currentDataRootId()){res.status(409).json({error:'数据根身份不匹配，未执行停止',code:'WORKSPACE_MISMATCH'});return}
  res.once('finish',()=>void shutdown().then(()=>process.exit(0),()=>process.exit(1)));res.status(202).json({accepted:true,instanceId:context.lease.owner.instanceId})
 }
}
