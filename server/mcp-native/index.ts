import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {ensureNativeRuntime} from '../runtime-instance/client'
import {createNativeMcpServer} from './server'
const facade=createNativeMcpServer(()=>ensureNativeRuntime())
await facade.server.connect(new StdioServerTransport())
// Detach only. Shared Runtime outlives an MCP client.
process.once('SIGINT',()=>{void facade.close().finally(()=>process.exit(0))})
process.once('SIGTERM',()=>{void facade.close().finally(()=>process.exit(0))})
