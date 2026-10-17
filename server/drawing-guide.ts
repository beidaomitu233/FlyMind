import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {DRAWING_STANDARD_VERSION} from '../src/drawing/core/drawing-quality'
import {PROJECT_ROOT} from './store'
export async function drawingStandard(){return readFile(join(PROJECT_ROOT,'docs/DRAWING_STANDARD.md'),'utf8')}
export async function drawingGuide(){const [guide,standard]=await Promise.all([readFile(join(PROJECT_ROOT,'docs/AI_DRAWING_GUIDE.md'),'utf8'),drawingStandard()]);return {guide:standard+'\n\n---\n\n'+guide,standardVersion:DRAWING_STANDARD_VERSION}}
