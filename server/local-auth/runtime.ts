import type {RequestHandler} from 'express'
import {join,resolve} from 'node:path'
import {homedir} from 'node:os'
import {LocalAuthorizationGate} from './gate'
import {LocalAuthError} from './types'
import type {CloudPermission} from '../cloud/identity'

/** Required in every shipped local Runtime. No opt-out or unprotected fallback. */
export function localRuntimeAuthorization(env:NodeJS.ProcessEnv=process.env){
 const origin=env.FLYMIND_CONTROL_PLANE_ORIGIN??''
 const privateRoot=resolve(env.FLYMIND_PRIVATE_RUNTIME_DIR??join(env.LOCALAPPDATA??join(homedir(),'AppData','Local'),'FlyMind','runtime'))
 const options={controlPlaneOrigin:origin,allowInsecureLoopback:origin.startsWith('http://127.0.0.1:')||origin.startsWith('http://localhost:')}
 // Validate before opening a database or starting a Runtime lease.
 new LocalAuthorizationGate({...options,credentialDirectory:join(privateRoot,'local-auth','configuration-check'),dataRootId:'configuration-check'})
 return {create:(dataRootId:string)=>new LocalAuthorizationGate({...options,credentialDirectory:join(privateRoot,'local-auth',dataRootId),dataRootId})}
}
export function localAuthorizationMiddleware(gate:LocalAuthorizationGate):RequestHandler{
 return async(req,res,next)=>{
  const permission:CloudPermission=['GET','HEAD','OPTIONS'].includes(req.method)||req.path==='/native/ai/validate'?'workspace:read':/\/exports(?:\/snapshot|\/[^/]+\/retry)?$|\/export$/.test(req.path)?'export:create':'workspace:write'
  try{await gate.authorize(permission);next()}catch(error){const known=error instanceof LocalAuthError;res.status(known?error.status:503).json({code:known?error.code:'LOCAL_AUTH_UNAVAILABLE',error:known?error.message:'本地授权未通过，请先在浏览器登录 FlyMind',loginUrl:'/#/native'})}
 }
}
