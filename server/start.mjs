import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const compiled=existsSync(fileURLToPath(new URL('../lib/server/mcp.js',import.meta.url))),base=compiled?new URL('../lib/server/',import.meta.url):new URL('./',import.meta.url),extension=compiled?'.js':'.ts'
if(!compiled){const {register}=await import('tsx/esm/api');register()}
try{await import(new URL((process.argv.includes('--runtime')?'runtime':'mcp')+extension,base).href)}
catch(error){
  if(process.argv.includes('--runtime')){const {cleanupRuntimeBoot}=await import(new URL('runtime-instance/boot'+extension,base).href);await cleanupRuntimeBoot();process.send?.({type:'flymind-runtime-error',code:typeof error?.code==='string'?error.code:'STARTUP_FAILED'})}
  console.error(error instanceof Error?error.message:'FlyMind startup failed');process.exitCode=1
}
