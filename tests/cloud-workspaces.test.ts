import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer,type Server} from 'node:http'
import {mkdtemp,readdir,rm,mkdir,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {CloudControlPlane,type CloudPrincipal,CloudAccessError} from '../server/cloud/identity'
import {CloudTeamWorkspaces,cloudRequestId} from '../server/cloud/team-workspaces'
import {businessContent} from './fixtures/native-business'

const token='test_application_session_0123456789abcdef'
function principal(teamId='team-a',role:CloudPrincipal['team']['role']='editor',userId='alice'):CloudPrincipal{
  return {user:{id:userId,name:userId},session:{id:'session-'+userId,expiresAt:Date.now()+60_000},team:{id:teamId,name:teamId,role}}
}
async function identityServer(){
  let result:{status:number;body:unknown}={status:200,body:{code:200,message:'ok',data:principal()}}
  const requests:Array<{url:string;authorization?:string;body:unknown}>=[]
  const server=createServer(async(req,res)=>{
    let raw='';for await(const data of req)raw+=data
    requests.push({url:req.url!,authorization:req.headers.authorization,body:JSON.parse(raw)})
    res.writeHead(result.status,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body))
  })
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
  const address=server.address() as {port:number}
  return {base:'http://127.0.0.1:'+address.port,requests,set(value:typeof result){result=value},close:()=>stop(server)}
}
async function stop(server:Server){const closing=new Promise<void>(r=>server.close(()=>r()));server.closeAllConnections();await closing}
function hasCode(code:string){return (error:unknown)=>error instanceof CloudAccessError&&error.code===code}
async function temporary(){return mkdtemp(join(tmpdir(),'flymind-cloud-test-'))}
async function cleanup(root:string){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('flymind-cloud-test-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}

test('control-plane client authenticates each request and refuses revoked, mismatched, expired and malformed authority responses',async()=>{
  const s=await identityServer()
  try{
    const identity=new CloudControlPlane(s.base,{allowInsecureLoopback:true})
    assert.equal((await identity.authorize(token,'team-a','diagram:write')).user.id,'alice')
    assert.deepEqual(s.requests[0],{url:'/app/flymind/session/introspect',authorization:'Bearer '+token,body:{teamId:'team-a'}})
    s.set({status:403,body:{message:'removed'}})
    await assert.rejects(identity.authorize(token,'team-a','diagram:read'),hasCode('TEAM_ACCESS_DENIED'))
    assert.equal(s.requests.length,2,'membership is not cached after first access')
    s.set({status:200,body:{code:200,data:principal('team-b')}})
    await assert.rejects(identity.authorize(token,'team-a','diagram:read'),hasCode('TEAM_ACCESS_DENIED'))
    const expired=principal();expired.session.expiresAt=1
    s.set({status:200,body:{code:200,data:expired}})
    await assert.rejects(identity.authorize(token,'team-a','diagram:read'),hasCode('LOGIN_REQUIRED'))
    s.set({status:200,body:{code:401,data:principal()}})
    await assert.rejects(identity.authorize(token,'team-a','diagram:read'),hasCode('IDENTITY_INVALID_RESPONSE'))
    s.set({status:503,body:{message:'private internal detail'}})
    await assert.rejects(identity.authorize(token,'team-a','diagram:read'),hasCode('IDENTITY_UNAVAILABLE'))
    await assert.rejects(identity.authorize('invalid','team-a','diagram:read'),hasCode('LOGIN_REQUIRED'))
    await assert.rejects(identity.authorize(token,'../escape','diagram:read'),hasCode('INVALID_TEAM'))
    assert.equal(s.requests.length,6,'invalid local inputs never reach the control plane')
  }finally{await s.close()}
})

test('identity endpoint is fixed to an administrator-configured origin; insecure remote endpoints are refused',()=>{
  for(const url of ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com/?key=x']){
    assert.throws(()=>new CloudControlPlane(url,{allowInsecureLoopback:true}))
  }
  assert.throws(()=>new CloudControlPlane('http://127.0.0.1:9999'))
  assert.doesNotThrow(()=>new CloudControlPlane('https://identity.example.com'))
})

test('team stores isolate identical IDs, member mutation keys, trash and restart state without legacy samples',async()=>{
  const root=await temporary()
  let checks=0
  const identities={async authorize(_token:string,id:string){checks++;return principal(id)}}
  const registry=new CloudTeamWorkspaces(root,identities)
  try{
    const created=await Promise.all(['team-a','team-b'].map(team=>registry.run(token,team,'diagram:write',async(ws,actor)=>{
      assert.deepEqual(await ws.store.listStored(),[])
      const content=businessContent('flowchart','shared-id');content.title='Flow '+team
      const record=await ws.diagrams.createAI({taskName:'回归测试任务',content,requestId:cloudRequestId(actor,'create')},ws.dataRootId)
      return {identity:ws.dataRootId,title:record.document.content.title,path:ws.store.root}
    })))
    assert.notEqual(created[0].identity,created[1].identity)
    assert.notEqual(created[0].path,created[1].path)
    assert.equal(created[0].title,'Flow team-a')
    assert.equal(created[1].title,'Flow team-b')
    assert.match(created[0].path,/[\\/]teams[\\/][0-9a-f]{64}$/)
    const a=principal(),b=principal('team-a','editor','bob')
    assert.notEqual(cloudRequestId(a,'reused-key'),cloudRequestId(b,'reused-key'))
    const aSecondDevice=principal();aSecondDevice.session.id='second-device'
    assert.equal(cloudRequestId(a,'reused-key'),cloudRequestId(aSecondDevice,'reused-key'))
    await registry.run(token,'team-a','diagram:write',async ws=>{await ws.diagrams.organize('delete','shared-id',{expectedRevision:1},ws.dataRootId)})
    await registry.run(token,'team-b','diagram:read',async ws=>{assert.equal((await ws.diagrams.get('shared-id')).document.content.title,'Flow team-b');assert.deepEqual(await ws.diagrams.trash(),[])})
    registry.close()
    const restarted=new CloudTeamWorkspaces(root,identities)
    try{await restarted.run(token,'team-a','workspace:read',async ws=>{assert.equal((await ws.diagrams.trash()).length,1);assert.equal((await ws.diagrams.list()).length,0)})}finally{restarted.close()}
    assert.equal(checks,5)
  }finally{registry.close();await cleanup(root)}
})

test('viewer write, invalid team and revoked identity are rejected before any workspace is initialized',async()=>{
  const root=await temporary()
  const registry=new CloudTeamWorkspaces(root,{async authorize(_token,id){return principal(id,'viewer')}})
  try{
    await assert.rejects(registry.run(token,'team-a','diagram:write',async()=>assert.fail('must not open')),hasCode('PERMISSION_DENIED'))
    await assert.rejects(registry.run(token,'../../elsewhere','diagram:read',async()=>assert.fail('must not open')),hasCode('INVALID_TEAM'))
    assert.deepEqual(await readdir(root),[])
    const revoked=new CloudTeamWorkspaces(root,{async authorize(){throw new CloudAccessError(401,'LOGIN_REQUIRED','revoked')}})
    try{await assert.rejects(revoked.run(token,'team-a','diagram:read',async()=>assert.fail('must not open')),hasCode('LOGIN_REQUIRED'))}finally{revoked.close()}
    assert.deepEqual(await readdir(root),[])
  }finally{registry.close();await cleanup(root)}
})

test('workspace registry has a bounded active-team capacity and reuses one initialization for concurrent team requests',async()=>{
  const root=await temporary(),registry=new CloudTeamWorkspaces(root,{async authorize(_token,id){return principal(id)}},{maxOpenTeams:1})
  let release!:()=>void
  const blocked=new Promise<void>(r=>{release=r})
  let ready!:()=>void
  const entered=new Promise<void>(r=>{ready=r})
  const first=registry.run(token,'team-a','diagram:read',async ws=>{ready();await blocked;return ws.dataRootId})
  try{
    await entered
    await assert.rejects(registry.run(token,'team-b','diagram:read',async()=>assert.fail()),hasCode('WORKSPACE_CAPACITY'))
    const same=await registry.run(token,'team-a','diagram:read',async ws=>ws.dataRootId)
    release();assert.equal(await first,same)
    assert.notEqual(await registry.run(token,'team-b','diagram:read',async ws=>ws.dataRootId),same)
  }finally{release();await first;registry.close();await cleanup(root)}
})

test('configured symbolic cloud root is refused before writes, matching durable recovery policy',async()=>{
  const root=await temporary(),target=join(root,'actual'),link=join(root,'cloud-link')
  await mkdir(target);await symlink(target,link,process.platform==='win32'?'junction':'dir')
  const registry=new CloudTeamWorkspaces(link,{async authorize(_token,id){return principal(id)}})
  try{
    await assert.rejects(registry.run(token,'team-a','diagram:read',async()=>assert.fail('must not open')),hasCode('WORKSPACE_PATH_INVALID'))
    assert.deepEqual(await readdir(target),[])
  }finally{registry.close();await cleanup(root)}
})
