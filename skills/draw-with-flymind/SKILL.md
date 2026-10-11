---
name: draw-with-flymind
description: 使用 FlyMind MCP 从业务材料绘制并二次编辑泳道图、流程图、架构图、思维导图和数据流架构图，交付图片、源数据与编辑链接。
---

先调用 get_drawing_guide，按用户材料选择 kind 并读取模板。编写语义 JSON，坐标和颜色放 presentation。调用 create_diagram 创建并交付 PNG 图片、SVG/JSON 文件和 editorUrl；不要只交付 JSON。

用户要求修改时先 get_diagram 读取最新 JSON 和 revision，优先用 patch_diagram 保留人工布局。使用实际 expectedRevision；版本冲突必须重新读取合并。修改完成返回图片与编辑链接。不要丢弃判断分支，不要编造缺少的业务内容。

PNG 图片同时在 MCP image 内容和 files.png 本地路径中返回。可用 Markdown 图片展示该绝对路径。editorUrl 是本机可继续编辑地址，不能作为云端分享链接。没有可用 MCP 工具时说明连接状态，参阅 docs/CODEX_SETUP.md，不能声称已通过 MCP 绘图。
