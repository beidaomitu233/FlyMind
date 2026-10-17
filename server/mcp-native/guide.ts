import {nativeDocumentCapabilities} from '../../src/drawing/services/native-capabilities'
const capabilities=nativeDocumentCapabilities()
export const nativeGuide=`# FlyMind native pilot
实际可用类型：${capabilities.supportedKinds.join('、')}。各profile及compile/project/patch/configure/migrate能力：${JSON.stringify(capabilities.profiles)}。未启用能力明确拒绝，不以profile名称冒充已适配。
先读取 get_drawing_guide。content 必须 schemaVersion=1、稳定 id、title、kind、nodes、edges、lanes、phases、groups；内容字段依图形类型，不包含坐标、样式、presentation 或文档时间。节点用简短动作/概念；判断出口完整，退回边 kind=feedback，不猜测来源缺失关系。
create_diagram、patch_diagram、update_diagram 必须提供稳定 requestId；同次请求重试必须保持 requestId 和全部 payload。修改前 get_diagram，携带最新 expectedRevision；冲突重新读取并合并，不覆盖人工修改。完整 update 通过语义差异 patch 保留无关人工几何。
Runtime网络中断或401时首次请求不会自动重放；请保留原requestId及原payload再试，后续请求可重新启动/连接同一工作区的Runtime。MCP会话首次绑定的工作区身份不变，同路径换库返回WORKSPACE_MISMATCH，禁止据此盲目重建图形。
AI 新建必须质量合格；修改历史人工草稿不得新增或加重 error/warning，包括同一问题的规模。默认 editIntent=structure，禁止仅补 note 冒充业务修改；用户明确只加说明时用 annotation。来源 PBS 的业务缺口应保留并确认。
get_diagram 默认只返回纯内容和 revision。preview/create/patch/update/export 等待同一不可变修订的真实 PNG 和 png/svg/drawio/json/project.json 五制品。files 是 Runtime 验证后的本机绝对路径；resources 为 flymind://exports/{id}/{revision}/{exportId}/{format}。输出 PNG 和编辑链接给用户。默认等候最多25秒。saved=true 但导出失败/超时时绝不重新创建：queued/running使用export_diagram的jobId继续等候同一任务，failed使用retryJobId显式创建新导出任务，均需新导出requestId。两者不可同时传，沿用原快照/options。分组为当前列表归属。STDIO固定8MiB安全预算，resourceLimits说明可内联读取范围；超大SVG返回MCP_RESOURCE_TOO_LARGE且连接保留，使用真实files或认证下载。PNG若超预算previewStatus=too_large而exportStatus仍succeeded，使用files.png，不重建或裁剪源图。
get_rendering_config 返回真实 profile/preferences及该类型能力。configure_rendering要求expectedRevision、requestId和rendering，按实际能力表修改XML并保存/导出；未支持的字段明确拒绝，不只改元数据。读取当前配置后仅提交所需字段，relayout须明确声明；不能用内容patch修改位置。
Web业务文件导入只接纯content JSON与单图完整v2/v3 project JSON，人工导入可保留历史质量问题，不算AI新建合格。原始UTF8文件最多${capabilities.imports.maxSourceBytes}字节，base64 JSON请求最多${capabilities.imports.maxRequestBytes}字节，导入后XML最多${capabilities.imports.maxXMLBytes}字节。完整v2先无损迁移，完整v3保留人工渲染，均新顶层ID/时间且不继承组织/历史/回执；原文件不可变留存。工作区备份走离线维护恢复，非单图导入；${capabilities.imports.drawio?'支持经校验的单页未压缩drawio；无业务元数据为仅画布，需显式属性映射后才供AI修改，仅画布提供PNG/SVG/drawio/project.json四制品，无内容JSON。':'当前drawio/canvas-only能力未启用。'}压缩、多页和损坏业务元数据明确拒绝，不伪造空content。
原生普通Delete可能保留关联悬空线，保存返回NATIVE_DELETE_INCOMPLETE并保留草稿；先原生撤销，再用Ctrl+Delete删除节点及全部关联线。脑图更多菜单的删除当前分支会确认所选主题及全部后代，可在当前原生会话撤销；服务器不静默级联。
mixed v2 只读，未迁移不提供原生预览或虚假编辑链接。组织操作使用同库分组与回收站；永久删除必须获得用户明确授权。`
export const guideData={guide:nativeGuide,standardVersion:'1.0',capabilities}
