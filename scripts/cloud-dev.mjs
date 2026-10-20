// Explicit source development entry. Never invoked by the released local CLI.
import {register} from 'tsx/esm/api'
register()
try{await import('../server/cloud/start.ts')}catch(error){console.error(error instanceof Error?error.message:'Cloud start failed');process.exitCode=1}
