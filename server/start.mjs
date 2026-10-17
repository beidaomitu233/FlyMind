import { register } from 'tsx/esm/api'
register()
try{await import(process.argv.includes('--runtime')?'./runtime.ts':'./mcp.ts')}
catch(error){
  if(process.argv.includes('--runtime')){const {cleanupRuntimeBoot}=await import('./runtime-instance/boot.ts');await cleanupRuntimeBoot();process.send?.({type:'flymind-runtime-error',code:typeof error?.code==='string'?error.code:'STARTUP_FAILED'})}
  console.error(error instanceof Error?error.message:'FlyMind startup failed');process.exitCode=1
}
