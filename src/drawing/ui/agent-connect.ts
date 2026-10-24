/** Credential-free instructions: copying/confirming is never an authentication check. */
export type AgentClient='codex'|'workbuddy'
export interface AgentConnectContext {diagramId?:string;title?:string;teamId?:string}
export const AGENT_MCP_URL='https://fly.hui7.fun/mcp'
export const AGENT_CONNECT_GUIDE_PATH='docs/AGENT_CONNECT.md'
export const agentClients={
 codex:{name:'Codex',guide:'https://developers.openai.com/codex/mcp',manual:'codex mcp add flymind --url '+AGENT_MCP_URL+'\ncodex mcp login flymind\ncodex mcp list'},
 workbuddy:{name:'WorkBuddy',guide:'https://www.codebuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide',manual:'设置 → MCP → 添加 MCP Server\n名称：FlyMind\n传输类型：streamableHttp\n地址：'+AGENT_MCP_URL+'\n使用客户端的 OAuth 浏览器授权流程。'}
} as const
const safeId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)
export function agentConnectionScope(context:AgentConnectContext={}){
 if(context.diagramId)return safeId(context.diagramId)&&safeId(context.teamId)?'same-diagram' as const:'import-required' as const
 return 'first-diagram' as const
}
export function buildAgentInstallPrompt(client:AgentClient,context:AgentConnectContext={}){
 const entry=agentClients[client];if(!entry)throw Error('不支持的 AI 客户端')
 const scope=agentConnectionScope(context)
 const drawing=scope==='same-diagram'?`当前目标 teamId=${context.teamId}、diagramId=${context.diagramId}；先读最新修订，保留已有编辑，在同一张图继续，不新建副本。`:scope==='import-required'?'当前可能是本地图，先让我显式导入云端团队、确认图形身份后再修改，不自动上传。':`${safeId(context.teamId)?'当前团队 teamId='+context.teamId+'；':''}还没有指定图形，先问清绘图任务，按任务归组创建第一张图，之后沿同图继续。`
 return `安装并连接 FlyMind 远程 MCP：${AGENT_MCP_URL}，先检查已有连接，同地址复用，不覆盖其他服务。请发起浏览器 OAuth，由我本人登录 FlyMind、选择团队并确认；不要索取密码或令牌，不能自动配置时请给我最短操作步骤。工具未出现时提示重连或新开会话，连接后先读 get_drawing_guide，再按我的要求绘图。${drawing}`
}
