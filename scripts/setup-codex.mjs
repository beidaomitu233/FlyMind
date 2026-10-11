import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const local=join(homedir(),'.codex','.sandbox-bin',process.platform==='win32'?'codex.exe':'codex')
const command=process.env.CODEX_CLI||(existsSync(local)?local:'codex')
const args=['mcp','add','flymind','--',process.execPath,join(root,'server','start.mjs')]
const r=spawnSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true,shell:false})
if(r.error){console.error('未找到 Codex CLI，请设置 CODEX_CLI 为其绝对路径，或按 docs/CODEX_SETUP.md 手动配置。');process.exit(1)}
if(r.status!==0)process.exit(r.status||1)
spawnSync(command,['mcp','get','flymind'],{cwd:root,stdio:'inherit',windowsHide:true,shell:false})
console.log('FlyMind 已注册。重新加载 Codex MCP 配置或打开新会话以发现工具。')
