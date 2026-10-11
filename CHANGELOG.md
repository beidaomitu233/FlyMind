# 变更记录

## 0.4.0 — 2026-10-12

- MCP 字段级输入与输出契约、完整行为注解和标准执行错误。
- 制品资源支持 MCP resources/read。
- 研究与画布演进路线、贡献/安全规范、CI 和问题模板。
- 拖动边缘/中心吸附与辅助线、八方向单节点缩放、Shift 比例约束与追加框选。
- 多选整体移动、适应所选、属性面板切换保持视角，Esc 取消手势。
- 修复拖动后的双击误判与输入焦点阻止新图形编辑链接导航；MCP/HTTP 版本统一读取 package.json。
- get_drawing_guide/list_diagrams/validate_diagram 成功结果统一为有 outputSchema 的 structuredContent；list_diagrams 列表位于 diagrams 字段。制品链接从 file URI 调整为可读取的 flymind 资源 URI，files 绝对路径继续保留。

## 0.3.0

- 内容与渲染分层；纯内容 MCP 工具与独立渲染工具。
- 渲染标准配置、独立源码编辑、schemaVersion 2 工作区与旧格式迁移。

## 0.2.0

- 五类绘图、共享文件存储与版本冲突保护。
- MCP 生成 PNG/文件/编辑链接，网页继续编辑与导出。

## 0.1.0

- 原应用复制与独立绘图工作区初版。
