import {AsyncLocalStorage} from 'node:async_hooks'
export interface ActivityActor {
 userId?:string;userDisplayName?:string;teamId?:string;channel:'web'|'mcp'|'system';clientId?:string;correlationId?:string;requestId?:string;dataRootId?:string
}
const storage=new AsyncLocalStorage<Readonly<ActivityActor>>()
/** Only trusted HTTP/MCP middleware may construct this scope; never copy a request body into it. */
export function withActivityActor<T>(actor:ActivityActor,action:()=>T):T{
 if(!actor||!['web','mcp','system'].includes(actor.channel)||Object.keys(actor).some(k=>!['userId','userDisplayName','teamId','channel','clientId','correlationId','requestId','dataRootId'].includes(k)))throw new TypeError('无效的操作记录身份上下文')
 for(const [key,value] of Object.entries(actor))if(key!=='channel'&&value!==undefined&&(typeof value!=='string'||!value.trim()||value.length>(key==='userDisplayName'?160:256)||/[\u0000-\u001f]/.test(value)))throw new TypeError('无效的操作记录身份字段')
 if(actor.channel!=='system'&&(!actor.userId||!actor.teamId))throw new TypeError('用户操作必须绑定权威账号和团队')
 return storage.run(Object.freeze({...actor}),action)
}
export function currentActivityActor():Readonly<ActivityActor>{return storage.getStore()??Object.freeze({channel:'system' as const})}
