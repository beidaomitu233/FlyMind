export const ONBOARDING_STEPS=['create','connect','alternate','team'] as const
export type OnboardingStep=typeof ONBOARDING_STEPS[number]
export type OnboardingStatus='pending'|'completed'|'skipped'
export interface OnboardingProgress {seen:boolean;step:OnboardingStep;diagramId?:string;steps:Record<OnboardingStep,OnboardingStatus>}
export const cloudOnboardingKey=(userId:string,teamId:string)=>JSON.stringify([userId,teamId])
export function emptyOnboarding():OnboardingProgress{return {seen:false,step:'create',steps:{create:'pending',connect:'pending',alternate:'pending',team:'pending'}}}
export function readOnboarding(key:string,storage:Pick<Storage,'getItem'>):OnboardingProgress{
 try{const value=JSON.parse(storage.getItem('flymind.onboarding.v1:'+key)??'null');if(!value||typeof value.seen!=='boolean'||!ONBOARDING_STEPS.includes(value.step)||!value.steps||ONBOARDING_STEPS.some(step=>!['pending','completed','skipped'].includes(value.steps[step]))||value.diagramId!==undefined&&typeof value.diagramId!=='string')return emptyOnboarding();return {seen:value.seen,step:value.step,steps:{...value.steps},...(value.diagramId?{diagramId:value.diagramId}:{})}}catch{return emptyOnboarding()}
}
export function writeOnboarding(key:string,value:OnboardingProgress,storage:Pick<Storage,'setItem'>){storage.setItem('flymind.onboarding.v1:'+key,JSON.stringify(value))}
export function finishOnboardingStep(value:OnboardingProgress,step:OnboardingStep,status:'completed'|'skipped'):OnboardingProgress{
 const steps={...value.steps,[step]:value.steps[step]==='completed'?'completed':status},next=ONBOARDING_STEPS.find(item=>steps[item]==='pending')??step
 return {...value,seen:true,steps,step:next}
}
export function skipRemainingOnboarding(value:OnboardingProgress):OnboardingProgress{let next={...value,seen:true};for(const step of ONBOARDING_STEPS)if(next.steps[step]==='pending')next=finishOnboardingStep(next,step,'skipped');return next}
interface EditEvidence {diagramId?:string;fromRevision?:number;toRevision?:number;actor:{channel:string;userId?:string}}
/** Server committed revisions only; opens, copies and local dirty drafts do not count. */
export function hasAlternatingEdits(events:EditEvidence[],diagramId:string,userId:string){
 const edits=events.filter(e=>e.diagramId===diagramId&&typeof e.fromRevision==='number'&&e.fromRevision>=1&&typeof e.toRevision==='number'&&e.toRevision>e.fromRevision)
 return edits.some(h=>h.actor.channel==='web'&&h.actor.userId===userId&&edits.some(ai=>ai.actor.channel==='mcp'&&ai.toRevision!==h.toRevision))
}
