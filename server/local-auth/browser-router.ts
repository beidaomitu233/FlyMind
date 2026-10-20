import {Router,json,type ErrorRequestHandler} from 'express'
import {LocalAuthorizationGate} from './gate'
import {LocalAuthError} from './types'
/** Mount only under Runtime's existing loopback/Host guard; this adds exact browser CSRF boundaries. */
export function localAuthBrowserRouter(gate:LocalAuthorizationGate,options:{runtimeOrigin:string}){
 const origin=new URL(options.runtimeOrigin)
 if(origin.origin!==options.runtimeOrigin||origin.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(origin.hostname))throw new LocalAuthError(500,'LOCAL_AUTH_CONFIGURATION_REQUIRED','本地登录路由仅接受固定loopback origin')
 const router=Router()
 router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(req.get('Host')!==origin.host||req.get('Origin')!==undefined&&req.get('Origin')!==origin.origin){res.status(403).json({code:'LOCAL_AUTH_ORIGIN_REJECTED',error:'本地登录来源不合法'});return}if(!['GET','HEAD'].includes(req.method)&&(!req.is('application/json')||req.get('Origin')!==origin.origin)){res.status(403).json({code:'LOCAL_AUTH_ORIGIN_REJECTED',error:'登录写请求需要同源JSON'});return}next()})
 router.use(json({limit:2048,strict:true}))
 router.get('/status',async(_req,res)=>{res.json(await gate.status())})
 router.post('/login',async(req,res)=>{res.json(await gate.login(req.body))})
 router.post('/device-grant',async(req,res)=>{res.json(await gate.clientDeviceGrant(req.body))})
 router.post('/logout',async(req,res)=>{if(!req.body||Object.keys(req.body).length)throw new LocalAuthError(400,'LOCAL_AUTH_INPUT_INVALID','退出请求无效');res.json(await gate.logout())})
 const errors:ErrorRequestHandler=(error,_req,res,_next)=>{const expected=error instanceof LocalAuthError,status=expected?error.status:error.type==='entity.too.large'?413:error instanceof SyntaxError?400:503;res.status(status).json({code:expected?error.code:status===413?'LOCAL_AUTH_INPUT_TOO_LARGE':'LOCAL_AUTH_UNAVAILABLE',error:expected?error.message:'本地授权请求未完成'})}
 router.use(errors);return router
}
