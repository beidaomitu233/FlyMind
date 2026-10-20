import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {cliEnvironment,packageRoot,resourceKey} from '../bin/flymind.mjs'
const node=(file,args=[],env=process.env)=>spawnSync(process.execPath,[resolve(packageRoot,file),...args],{cwd:tmpdir(),env,encoding:'utf8',windowsHide:true,shell:false,timeout:20000})
test('installed CLI paths are persistent user scope and independent of cwd and package location',()=>{
 const env=cliEnvironment({LOCALAPPDATA:join(tmpdir(),'flymind-cli-home')})
 assert.equal(env.FLYMIND_NATIVE_PILOT,'1');assert.equal(env.FLYMIND_PORT,'0')
 assert.equal(env.FLYMIND_DATA_DIR,join(tmpdir(),'flymind-cli-home','FlyMind','data'))
 assert.equal(env.FLYMIND_RESOURCES_DIR,join(tmpdir(),'flymind-cli-home','FlyMind','resources',resourceKey))
 const custom=cliEnvironment({FLYMIND_DATA_DIR:join(tmpdir(),'explicit-data'),FLYMIND_RESOURCES_DIR:join(tmpdir(),'explicit-assets'),FLYMIND_PRIVATE_RUNTIME_DIR:join(tmpdir(),'explicit-private'),FLYMIND_PORT:'5199'})
 assert.equal(custom.FLYMIND_DATA_DIR,join(tmpdir(),'explicit-data'));assert.equal(custom.FLYMIND_RESOURCES_DIR,join(tmpdir(),'explicit-assets'));assert.equal(custom.FLYMIND_PORT,'5199')
})
test('CLI help/version need no resources, stdout is empty for missing-resource MCP errors',async()=>{
 const version=node('bin/flymind.mjs',['--version']);assert.equal(version.status,0);assert.equal(version.stdout.trim(),'1.0.0')
 const root=await mkdtemp(join(tmpdir(),'flymind-cli-test-'))
 try{const result=node('bin/flymind.mjs',['mcp'],{...process.env,LOCALAPPDATA:root,FLYMIND_RESOURCES_DIR:join(root,'missing')});assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/LOCAL_AUTH_CONFIGURATION_REQUIRED|v1.1必须配置可信授权控制面|UNSUPPORTED_PLATFORM/);assert.doesNotMatch(result.stderr,/Cannot find package 'tsx'/)}finally{await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100})}
})
test('fixed bundled font install is repeatable outside the package and leaves no installer lock',async()=>{
 const root=await mkdtemp(join(tmpdir(),'flymind-font-install-'))
 try{for(let i=0;i<2;i++){const result=node('scripts/setup-drawio-runtime.mjs',[`--resources-root=${root}`,'--only-fonts']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).components.font,true)}assert.equal((await readFile(join(root,'fonts','NotoSansCJKsc-Regular.otf'))).length,16437364);const {stat}=await import('node:fs/promises');await assert.rejects(stat(join(root,'.setup.lock')),e=>e.code==='ENOENT')}finally{await rm(root,{recursive:true,force:true,maxRetries:4,retryDelay:100})}
})
test('compiled package resolves its actual root and loads the engine without the source loader',()=>{
 const result=spawnSync(process.execPath,['--input-type=module','-e',`const p=await import(${JSON.stringify(new URL('../lib/server/package-paths.js',import.meta.url).href)});const e=await import(${JSON.stringify(new URL('../lib/src/drawing/engine/drawio/index.js',import.meta.url).href)});console.log(JSON.stringify({root:p.PACKAGE_ROOT,compile:typeof e.compileDrawio}));`],{cwd:tmpdir(),encoding:'utf8',windowsHide:true,shell:false,timeout:15000})
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{root:packageRoot,compile:'function'})
})
