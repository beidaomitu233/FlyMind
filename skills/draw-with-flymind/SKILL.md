---
name: draw-with-flymind
description: 使用 FlyMind MCP 从业务材料绘制并二次编辑泳道图、流程图、架构图、思维导图和数据流架构图，交付图片、源数据与编辑链接。
---

原生 pilot 特例：以 get_drawing_guide 返回的 capabilities 为准。当前已适配五类，仍以实际capabilities为准；content 必填 schemaVersion:1 和稳定 id、nodes/edges/lanes/phases/groups（非本类型的容器数组为空）；create/patch/update 必须传稳定 requestId，同次重试不得改 payload。修改必须读取最新 revision，AI 不得新增或加重 error/warning，历史 PBS 缺口不猜边。configure_rendering先读取get_rendering_config及实际工具schema，仅提交支持且需要修改的字段；切换方向需relayout:true，不默认传坐标。saved=true 但导出失败/等待超时代表已经保存，用 jobId/exportRetry 或 export_diagram 的 retryJobId 处理失败任务，不能重建图形。返回的 files 为 Runtime 验证过的绝对路径，资源必须含 exportId；旧 v2 只读，不能假称原生可编辑。以上优先于下文旧引擎操作示例。

先调用 get_drawing_guide，按用户材料选择 kind 并读取模板。编写纯内容 JSON：节点内容、节点类型和关系，可选 color。不要编写坐标、order、大小、形状、字体、图标、线型或 presentation；自动布局与标准样式由渲染层负责。AI根据当前用户任务自行给出清晰taskName，调用 create_diagram({content,requestId,taskName}) 自动复用/创建任务组，或先list_workspace_groups并传明确workspaceGroupId；不要每次让用户填写任务名，不把图散放未分组。后续沿用返回的组ID；同次重试保持requestId和payload一致。TASK_GROUP_REQUIRED表示需补任务上下文，不能改用图内content.groups代替。创建后交付 PNG 图片、SVG/JSON 文件和 editorUrl；不要只交付 JSON。

用户要求修改时先 get_diagram 读取最新 content 和 revision，优先用 patch_diagram 保留人工布局。使用实际 expectedRevision；版本冲突必须重新读取合并。修改完成返回图片与编辑链接。不要丢弃判断分支，不要编造缺少的业务内容。

每次绘图或修改前通过 get_drawing_guide 读取绘图内容标准 1.1（也可读 flymind://drawing-standard）。按图形类型使用短动作、短概念、真实关系和完整结果；先 validate_diagram，修复 quality.issues 中的 error，逐条核对 warning。不要搬运 PRD 段落，不要新增重复说明卡片。修改流程须直接改原步骤/条件/连接，不能靠补解释交差。仅用户明确要求批注才使用 editIntent=annotation；其余使用 structure（默认）或 wording。QUALITY_FAILED 不会保存，需按具体问题修正；不能用大段备注绕过标准。items仅架构、badge仅架构/数据卡；note和description均有预算。流程图需起终点及可达结果，泳道允许task业务入口，不强造start/end；架构依赖箭头合法，脑图单链分类也合法。纯组件名/参数预算不是task。新增批注后微改节点/边/容器文字仍不算结构修改；具体额度从正式标准读取。

仅在用户明确要求视觉调整时 get_rendering_config，然后 configure_rendering；内容操作不能附带美化参数。

独立说明使用 kind:"note"、label 和可选 description/color，不填写角色、阶段、分层、父主题或坐标；文字独立浮在主图之上，不参与节点布局。用户要求恢复已删除图形时，先 list_deleted_diagrams，使用最新 revision/deletedAt 调用 restore_diagram；永久删除只在用户明确要求删除指定回收站图形时调用 permanently_delete_diagram。不能用旧备份覆盖或重新创建已删除 ID。

PNG 图片同时在 MCP image 内容和 files.png 本地路径中返回。可用 Markdown 图片展示该绝对路径。editorUrl 是本机可继续编辑地址，不能作为云端分享链接。没有可用 MCP 工具时说明连接状态，参阅 docs/CODEX_SETUP.md，不能声称已通过 MCP 绘图。

每次导出返回独立的、带导出时间文件名的文件及 exportedAt；直接交付本次结果中的 files/urls/resources，不拼旧修订目录，也不修改文档的创建/修改时间。
