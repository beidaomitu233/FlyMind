// Narrow D05 recovery: one real STDIO process survives owned Runtime replacement.
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {ensureNativeRuntime,requestNativeRuntimeShutdown} from '../../server/runtime-instance/client.ts'
import {extractContent} from '../../src/drawing/core/layers.ts'
import {sampleFor} from '../../src/drawing/core/samples.ts'
import Database from 'better-sqlite3'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep,basename} from 'node:path'
import assert from 'node:assert/strict'
const root=await mkdtemp(join(tmpdir(),'flymind-mcp-recovery-')),out=resolve('output/playwright/native-mcp-recovery');await mkdir(out,{recursive:true})
const env={...process.env,FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:join(root,'data'),FLYMIND_PRIVATE_RUNTIME_DIR:join(root,'runtime'),FLYMIND_PORT:'0'},runtimeOptions={env,dataRoot:env.FLYMIND_DATA_DIR,privateRuntimeRoot:env.FLYMIND_PRIVATE_RUNTIME_DIR,port:0},result={checks:{},failures:[]};let control,client,transport,stderr=''
async function stop(){if(!control)return;const current=control;await requestNativeRuntimeShutdown(current);const deadline=Date.now()+15000;let exited=false;while(Date.now()<deadline){try{await fetch(current.baseURL+'/studio-api/health',{signal:AbortSignal.timeout(500)})}catch{exited=true;break}await new Promise(r=>setTimeout(r,100))}assert.ok(exited,'owned Runtime stopped');await current.close();control=undefined}
const errorOf=r=>JSON.parse(r.content[0].text).error
const counts=()=>{const db=new Database(join(env.FLYMIND_DATA_DIR,'flymind.sqlite'),{readonly:true});try{return {versions:db.prepare('SELECT count(*) n FROM diagram_versions').get().n,receipts:db.prepare('SELECT count(*) n FROM native_mutation_requests').get().n,diagrams:db.prepare('SELECT count(*) n FROM diagrams').get().n}}finally{db.close()}}
try{
 control=await ensureNativeRuntime(runtimeOptions);const originalInstance=control.instanceId,originalRoot=control.dataRootId
 transport=new StdioClientTransport({command:process.execPath,args:['server/start.mjs'],cwd:process.cwd(),env:Object.fromEntries(Object.entries(env).filter(([,v])=>typeof v==='string')),stderr:'pipe'});transport.stderr?.on('data',chunk=>stderr+=chunk);client=new Client({name:'mcp-recovery-probe',version:'1'});await client.connect(transport);const mcpPid=transport.pid
 const content={...extractContent(sampleFor('swimlane')),id:'recovery-create',title:'故障恢复验证'},args={name:'create_diagram',arguments:{content,requestId:'same-create-request'}}
 const created=await client.callTool(args);assert.equal(created.isError,undefined);assert.equal(created.structuredContent.revision,1);const initialCounts=counts();result.checks.initialSaved=true
 await stop();const first=await client.callTool(args);assert.equal(first.isError,true);assert.equal(errorOf(first).code,'RUNTIME_CONNECTION_LOST');assert.match(errorOf(first).message,/requestId/);assert.deepEqual(counts(),initialCounts);result.checks.firstFailureNoAutomaticReplay=true
 const retry=await client.callTool(args);control=await ensureNativeRuntime(runtimeOptions);assert.notEqual(control.instanceId,originalInstance);assert.equal(control.dataRootId,originalRoot);assert.equal(retry.isError,undefined);assert.equal(retry.structuredContent.revision,1);assert.equal(retry.structuredContent.diagramId,content.id);assert.equal(retry.structuredContent.jobId,created.structuredContent.jobId);assert.deepEqual(counts(),initialCounts);assert.equal(transport.pid,mcpPid);result.checks.sameMcpSameKeyRestartsRuntimeWithoutDuplicate=true
 await stop();const db=new Database(join(env.FLYMIND_DATA_DIR,'flymind.sqlite'));try{assert.equal(db.prepare("UPDATE metadata SET value=? WHERE key='native_workspace_id'").run(randomUUID()).changes,1)}finally{db.close()}
 control=await ensureNativeRuntime(runtimeOptions);assert.notEqual(control.dataRootId,originalRoot);const replacedInstance=control.instanceId,changedCounts=counts()
 const beforeRebind=await client.callTool(args);assert.equal(beforeRebind.isError,true);assert.equal(errorOf(beforeRebind).code,'RUNTIME_CONNECTION_LOST')
 const refused=await client.callTool(args);assert.equal(refused.isError,true);assert.equal(errorOf(refused).code,'WORKSPACE_MISMATCH');assert.deepEqual(counts(),changedCounts);assert.equal(transport.pid,mcpPid);result.checks.samePathNewWorkspaceRejectedNoWrite=true
 const still=await client.callTool({name:'get_diagram',arguments:{id:content.id}});assert.equal(errorOf(still).code,'WORKSPACE_MISMATCH');result.checks.bindingRemainsOriginal=true
 result.instances={original:originalInstance,replaced:replacedInstance};result.ok=true
}catch(error){result.ok=false;result.failures.push({message:error.message,stack:error.stack});process.exitCode=1}
finally{await client?.close().catch(()=>{});await stop();result.shutdown='graceful-exited';result.mcpStderr=stderr;if(result.ok){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&basename(root).startsWith('flymind-mcp-recovery-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});result.tempCleaned=true}else result.temporaryRoot=root;await writeFile(join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))}
