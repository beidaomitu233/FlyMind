import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DrawioHostController,HOST_STARTUP_TIMEOUT_MS,HOST_PREPARATION_TIMEOUT_MS,MAX_HOST_MESSAGE_BYTES,MAX_HOST_XML_BYTES,type HostXML,type HostError} from '../src/drawing/engine/drawio-host/controller'
import {businessLibraryConfiguration,drawioHostURL} from '../src/drawing/engine/drawio-host/library'
import {hasUncommittedNativeText} from '../src/drawing/engine/drawio-host/editing'
const xml='<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>'
const collabXML='<mxfile><diagram id="live" name="page"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" parent="1" vertex="1" value="before"><mxGeometry x="20" y="20" width="100" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>'

test('cold editor startup remains pending past 30s, requires actual load, and fails at the bounded deadline',t=>{
 t.mock.timers.enable({apis:['setTimeout']})
 const h=setup();try{
  assert.equal(HOST_STARTUP_TIMEOUT_MS,90_000);assert.equal(HOST_PREPARATION_TIMEOUT_MS,100_000)
  t.mock.timers.tick(30_001);assert.equal(h.errors.length,0);assert.equal(h.ready.length,0)
  h.receive({event:'configure'});h.receive({event:'init'});assert.equal(h.ready.length,0)
  t.mock.timers.tick(59_998);assert.equal(h.errors.length,0)
  h.receive({event:'load',xml});assert.equal(h.ready.length,1)
  t.mock.timers.tick(100_000);assert.equal(h.errors.length,0)
  const stalled=setup();try{t.mock.timers.tick(90_000);assert.equal(stalled.errors[0]?.code,'STARTUP_TIMEOUT');assert.equal(stalled.ready.length,0)}finally{stalled.controller.dispose()}
 }finally{h.controller.dispose();t.mock.timers.reset()}
})
test('cloud patch enables diff sync and waits for correlated patch/reset without a document reload',async()=>{
 const h=setup({collaboration:true,initialXML:collabXML});try{
  h.boot();assert.equal(h.sent[1].diffSync,true)
  const applying=h.controller.applyRemoteXML(collabXML,collabXML.replace('value="before"','value="after"'))
  const patch=h.sent.at(-1)!;assert.equal(patch.action,'patch');assert.ok(patch.patch)
  h.receive({event:'patch',message:{...patch,message:'stale'}})
  assert.equal(h.sent.at(-1)?.action,'patch')
  h.receive({event:'patch',message:patch});await new Promise(r=>setImmediate(r))
  const reset=h.sent.at(-1)!;assert.equal(reset.action,'resetDiff')
  h.receive({event:'resetDiff',message:reset});await applying
  assert.equal(h.sent.filter(m=>m.action==='load').length,1)
  assert.equal(h.xmlEvents.length,0)
 }finally{h.controller.dispose()}
})
test('remote patch failures and dispose never report an unconfirmed patch as synchronized',async()=>{
 const h=setup({collaboration:true});try{
  h.boot();const applying=h.controller.applyRemoteXML(collabXML,collabXML.replace('value="before"','value="after"')),patch=h.sent.at(-1)!
  h.receive({event:'patch',message:patch,error:'invalid'});await assert.rejects(applying,{code:'REMOTE_PATCH_FAILED'})
  assert.equal(h.sent.filter(m=>m.action==='resetDiff').length,0)
  const pending=h.controller.applyRemoteXML(collabXML,collabXML);h.controller.dispose();await assert.rejects(pending,{code:'SESSION_CLOSED'})
 }finally{h.controller.dispose()}
})
function setup(extra:Partial<ConstructorParameters<typeof DrawioHostController>[0]>={}){
 const source={},sent:Array<Record<string,any>>=[],xmlEvents:HostXML[]=[],errors:HostError[]=[],ready:string[]=[],requests:string[]=[]
 const controller=new DrawioHostController({sessionKey:'session-a',initialXML:xml,origin:'http://localhost:5178',source:()=>source,post:(data,origin)=>{assert.equal(origin,'http://localhost:5178');sent.push(JSON.parse(data))},onReady:e=>ready.push(e.sessionKey),onXML:e=>xmlEvents.push(e),onError:e=>errors.push(e),onSaveRequested:e=>requests.push(e.reason),...extra})
 const receive=(data:unknown,origin='http://localhost:5178',from:unknown=source)=>controller.handle({data:typeof data==='string'?data:JSON.stringify(data),origin,source:from})
 const boot=()=>{receive({event:'configure'});receive({event:'init'});receive({event:'load',xml})}
 return {controller,source,sent,xmlEvents,errors,ready,requests,receive,boot}
}
test('ordered configure/init/load handshake sends initial document once; duplicate and out-of-order events cannot reload',async()=>{
 const h=setup();try{h.receive({event:'init'});h.receive({event:'load',xml});assert.equal(h.sent.length,0);await assert.rejects(h.controller.captureXML(),{code:'NOT_READY'});h.boot();assert.deepEqual(h.sent.map(m=>m.action),['configure','load']);assert.equal(h.sent[1].autosave,1);assert.equal(h.sent[1].xml,xml);assert.deepEqual(h.ready,['session-a']);h.boot();assert.equal(h.sent.length,2)}finally{h.controller.dispose()}
})
test('origin and exact source filter runs before parsing, including null sources',()=>{
 const h=setup();try{for(const origin of ['https://evil.test','null','http://localhost:5178.evil.test','http://localhost:5179'])h.receive('{',origin);h.receive({event:'configure'},undefined,{});h.receive({event:'configure'},undefined,null);assert.equal(h.errors.length,0);assert.equal(h.sent.length,0);h.boot();assert.equal(h.ready.length,1)}finally{h.controller.dispose()}
})
test('trusted malformed, non-string, array, null and oversized/UTF-8 messages reject without model events',()=>{
 const h=setup();try{for(const data of ['{','[]','null','{"event":3}',JSON.stringify({event:'save',xml:'中'.repeat(MAX_HOST_XML_BYTES/2)})])h.receive(data);h.controller.handle({origin:'http://localhost:5178',source:h.source,data:{event:'configure'}});h.receive(' '.repeat(MAX_HOST_MESSAGE_BYTES+1));assert.equal(h.xmlEvents.length,0);assert.equal(h.sent.length,0);assert.ok(h.errors.length>=6);h.boot();h.receive({event:'save',xml:'x'.repeat(MAX_HOST_XML_BYTES+1)});h.receive({event:'save',xml:[]});assert.equal(h.xmlEvents.length,0)}finally{h.controller.dispose()}
})
test('save/autosave emits session-scoped XML then intent, export capture has no persistence events',async()=>{
 const h=setup();try{h.receive({event:'save',xml});assert.equal(h.xmlEvents.length,0);h.boot();h.receive({event:'autosave',xml});h.receive({event:'save',xml});assert.deepEqual(h.xmlEvents.map(e=>[e.sessionKey,e.reason]),[['session-a','autosave'],['session-a','save']]);assert.deepEqual(h.requests,['autosave','save']);const p=h.controller.captureXML(),request=h.sent.at(-1)!;assert.deepEqual(Object.keys(request).sort(),['action','format','message']);h.receive({event:'export',format:'xml',message:request,xml});assert.equal(await p,xml);assert.equal(h.xmlEvents.length,2)}finally{h.controller.dispose()}
})
test('capture correlates nested request token and format; out-of-order concurrent replies resolve the correct promise',async()=>{
 const h=setup();try{h.boot();const a=h.controller.captureXML(),ra=h.sent.at(-1)!,b=h.controller.captureXML(),rb=h.sent.at(-1)!;assert.notEqual(ra.message,rb.message);h.receive({event:'export',format:'xml',message:ra.message,xml:'wrong'});h.receive({event:'export',format:'xml',message:{...ra,format:'svg'},xml:'wrong'});h.receive({event:'export',format:'xml',message:{...ra,message:'other-session'},xml:'wrong'});h.receive({event:'export',format:'xml',message:rb,xml:xml+'\n'});assert.equal(await b,xml+'\n');h.receive({event:'export',format:'xml',message:ra,xml});assert.equal(await a,xml)}finally{h.controller.dispose()}
})
test('malformed correlated exports reject and release pending captures',async()=>{
 const h=setup();try{h.boot();for(const response of [{format:'svg',xml},{format:'xml',xml:null},{format:'xml',xml,error:'failed'},{format:'xml',xml,error:{message:'failed'}},{format:'xml',xml:'not XML'}]){const p=h.controller.captureXML(),request=h.sent.at(-1)!;h.receive({event:'export',message:request,...response});await assert.rejects(p,{code:'CAPTURE_FAILED'})}}finally{h.controller.dispose()}
})
test('unmount closes pending requests and old-session replies never cross controllers',async()=>{
 const h=setup();h.boot();const p=h.controller.captureXML(),request=h.sent.at(-1)!;h.controller.dispose();await assert.rejects(p,{code:'SESSION_CLOSED'});h.receive({event:'save',xml});assert.equal(h.xmlEvents.length,0);await assert.rejects(h.controller.captureXML(),{code:'SESSION_CLOSED'});const next=setup({sessionKey:'session-b'});try{next.boot();const p2=next.controller.captureXML(),r2=next.sent.at(-1)!;next.receive({event:'export',message:request,format:'xml',xml});next.receive({event:'export',message:r2,format:'xml',xml});assert.equal(await p2,xml)}finally{next.controller.dispose()}
})
test('startup/request timeouts and bounded concurrent captures fail explicitly',async()=>{
 const h=setup({startupTimeoutMs:5});await new Promise(r=>setTimeout(r,15));assert.equal(h.errors[0].code,'STARTUP_TIMEOUT');h.boot();assert.equal(h.sent.length,0)
 const ready=setup({requestTimeoutMs:5});try{ready.boot();await assert.rejects(ready.controller.captureXML(),{code:'CAPTURE_TIMEOUT'});assert.equal(ready.errors.at(-1)?.code,'CAPTURE_TIMEOUT');const requests=Array.from({length:16},()=>ready.controller.captureXML().catch(e=>e.code));await assert.rejects(ready.controller.captureXML(),{code:'TOO_MANY_REQUESTS'});ready.controller.dispose();assert.deepEqual(await Promise.all(requests),Array(16).fill('SESSION_CLOSED'))}finally{ready.controller.dispose()}
})
test('public outbound action set is limited and fit is explicit',()=>{
 const h=setup();try{assert.throws(()=>h.controller.fit(),{code:'NOT_READY'});h.boot();h.controller.fit();assert.deepEqual(h.sent.map(m=>m.action),['configure','load','fit']);assert.equal(h.sent.at(-1)?.maxScale,1)}finally{h.controller.dispose()}
})
test('explicit commit invokes only native save then correlated XML capture; ordinary capture never invokes actions',async()=>{
 const h=setup();try{await assert.rejects(h.controller.commitAndCaptureXML(),{code:'NOT_READY'});h.boot();const p=h.controller.commitAndCaptureXML(),request=h.sent.at(-1)!;assert.deepEqual(h.sent.slice(-2).map(m=>[m.action,m.actionName]),[['invokeAction','save'],['export',undefined]]);h.receive({event:'save',xml});h.receive({event:'export',format:'xml',message:request,xml});assert.equal(await p,xml);assert.deepEqual(h.requests,['save']);assert.throws(()=>(h.controller as any).send('invokeAction',{actionName:'delete'}),{code:'ACTION_DENIED'});assert.throws(()=>(h.controller as any).send('merge',{xml}),{code:'ACTION_DENIED'});const normal=h.controller.captureXML(),r=h.sent.at(-1)!;h.receive({event:'export',format:'xml',message:r,xml});await normal;assert.equal(h.sent.filter(m=>m.action==='invokeAction').length,1)}finally{h.controller.dispose()}
})
test('uncommitted text DOM check is conservative on read failure and tests visible editors only',()=>{
 const doc=(editors:any[],style={display:'block',visibility:'visible'})=>({querySelectorAll:(selector:string)=>{assert.equal(selector,'.mxCellEditor');return editors},defaultView:{getComputedStyle:()=>style}} as unknown as Document)
 assert.equal(hasUncommittedNativeText(()=>null),true);assert.equal(hasUncommittedNativeText(()=>{throw Error('cross-origin')}),true);assert.equal(hasUncommittedNativeText(()=>doc([])),false);const editor={isConnected:true,getClientRects:()=>[{}]};assert.equal(hasUncommittedNativeText(()=>doc([editor])),true);assert.equal(hasUncommittedNativeText(()=>doc([editor],{display:'none',visibility:'visible'})),false);assert.equal(hasUncommittedNativeText(()=>doc([{...editor,getClientRects:()=>[]}])),false)
})
test('inline offline library has all eight visible business labels, intent metadata and no preallocated identity',()=>{
 const config=businessLibraryConfiguration(),items=config.libraries[0].entries[0].libs[0].data;assert.equal(items.length,8);for(const [i,kind] of ['task','decision','start','end','module','topic','card','note'].entries()){assert.ok(items[i].xml.includes(`fmKind="${kind}"`));assert.ok(items[i].xml.includes('fmType="node"'));assert.ok(!items[i].xml.includes('fmId='));assert.ok(items[i].xml.includes(`label="${items[i].title}"`))}assert.ok(items[7].xml.includes('text;strokeColor=none;fillColor=none;'));assert.ok(!items[7].xml.includes('#eef0ff'));assert.equal(items[7].w,240);assert.equal(items[7].h,72);const u=new URL(drawioHostURL('http://localhost:5178'));assert.equal(u.origin,'http://localhost:5178');assert.equal(u.pathname,'/drawio/index.html');assert.equal(u.searchParams.get('offline'),'1');assert.equal(u.searchParams.get('configure'),'1')
})
test('invalid initial origin/document and failed load reject without ready',()=>{
 for(const extra of [{origin:'*'},{origin:'http://localhost:5178/path'},{initialXML:''},{initialXML:'中'.repeat(MAX_HOST_XML_BYTES/2)}])assert.throws(()=>setup(extra));const h=setup();h.receive({event:'configure'});h.receive({event:'init'});h.receive({event:'load',xml:null});assert.equal(h.errors.at(-1)?.code,'INVALID_LOAD');assert.equal(h.ready.length,0);h.controller.dispose()
})
test('unknown events/incoming actions do not execute commands; post failures close the session explicitly',async()=>{
 const h=setup();try{h.receive({action:'load',xml});h.receive({event:'merge',xml});assert.equal(h.sent.length,0);h.boot();h.receive({event:'remoteInvoke',name:'anything'});h.receive({event:'configure',action:'load',xml});assert.equal(h.sent.length,2)}finally{h.controller.dispose()}
 const failed=setup({post:()=>{throw new Error('window gone')}});failed.receive({event:'configure'});assert.equal(failed.errors[0].code,'PROTOCOL_FAILURE');await assert.rejects(failed.controller.captureXML(),{code:'SESSION_CLOSED'})
})


test('native group and ungroup commit editing then capture actual XML through the fixed action whitelist',async()=>{
 const h=setup();try{
  await assert.rejects(h.controller.groupSelection(),{code:'NOT_READY'});h.boot()
  for(const ungroup of [false,true]){
   const before=h.sent.length,p=h.controller.groupSelection(ungroup),first=h.sent.at(-1)!
   assert.equal(first.action,'export');h.receive({event:'export',format:'xml',message:first,xml})
   await new Promise<void>(resolve=>setImmediate(resolve))
   const last=h.sent.at(-1)!;assert.equal(last.action,'export');assert.notEqual(last.message,first.message)
   assert.deepEqual(h.sent.slice(before).map(m=>m.action==='invokeAction'?m.actionName:m.action),['save','export',ungroup?'ungroup':'group','save','export'])
   h.receive({event:'export',format:'xml',message:last,xml:xml+'\n'});assert.equal(await p,xml+'\n')
  }
  assert.throws(()=>(h.controller as any).send('invokeAction',{actionName:'executeScript'}),{code:'ACTION_DENIED'})
 }finally{h.controller.dispose()}
})
