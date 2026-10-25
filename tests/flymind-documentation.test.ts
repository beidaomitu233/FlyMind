import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {flymindDocumentation,FLYMIND_CLOUD_ORIGIN,FLYMIND_MCP_URL,type DocumentationBlock} from '../src/drawing/ui/flymind-documentation'

const flatten=(blocks:readonly DocumentationBlock[]):DocumentationBlock[]=>blocks.flatMap(block=>block.kind==='advanced'?[block,...flatten(block.blocks)]:[block])

test('MCP help follows copy, personal OAuth and same-diagram editing without advanced configuration',()=>{
 const mcp=flymindDocumentation.find(s=>s.id==='mcp')!,all=JSON.stringify(mcp)
 assert.equal(new URL(FLYMIND_MCP_URL).origin,FLYMIND_CLOUD_ORIGIN);assert.equal(new URL(FLYMIND_MCP_URL).pathname,'/mcp')
 const steps=mcp.blocks.find(b=>b.kind==='steps');assert.ok(steps&&steps.kind==='steps');assert.equal(steps.items.length,3)
 assert.match(steps.items[0],/复制消息发给 Agent/);assert.match(steps.items[1],/本人登录.*选择团队.*确认授权/);assert.match(steps.items[2],/最新修订.*同一张图.*不新建副本/)
 assert.match(all,/复制消息不会检测或标记授权成功/);assert.ok(!/选择客户端|我已授权，继续|高级手动|CLI|mcpServers/.test(all))
 const codes=flymindDocumentation.flatMap(s=>flatten(s.blocks)).filter(b=>b.kind==='code')
 for(const c of codes){assert.ok(!/npx\s|npm install\s+(?:-g\s+)?flymind/.test(c.code),'unpublished package must not be an install command');assert.ok(!/password|Authorization|Bearer|sessionToken|PRIVATE KEY/i.test(c.code),'no credential-bearing copy example')}
})
test('help distinguishes local authorization from data sync and keeps actual CLI and task grouping guidance',async()=>{
 const all=JSON.stringify(flymindDocumentation),cli=await readFile(new URL('../bin/flymind.mjs',import.meta.url),'utf8')
 assert.match(all,/不会自动上传或双向同步/);assert.match(all,/明确.*导入/);assert.match(all,/Agent 新建图形必须按当前任务归组/)
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
