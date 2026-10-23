/** User-facing help, kept independent from components and runtime credentials.
 * Sources: bin/flymind.mjs, local-auth/runtime.ts, mcp-native/guide.ts,
 * docs/INSTALL_AND_USE.md and releases/V1_1_DEPLOY_AND_USE.md. */
export const FLYMIND_CLOUD_ORIGIN='https://fly.hui7.fun'
export const FLYMIND_MCP_URL=FLYMIND_CLOUD_ORIGIN+'/mcp'
export type DocumentationBlock=
 |{kind:'paragraph';text:string}
 |{kind:'steps';items:string[]}
 |{kind:'cards';items:Array<{title:string;text:string}>}
 |{kind:'notice';title:string;text:string}
 |{kind:'code';title:string;language:string;code:string}
 |{kind:'links';items:Array<{label:string;href:string}>}
export interface DocumentationSection {id:string;title:string;kicker:string;description:string;blocks:DocumentationBlock[]}
export const flymindDocumentation:readonly DocumentationSection[]=[
 {id:'introduction',title:'认识 FlyMind',kicker:'从业务到图形',description:'让 AI 整理关系，在熟悉的画布上继续完成你的表达。',blocks:[
  {kind:'paragraph',text:'FlyMind 将图形内容与视觉布局分开：你和 AI 负责真实的步骤、模块与关系，绘图引擎负责排版、连线和原生编辑。无需在对话中提供坐标，也无需额外向 FlyMind 提供模型 API Key；AI 对话由你使用的客户端提供。'},
  {kind:'cards',items:[{title:'泳道图',text:'角色、阶段、交接与退回。'},{title:'流程图',text:'动作、判断、分支与汇合。'},{title:'架构图',text:'模块、分层及系统依赖。'},{title:'脑图',text:'主题与有顺序的父子分支。'},{title:'数据流图',text:'数据来源、处理与输出。'}]},
  {kind:'notice',title:'内容真实，图形可改',text:'来源不明确的关系应标记待确认。AI 的质量检查帮助发现结构问题，不能替代你核对业务。'}]},
 {id:'getting-started',title:'开始使用',kicker:'一个工作台，两种编辑方式',description:'先画出关系，再用网页或 AI 逐步完善。',blocks:[
  {kind:'steps',items:['在侧栏新建图形，选择合适的类型和任务分组。列表中的文件夹用于整理图形，不是画布中的架构分层。','双击修改文字，拖动节点、尺寸或连线；等待“已保存”后再离开或导出。','自动排版和横竖切换会调整人工位置、折点，确认后才执行；普通保存不自动重排。“适合画布”只调整视角。','继续让 AI 修改时，要求先读取这张图的最新修订，保留无关的人工布局与样式。','从导出菜单下载所需格式。导出仍在运行时等待原任务，不重复新建同一张图。']},
  {kind:'cards',items:[{title:'PNG / SVG',text:'实际生成的图片与矢量文件。'},{title:'draw.io',text:'保留原生图元，可继续编辑。'},{title:'JSON 内容数据',text:'仅业务内容，适合交给 AI。'},{title:'工作区文件',text:'单图完整 project.json，含内容与人工渲染。'}]},
  {kind:'paragraph',text:'业务图有 PNG、SVG、drawio、json、project.json 五种制品。仅画布图没有业务内容 JSON，需显式业务映射后才能让 AI 按业务字段修改。'},
  {kind:'notice',title:'删除节点时保留一致关系',text:'若普通 Delete 留下关联悬空线导致保存被拒，先撤销，再用 Ctrl+Delete 一并删除节点和关联线。脑图使用“删除当前分支”时先核对确认范围。'}]},
 {id:'mcp',title:'MCP 安装与连接',kicker:'选择适合你的接入方式',description:'云端使用固定链接，本地使用已安装的 Windows CLI。',blocks:[
  {kind:'notice',title:'分发状态',text:'npm 在线包与 MCP Registry 尚未正式发布，请勿把 npx 在线安装当作可用入口。GitHub 已发布的 mcp-v1.0.0 是历史本机包，不代表包含当前协作版和 login 命令；使用匹配版本前先核对发布说明与 flymind --help。'},
  {kind:'paragraph',text:'远程 MCP：在支持 Streamable HTTP 与 OAuth 的客户端添加下方固定地址。浏览器中登录、选择团队并同意授权；不要把密码或令牌写进 MCP 配置。实际可用性以服务状态为准。'},
  {kind:'code',title:'远程地址',language:'URL',code:FLYMIND_MCP_URL},
  {kind:'code',title:'支持 mcpServers JSON 的客户端示例',language:'JSON',code:JSON.stringify({mcpServers:{flymind:{url:FLYMIND_MCP_URL}}},null,2)},
  {kind:'paragraph',text:'云端规则与绘图服务更新通常不需要修改这个固定地址。网关自身重启后，客户端可能需要重新连接会话；授权失效时按提示重新授权，固定链接不代表永久免登录。'},
  {kind:'paragraph',text:'本地 MCP：仅支持 Windows 分发，需要 Node.js（20 系列20.19+，或22.12+）与 npm。使用官方已发布且校验摘要的安装 tgz；已有匹配 CLI 后，先单独准备资源，再连接客户端。首次 setup 需要联网下载固定 draw.io、中文字体和 Chromium。'},
  {kind:'code',title:'已下载的历史 1.0 本机包安装（不代表当前协作版）',language:'PowerShell',code:'npm install -g ./flymind-drawing-studio-1.0.0.tgz'},
  {kind:'code',title:'已安装 CLI：准备与检查',language:'PowerShell',code:'flymind --help\nflymind setup\nflymind doctor'},
  {kind:'code',title:'本地 STDIO 配置（含云账号授权地址）',language:'JSON',code:JSON.stringify({mcpServers:{flymind:{command:'flymind',args:['mcp'],env:{FLYMIND_CONTROL_PLANE_ORIGIN:FLYMIND_CLOUD_ORIGIN}}}},null,2)},
  {kind:'paragraph',text:'若客户端不能执行 Windows 命令 shim，改为你实际安装位置的绝对 node + bin/flymind.mjs 入口。不要把本机工作台网页地址当作 HTTP MCP 地址。'},
  {kind:'notice',title:'告诉 AI 怎样开始',text:'“使用 FlyMind，先读取 get_drawing_guide，再按当前任务创建图形。”AI 应提供 taskName 或复用明确的 workspaceGroupId，将同一任务的新图放在同一分组；它们不是 content.groups。修改前读取最新 revision，使用 expectedRevision 与稳定 requestId。导出超时沿原 diagramId / jobId 继续，不重建图形。'},
  {kind:'links',items:[{label:'查看已发布下载与版本说明',href:'https://github.com/beidaomitu233/FlyMind/releases'},{label:'完整安装说明',href:'https://github.com/beidaomitu233/FlyMind/blob/main/docs/INSTALL_AND_USE.md'}]}]},
 {id:'local-cloud',title:'本地、云端与协作',kicker:'账号一致，存储边界清楚',description:'登录是授权；把本地图带入团队空间，需要你明确导入。',blocks:[
  {kind:'paragraph',text:'绘图账号与后台管理员使用独立的密码和权限。云端工作台、本地授权与 MCP 使用绘图账号；后台管理员负责开通和管理账号。登录工作台后，可从左下角账号菜单选择“修改密码”，设置至少6位、无需混合大小写或符号的易记密码；它不会改动后台管理员密码。'},
  {kind:'steps',items:['确认当前 CLI 的 flymind --help 中包含 login。历史包缺该命令时，应先取得支持本地授权的匹配版本，不能用旧包假装已接入。','在启动 CLI 的同一终端设置云端授权地址，然后执行 flymind login。','打开的本机网页里输入云账号与密码，选择团队，确认本设备和本工作区的授权。密码不要交给 AI 或写进配置文件。','执行 flymind studio 进入本地工作台；MCP 客户端也应使用相同授权地址和本地数据目录。缺登录、断网或权限失效时，按页面提示重新确认授权。']},
  {kind:'code',title:'本地登录云账号',language:'PowerShell',code:"$env:FLYMIND_CONTROL_PLANE_ORIGIN='https://fly.hui7.fun'\nflymind login\nflymind studio"},
  {kind:'notice',title:'不会自动上传或双向同步',text:'本地图留在本机；登录云账号不会把图上传团队空间，也不会自动合并两边的列表。需要共享时，先导出单图工作区文件，再在目标团队中明确选择文件或目录及目标分组导入。JSON 内容导入会重新生成布局；完整工作区文件用于保留支持的人工渲染。'},
  {kind:'paragraph',text:'云端同团队成员打开同一张图，可同时编辑；人和 AI 使用同一份修订。不同字段可合并，同字段冲突需要明确处理。断线或冲突时保留未确认草稿，不反复覆盖或重新创建图形。viewer 只有查看/导出权限。'},
  {kind:'code',title:'退出本机授权',language:'PowerShell',code:'flymind logout'},
  {kind:'links',items:[{label:'打开云端工作台',href:FLYMIND_CLOUD_ORIGIN+'/#/cloud'}]}]},
 {id:'about',title:'关于 FlyMind',kicker:'让复杂关系，清楚可见',description:'AI 内容、原生编辑与可带走的文件。',blocks:[
  {kind:'paragraph',text:'FlyMind 使用 draw.io 原生编辑器、固定字体与浏览器生成图形。深浅主题只改变工作台外观，不反色图形或改写导出配色。'},
  {kind:'paragraph',text:'本机业务数据默认在 %LOCALAPPDATA%/FlyMind/data，资源缓存在独立 resources 目录。卸载应用不主动删除这些数据；升级前请保留完整备份，不仅复制一个 SQLite 文件。'},
  {kind:'paragraph',text:'应用主代码采用 MIT，draw.io、字体、浏览器及其他依赖遵循各自许可。版本与可用能力以实际安装和发布说明为准，不把开发目标版本当作已经发布。'},
  {kind:'links',items:[{label:'项目与反馈',href:'https://github.com/beidaomitu233/FlyMind'},{label:'第三方许可',href:'https://github.com/beidaomitu233/FlyMind/blob/main/THIRD_PARTY_NOTICES.md'}]}]}
]
