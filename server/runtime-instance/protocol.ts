import {createHmac,timingSafeEqual} from 'node:crypto'
import {runtimeCapabilities,VERSION} from './config'
import {RuntimeInstanceError,type NativeRuntimeHealth} from './types'
export function secretEqual(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
function canonical(value:unknown):string{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';return JSON.stringify(value)}
export function challengeProof(token:string,challenge:string,health:NativeRuntimeHealth){return createHmac('sha256',token).update(canonical({challenge,name:health.name,version:health.version,dataRootId:health.dataRootId,runtime:health.runtime,capabilities:health.capabilities})).digest('hex')}
export function assertRuntimeCapabilities(value:unknown):asserts value is NativeRuntimeHealth{
 const h=value as NativeRuntimeHealth
 if(h?.name!=='flymind'||h?.runtime?.application!=='flymind'||h.storage!=='sqlite')throw new RuntimeInstanceError('FOREIGN_SERVICE','端口不是受信FlyMind原生Runtime')
 if(h.version!==VERSION||h.runtime.appVersion!==VERSION||h.runtime.apiVersion!==1||canonical(h.capabilities)!==canonical(runtimeCapabilities()))throw new RuntimeInstanceError('RUNTIME_VERSION_MISMATCH','Runtime版本/API/引擎/adapter/profile/真实能力不匹配')
}
export function validateRuntimeHealth(value:unknown,expected:{rootPathId:string;instanceId:string;pid:number;token:string;challenge:string}):NativeRuntimeHealth{
 const h=value as NativeRuntimeHealth
 assertRuntimeCapabilities(h)
 if(h.runtime.rootPathId!==expected.rootPathId)throw new RuntimeInstanceError('DATA_ROOT_MISMATCH','端口属于另一数据根')
 if(h.runtime.instanceId!==expected.instanceId||h.runtime.pid!==expected.pid||typeof h.dataRootId!=='string'||!/^[a-f0-9]{64}$/.test(h.dataRootId))throw new RuntimeInstanceError('INSTANCE_MISMATCH','Runtime实例/工作区身份不匹配')
 if(typeof h.proof!=='string'||!secretEqual(h.proof,challengeProof(expected.token,expected.challenge,h)))throw new RuntimeInstanceError('RUNTIME_AUTHENTICATION_FAILED','Runtime服务端凭据证明不匹配')
 return h
}
