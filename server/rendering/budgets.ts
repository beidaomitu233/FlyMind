import {NativeRenderError} from './types'
export const RENDER_BUDGET={timeoutMs:60000,maxDimension:16384,maxPixels:32_000_000,minActualScale:.01,maxPNGBytes:32*1024*1024,maxSVGBytes:96*1024*1024,maxMessageBytes:160*1024*1024,maxJobs:2} as const
export function exportScale(width:number,height:number,requested=1,border=8){
 if(!Number.isFinite(requested)||requested<.1||requested>4)throw new NativeRenderError('INVALID_SCALE','scale 必须为 0.1–4')
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||Math.max(width,height)>1_000_000)throw new NativeRenderError('DIMENSION_BUDGET','图形范围无效或过大')
 const w=width+2*border,h=height+2*border,limit=Math.min(requested,RENDER_BUDGET.maxDimension/w,RENDER_BUDGET.maxDimension/h,Math.sqrt(RENDER_BUDGET.maxPixels/(w*h))),scale=limit<requested?limit*.999:requested
 if(scale<RENDER_BUDGET.minActualScale)throw new NativeRenderError('DIMENSION_BUDGET','最低比例仍无法满足尺寸/像素预算')
 return Math.min(requested,scale)
}
