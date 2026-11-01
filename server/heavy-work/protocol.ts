export type HeavyOperation='compile'|'patch'|'configure'|'normalize'|'svg-fonts'|'svg-metadata'
export interface HeavyRequest {operation:HeavyOperation;input:unknown}
export type HeavyReply={ok:true;value:unknown}|{ok:false;error:{code:string;message:string;status?:number}}
export function heavyFailure(error:unknown):HeavyReply{
 const e=error as {name?:string;code?:string;message?:string;status?:number},prefix=/^([A-Z][A-Z0-9_]{2,63}):\s/.exec(e?.message??'')?.[1]
 const enginePrefix=prefix?.includes('_')&&!prefix.startsWith('ERR_')?prefix:undefined
 const known=enginePrefix??(e?.code&&(/^(?:ROUTING_|NATIVE_|UNSUPPORTED_|INVALID_|SVG_|FONT_|OUTPUT_|DIMENSION_)/.test(e.code)||e.name==='NativeRenderError')?e.code:undefined)
 return {ok:false,error:{code:known??'HEAVY_ENGINE_FAILED',message:known?(e.message??'绘图计算失败').slice(0,2000):'绘图子进程计算失败，未提交新修订',...(known&&e.status?{status:e.status}:{})}}
}
export class HeavyWorkError extends Error {
 readonly status=503
 constructor(readonly code:string,message:string){super(message);this.name='HeavyWorkError'}
}
