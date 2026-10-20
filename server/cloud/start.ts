// Source-only development entry. Not the published Windows CLI or local Runtime.
import {createServer} from 'node:http'
import {createCloudHTTP} from './http'

const required=(name:string)=>{const value=process.env[name];if(!value)throw Error(name+' is required');return value}
const port=Number(process.env.FLYMIND_CLOUD_PORT??5192)
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid FLYMIND_CLOUD_PORT')
const cloud=createCloudHTTP({controlPlaneURL:required('FLYMIND_CLOUD_CONTROL_PLANE_URL'),cloudDataRoot:required('FLYMIND_CLOUD_DATA_DIR'),publicOrigin:required('FLYMIND_CLOUD_PUBLIC_ORIGIN'),gatewayKey:required('FLYMIND_GATEWAY_KEY'),allowInsecureLoopback:process.env.FLYMIND_CLOUD_DEV_LOOPBACK==='1'})
const server=createServer(cloud.app)
let stopping:Promise<void>|undefined
async function close(){if(stopping)return stopping;stopping=(async()=>{const http=new Promise<void>(r=>server.close(()=>r()));server.closeAllConnections();await http;await cloud.close()})();return stopping}
server.once('error',error=>{console.error('FlyMind cloud start failed:',error.message);void close().finally(()=>{process.exitCode=1})})
server.listen(port,process.env.FLYMIND_CLOUD_BIND??'127.0.0.1',()=>console.error(`FlyMind cloud source entry listening on port ${port}`))
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void close().then(()=>process.exit(0),()=>process.exit(1)))
