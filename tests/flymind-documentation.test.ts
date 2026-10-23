import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {flymindDocumentation,FLYMIND_CLOUD_ORIGIN,FLYMIND_MCP_URL,type DocumentationBlock} from '../src/drawing/ui/flymind-documentation'

const flatten=(blocks:readonly DocumentationBlock[]):DocumentationBlock[]=>blocks.flatMap(block=>block.kind==='advanced'?[block,...flatten(block.blocks)]:[block])

test('MCP copy examples use stable HTTPS OAuth endpoint or real local CLI with same account authority; no credentials',()=>{
 const codes=flymindDocumentation.flatMap(s=>flatten(s.blocks)).filter(b=>b.kind==='code')
 const configs=codes.filter(c=>c.language==='JSON').map(c=>JSON.parse(c.code).mcpServers.flymind)
 assert.equal(configs.length,2)
 const remote=configs.find(c=>c.url),local=configs.find(c=>c.command)
 assert.equal(remote.url,FLYMIND_MCP_URL);assert.equal(new URL(remote.url).origin,FLYMIND_CLOUD_ORIGIN);assert.equal(new URL(remote.url).pathname,'/mcp')
 assert.deepEqual(local,{command:'flymind',args:['mcp'],env:{FLYMIND_CONTROL_PLANE_ORIGIN:FLYMIND_CLOUD_ORIGIN}})
 for(const c of codes){assert.ok(!/npx\s|npm install\s+(?:-g\s+)?flymind/.test(c.code),'unpublished package must not be an install command');assert.ok(!/password|Authorization|Bearer|sessionToken|PRIVATE KEY/i.test(c.code),'no credential-bearing copy example')}
})
test('help distinguishes local authorization from data sync, published history and task grouping',async()=>{
 const all=JSON.stringify(flymindDocumentation),cli=await readFile(new URL('../bin/flymind.mjs',import.meta.url),'utf8')
 assert.match(all,/尚未正式发布/);assert.match(all,/历史本机包/);assert.match(all,/不会自动上传或双向同步/);assert.match(all,/明确.*导入/)
 assert.match(all,/taskName/);assert.match(all,/workspaceGroupId/);assert.match(all,/content\.groups/)
 assert.match(all,/png.*svg|PNG.*SVG/);assert.match(all,/project\.json/);assert.match(all,/五种制品/)
 const local=flymindDocumentation.find(s=>s.id==='local-cloud')!,login=local.blocks.find(b=>b.kind==='code'&&b.title==='本地登录云账号')
 assert.ok(login&&login.kind==='code');assert.match(login.code,/flymind login\nflymind studio/);assert.ok(login.code.includes(FLYMIND_CLOUD_ORIGIN))
 for(const command of ['login','logout','studio','mcp','setup','doctor'])assert.ok(cli.includes("'"+command+"'"),'actual CLI lacks '+command)
 assert.ok(cli.includes('FLYMIND_CONTROL_PLANE_ORIGIN'))
})
test('documentation navigation and outbound sources have unique stable IDs and safe public links',()=>{
 assert.equal(new Set(flymindDocumentation.map(s=>s.id)).size,5)
 for(const s of flymindDocumentation){assert.ok(s.title&&s.description&&s.blocks.length);for(const b of flatten(s.blocks))if(b.kind==='links')for(const link of b.items){const u=new URL(link.href);assert.equal(u.protocol,'https:');assert.ok(['github.com','fly.hui7.fun'].includes(u.hostname));assert.equal(u.username,'');assert.equal(u.password,'');assert.equal(u.search,'')}}
})
