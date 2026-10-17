# 贡献与发布

## 本地开发

使用满足 package.json engines 的 Node；`npm ci` 安装锁定依赖，`npm run dev` 启动。提交前执行 `npm test`、`npm run build`。交互改动还要用真实浏览器完成选择、操作、保存、撤销、刷新读取；导出改动要检查制品。

## 模块边界

- `src/drawing/core` 不导入 Vue、Pinia、平台 SDK 或业务工作台。
- 内容字段/业务规则在 model 与 layers；视觉配置在 render-config；手势几何在独立模块，UI 只协调事件。
- MCP 字段契约在 server/contracts.ts；schema 描述必须与核心校验和 docs/AI_DRAWING_GUIDE.md 同步。
- 短暂手势预览不保存；pointerup 一次提交，Escape/pointercancel 丢弃，撤销恢复操作前状态。
- 保留人工修改和 expectedRevision 检查；不可为绕过冲突而读取版本后直接覆盖。

## 提交与问题报告

描述修改目的、交互链路、验证结果、已知限制。附去敏的最小图形 JSON；不上传真实客户图形、密钥、data/ 或浏览器备份。新增能力要更新 README 和 ROADMAP 的实际状态。

## 版本发布

只有用户明确要求发布时，才更新版本号、创建版本标签或推送 GitHub。普通修复保持本地修改；发布步骤不能视为自动发布授权。

1. 完成测试、构建、浏览器与 MCP 回归。
2. 同步 package.json、package-lock.json、plugin.json、MCP server/HTTP health 的版本。
3. 更新 CHANGELOG；确认 git diff 无 data/、凭据和临时产物。
4. 发布提交和新标签；不重写已发布标签。源代码更新后客户端须重新加载 MCP。

许可证尚未确定，不擅自给继承代码增加授权标记。独立组件、SDK 或图标的引入需记录来源与授权。
