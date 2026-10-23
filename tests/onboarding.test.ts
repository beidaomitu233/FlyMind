import test from 'node:test'
import assert from 'node:assert/strict'
import {cloudOnboardingKey,emptyOnboarding,readOnboarding,writeOnboarding,finishOnboardingStep,skipRemainingOnboarding,hasAlternatingEdits} from '../src/drawing/state/onboarding'
test('tour preference is isolated per account and team and corrupt preferences start safely',()=>{
 const data=new Map<string,string>(),storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)}}
 const a=cloudOnboardingKey('a','team'),b=cloudOnboardingKey('b','team'),other=cloudOnboardingKey('a','other')
 writeOnboarding(a,finishOnboardingStep(emptyOnboarding(),'create','completed'),storage)
 assert.equal(readOnboarding(a,storage).steps.create,'completed');assert.equal(readOnboarding(b,storage).seen,false);assert.equal(readOnboarding(other,storage).steps.create,'pending')
 data.set('flymind.onboarding.v1:'+a,'{"seen":true}');assert.deepEqual(readOnboarding(a,storage),emptyOnboarding())
})
test('skipping is distinct from completion and never downgrades actual completion',()=>{
 const created=finishOnboardingStep(emptyOnboarding(),'create','completed'),later=skipRemainingOnboarding(created)
 assert.equal(later.steps.create,'completed');assert.equal(later.steps.connect,'skipped');assert.equal(later.steps.alternate,'skipped');assert.equal(later.steps.team,'skipped')
 assert.equal(finishOnboardingStep(later,'create','skipped').steps.create,'completed')
})
test('alternating-edit completion requires real distinct committed revisions in the same diagram and current human identity',()=>{
 const human={diagramId:'diagram',fromRevision:1,toRevision:2,actor:{channel:'web',userId:'a'}},ai={diagramId:'diagram',fromRevision:2,toRevision:3,actor:{channel:'mcp',userId:'a'}}
 assert.equal(hasAlternatingEdits([human,ai],'diagram','a'),true)
 for(const events of [[human],[ai],[human,{...ai,diagramId:'different'}],[{...human,fromRevision:0,toRevision:1},ai],[{...human,fromRevision:2},ai],[{...human,actor:{channel:'web',userId:'b'}},ai],[human,{...ai,toRevision:2,fromRevision:1}]])assert.equal(hasAlternatingEdits(events,'diagram','a'),false)
})
