import type {HeavyRequest,HeavyReply} from './protocol'
import {heavyFailure} from './protocol'
/** Fixed operations only. This process never opens an application DB or browser. */
process.once('message',async(message:HeavyRequest)=>{
 let reply:HeavyReply
 try{
  const input=message.input as any
  let value:unknown
  switch(message.operation){
   case 'compile':value=await(await import('../../src/drawing/engine/drawio')).compileDrawio(input.content,input.options);break
   case 'patch':value=await(await import('../../src/drawing/engine/drawio')).patchDrawio(input.base,input.operations);break
   case 'configure':value=await(await import('../../src/drawing/engine/drawio')).configureDrawio(input.base,input.changes);break
   case 'normalize':value=await(await import('../../src/drawing/engine/drawio')).normalizeDrawioEdits(input.xml,input.base);break
   case 'svg-fonts':value=await(await import('./svg')).packageSVGCPU(input);break
   case 'svg-metadata':value=await(await import('./svg')).inspectSVGCPU(input);break
   default:throw Object.assign(Error('未知绘图任务'),{code:'HEAVY_WORK_INVALID'})
  }
  reply={ok:true,value}
 }catch(error){reply=heavyFailure(error)}
 process.send?.(reply,()=>{process.disconnect?.();process.exit(0)})
})
