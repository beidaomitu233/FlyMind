import type {DiagramContent} from '../../src/drawing/core/model'
import {requireDrawingQuality,DrawingQualityError,type DrawingQuality,type EditIntent} from '../../src/drawing/core/drawing-quality'
import {StoreError} from '../store'

export class NativeQualityError extends StoreError {
  constructor(readonly quality:DrawingQuality,message='AI 修改新增或加重了内容质量问题'){super(message,422,undefined,'QUALITY_FAILED')}
}
/** Same AI policy as legacy MCP. Manual editor/create/import remain structural. */
export function requireNativeAIQuality(next:DiagramContent,before?:DiagramContent,intent:EditIntent='structure'){
  try{return requireDrawingQuality(next,before,intent)}catch(error){
    if(error instanceof DrawingQualityError)throw new NativeQualityError(error.quality,error.message)
    throw error
  }
}
