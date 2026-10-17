#!/usr/bin/env node
import {access,mkdir,readFile} from 'node:fs/promises'
import {dirname,resolve,join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {homedir} from 'node:os'
import {spawn} from 'node:child_process'
export const packageRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export const resourceKey='drawio-31.5.3-browser-1234-font-2c76254f6fc3'
export function cliEnvironment(env=process.env){
 const userRoot=join(env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'FlyMind')
 return {...env,FLYMIND_NATIVE_PILOT:'1',FLYMIND_DATA_DIR:resolve(env.FLYMIND_DATA_DIR||join(userRoot,'data')),FLYMIND_PRIVATE_RUNTIME_DIR:resolve(env.FLYMIND_PRIVATE_RUNTIME_DIR||join(userRoot,'runtime')),FLYMIND_RESOURCES_DIR:resolve(env.FLYMIND_RESOURCES_DIR||join(userRoot,'resources',resourceKey)),FLYMIND_PORT:env.FLYMIND_PORT||'0'}
}
function run(file,args,env,{timeout=600000}={}){return new Promise((yes,no)=>{
 const child=spawn(process.execPath,[file,...args],{cwd:packageRoot,env,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});let ended=false,failure
 // Never forward installer stdout to an MCP transport.
 child.stdout.on('data',b=>process.stderr.write(b));child.stderr.on('data',b=>process.stderr.write(b))
 const stop=message=>{if(ended||failure)return;failure=Error(message);if(child.pid){if(process.platform==='win32'){const killer=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,shell:false});const limit=setTimeout(()=>{killer.kill();child.kill()},5000);killer.once('error',()=>{clearTimeout(limit);child.kill()});killer.once('close',()=>clearTimeout(limit))}else child.kill()}}
 const interrupt=()=>stop('SETUP_INTERRUPTED: rerun flymind setup to resume'),timer=setTimeout(()=>stop('SETUP_TIMEOUT: rerun flymind setup to resume'),timeout)
 process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt)
 const cleanup=()=>{ended=true;clearTimeout(timer);process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt)}
 child.once('error',e=>{cleanup();no(e)});child.once('close',code=>{cleanup();failure?no(failure):code===0?yes():no(Error(`SETUP_FAILED (${code}); rerun flymind setup`))})
})}
export async function main(args=process.argv.slice(2)){
 if(args[0]==='--help'||args[0]==='-h'){console.log('flymind [mcp|setup|doctor|studio]\nWindows only. mcp is the default. Persistent data and resources use LOCALAPPDATA/FlyMind.');return}
 if(args[0]==='--version'){console.log(JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8')).version);return}
 const command=args[0]||'mcp';if(!['mcp','setup','doctor','studio'].includes(command))throw Error('Unknown command; use flymind --help')
 if(process.platform!=='win32')throw Error('UNSUPPORTED_PLATFORM: this release supports Windows only')
 if(args.slice(1).some(a=>!a.startsWith('--archive=')&&!a.startsWith('--license=')))throw Error('Unsupported CLI option')
 const env=cliEnvironment();Object.assign(process.env,env)
 const compiled=await import(pathToFileURL(join(packageRoot,'lib/server/rendering/assets.js')).href)
 const setup=()=>run(join(packageRoot,'scripts/setup-drawio-runtime.mjs'),[`--resources-root=${env.FLYMIND_RESOURCES_DIR}`,...args.slice(1)],env)
 if(command==='setup'){await setup();return}
 if(command==='doctor'){await compiled.checkRuntimeAssets();console.error(JSON.stringify({ok:true,platform:process.platform,node:process.version,packageRoot,dataRoot:env.FLYMIND_DATA_DIR,resourcesRoot:env.FLYMIND_RESOURCES_DIR,browser:compiled.resolveRuntimeAssets().browserExecutable}));return}
 try{await compiled.checkRuntimeAssets()}catch(error){if(!['DRAWIO_MISSING','FONT_MISSING','FONT_LICENSE_MISSING','BROWSER_MISSING'].includes(error.code))throw error;throw Error('RUNTIME_SETUP_REQUIRED: 请先运行 npx -y flymind-drawing-studio@1 setup，再启动 '+command+'。'+error.message)}
 if(command==='mcp'){await import(pathToFileURL(join(packageRoot,'lib/server/mcp.js')).href);return}
 const {ensureNativeRuntime}=await import(pathToFileURL(join(packageRoot,'lib/server/runtime-instance/client.js')).href),connection=await ensureNativeRuntime()
 // explorer.exe opens the authenticated same-origin bootstrap UI, without a shell.
 const url=connection.baseURL+'/#/native',opener=spawn('explorer.exe',[url],{stdio:'ignore',windowsHide:true,shell:false});opener.on('error',e=>console.error('Open this URL in your browser: '+url+' ('+e.message+')'));opener.unref();console.error('FlyMind Studio: '+url);await connection.close()
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1})
