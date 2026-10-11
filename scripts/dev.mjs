import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),children=[]
try{const r=await fetch('http://127.0.0.1:5179/studio-api/health');if(!r.ok||(await r.json()).name!=='flymind')throw new Error()}catch{children.push(spawn(process.execPath,['server/start.mjs','--runtime'],{cwd:root,stdio:'inherit',windowsHide:true}))}
children.push(spawn(process.execPath,['node_modules/vite/bin/vite.js'],{cwd:root,stdio:'inherit',windowsHide:true}))
let closing=false
function close(){if(closing)return;closing=true;for(const child of children)child.kill();process.exit()}
process.on('SIGINT',close);process.on('SIGTERM',close);for(const child of children)child.on('exit',code=>{if(!closing&&code){console.error('启动失败',code);close()}})
