// Read-only acceptance for switching an existing workspace. Never creates diagrams.
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'

const [mode,rootArgument,outputArgument]=process.argv.slice(2)
assert.ok(['snapshot','verify'].includes(mode)&&rootArgument&&outputArgument,'snapshot|verify DATA_ROOT OUTPUT')
const root=resolve(rootArgument),output=resolve(outputArgument),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
function inspect(){
 const db=new Database(join(root,'flymind.sqlite'),{readonly:true,fileMustExist:true})
 try{
  assert.equal(db.prepare("SELECT value FROM metadata WHERE key='initialized'").get()?.value,'1','Existing workspace must already be initialized')
  const identity=db.prepare("SELECT value FROM metadata WHERE key='native_workspace_id'").get()?.value
  assert.ok(identity,'Existing native workspace identity required')
  const rows=db.prepare('SELECT * FROM diagrams ORDER BY id').all(),active=rows.filter(r=>r.deleted_at===null)
  const native=active.filter(r=>JSON.parse(r.document).schemaVersion===3)
  assert.ok(native.length>0,'Refuse an empty/non-native workspace')
  const hashes={identity:digest(identity)}
  for(const table of ['diagrams','diagram_versions','workspace_groups','diagram_tombstones'])hashes[table]=digest(db.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all())
  return {rows,active,native,summary:{root,hashes,counts:{all:rows.length,active:active.length,native:native.length,history:db.prepare('SELECT COUNT(*) n FROM diagram_versions').get().n,groups:db.prepare('SELECT COUNT(*) n FROM workspace_groups').get().n}}}
 }finally{db.close()}
}
await mkdir(output,{recursive:true})
const before=inspect()
if(mode==='snapshot'){
 await writeFile(join(output,'workspace-before.json'),JSON.stringify(before.summary,null,2))
 console.log(JSON.stringify({ok:true,mode,counts:before.summary.counts}));process.exit(0)
}
const baseline=JSON.parse(await readFile(join(output,'workspace-before.json'),'utf8'))
assert.deepEqual(before.summary,baseline,'Workspace changed before read-only smoke; inspect before proceeding')
const config=JSON.parse(await readFile(join(output,'registration-after.json'),'utf8'))
assert.equal(config.enabled,true);assert.equal(config.transport.type,'stdio')
assert.equal(resolve(config.transport.env.FLYMIND_DATA_DIR),root)
assert.ok(config.transport.args.some(a=>/bin[\\/]flymind\.mjs$/i.test(a)))
assert.ok(config.transport.args.includes('mcp'))
let stderr='',client,transport
const report={startedAt:new Date().toISOString(),readOnly:true,counts:baseline.counts}
try{
 transport=new StdioClientTransport({command:config.transport.command,args:config.transport.args,cwd:config.transport.cwd||process.cwd(),env:{...process.env,...config.transport.env},stderr:'pipe'})
 transport.stderr?.on('data',b=>stderr+=b)
 client=new Client({name:'existing-workspace-read-only-acceptance',version:'1'})
 await client.connect(transport)
 const call=async(name,args={})=>{const value=await client.callTool({name,arguments:args});assert.ok(!value.isError,JSON.stringify(value));return value.structuredContent}
 const guide=await call('get_drawing_guide')
 assert.equal(guide.standardVersion,'1.1');assert.ok(guide.guide.includes('FlyMind native pilot'))
 assert.deepEqual([...guide.capabilities.supportedKinds].sort(),['architecture','dataflow','flowchart','mindmap','swimlane'].sort())
 const listed=await call('list_diagrams')
 assert.deepEqual(listed.diagrams.map(d=>d.diagramId).sort(),before.active.map(d=>d.id).sort())
 const row=before.native.find(r=>JSON.parse(r.document).content)
 assert.ok(row)
 const value=await call('get_diagram',{id:row.id})
 assert.equal(value.revision,row.revision);assert.deepEqual(value.content,JSON.parse(row.document).content)
 assert.deepEqual(inspect().summary,baseline,'Read-only MCP must preserve content, revisions, history, groups and identity')
 Object.assign(report,{ok:true,standardVersion:guide.standardVersion,nativePilot:true,supportedKinds:guide.capabilities.supportedKinds,existingListMatches:true,existingContentAndRevisionMatch:true,workspaceUnchanged:true,studioURL:'http://127.0.0.1:5189/#/native'})
}catch(error){report.error=error.stack;process.exitCode=1}
finally{
 await client?.close().catch(()=>{});await transport?.close().catch(()=>{})
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await writeFile(join(output,'stderr.log'),stderr)
 console.log(JSON.stringify(report))
}
