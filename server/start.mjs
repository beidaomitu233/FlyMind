import { register } from 'tsx/esm/api'
register()
await import(process.argv.includes('--runtime')?'./runtime.ts':'./mcp.ts')
