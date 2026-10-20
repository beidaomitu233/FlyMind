// Source-only independent ingress; no local Runtime/store/renderer is created.
import {createServer} from 'node:http'
import {createCloudMcpGateway} from './mcp-gateway'
import {fixedApplicationFetch} from './mcp-upstream'
import {closeHTTPGracefully,drainBudget} from './maintenance'
const required=(name:string)=>{const value=process.env[name];if(!value)throw Error(name+' is required');return value}
const port=Number(process.env.FLYMIND_GATEWAY_PORT??5193),timeoutMs=drainBudget({timeoutMs:Number(process.env.FLYMIND_GATEWAY_DRAIN_MS??60000)})
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid FLYMIND_GATEWAY_PORT')
const publicOrigin=required('FLYMIND_CLOUD_PUBLIC_ORIGIN'),applicationOrigin=required('FLYMIND_CLOUD_APPLICATION_ORIGIN')
// Factory validates both fixed origins before any network access.
const gateway=createCloudMcpGateway({publicOrigin,applicationOrigin,controlPlaneURL:required('FLYMIND_CLOUD_CONTROL_PLANE_URL'),gatewayKey:required('FLYMIND_GATEWAY_KEY'),allowInsecureLoopback:process.env.FLYMIND_CLOUD_DEV_LOOPBACK==='1'})
const server=createServer(gateway.app);let closing:Promise<void>|undefined,stopRequested=false
const startup=(async()=>{
 const response=await fixedApplicationFetch(new URL('/readyz',applicationOrigin),{headers:{Host:new URL(publicOrigin).host,Origin:publicOrigin},signal:AbortSignal.timeout(10000)})
 const state=await response.json() as {ready?:unknown;state?:unknown}
 if(!response.ok||state.ready!==true||state.state!=='ready')throw Error('APPLICATION_NOT_READY')
 if(stopRequested)return
 await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(port,process.env.FLYMIND_GATEWAY_BIND??'127.0.0.1',()=>{server.off('error',no);yes()})})
 console.error('FlyMind MCP gateway listening on port '+port)
})()
const close=()=>closing??=(async()=>{stopRequested=true;await startup.catch(()=>{});await gateway.quiesce({timeoutMs});await gateway.close();await closeHTTPGracefully(server,{timeoutMs})})()
void startup.catch(()=>{console.error('FlyMind gateway start refused: application/configuration not ready');void close().finally(()=>{process.exitCode=1})})
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>void close().then(()=>process.exit(0),()=>{closing=undefined;console.error('FlyMind gateway drain timed out; accepted requests retained');process.exitCode=1}))
