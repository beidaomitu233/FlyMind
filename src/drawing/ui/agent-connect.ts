/** Credential-free instructions: copying/confirming is never an authentication check. */
export interface AgentConnectContext {diagramId?:string;title?:string;teamId?:string}
export const AGENT_MCP_URL='https://fly.hui7.fun/mcp'
const safeId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)
export function agentConnectionScope(context:AgentConnectContext={}){
 if(context.diagramId)return safeId(context.diagramId)&&safeId(context.teamId)?'same-diagram' as const:'import-required' as const
 return 'first-diagram' as const
}
export function buildAgentInstallPrompt(context:AgentConnectContext={}){
 const scope=agentConnectionScope(context)
 const drawing=scope==='same-diagram'?`当前目标 teamId=${context.teamId}、diagramId=${context.diagramId}；先读最新修订，保留已有编辑，在同一张图继续，不新建副本。`:scope==='import-required'?'当前可能是本地图，先让我显式导入云端团队、确认图形身份后再修改，不自动上传。':`${safeId(context.teamId)?'当前团队 teamId='+context.teamId+'；':''}还没有指定图形，先问清绘图任务，按任务归组创建第一张图，之后沿同图继续。`
 return `连接 FlyMind MCP：${AGENT_MCP_URL}，已有同地址连接请复用，不覆盖其他服务。请发起浏览器 OAuth，由我本人登录 FlyMind、选择团队并确认；不能自动配置时给我最短操作步骤。连接后先读 get_drawing_guide，再按我的要求绘图。${drawing}`
}
