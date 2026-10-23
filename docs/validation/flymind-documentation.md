# DOCS-23：工作台使用文档面板

2026-10-23，PM已接入并完成本地限定实页验收。未提交、推送、改版本或更改远端/用户数据；见[集成验收](auth-documentation-20261023.md)。

## 组件契约

新增 `src/drawing/ui/FlyMindDocumentation.vue`，不替换原工作台：

```vue
<FlyMindDocumentation
  :open="documentationOpen"
  :appearance="appearance"
  @close="documentationOpen = false"
/>
```

- `open:boolean` 必填；`appearance?:'light'|'dark'` 默认light。唯一事件 `close` 无payload，由父级控制open。
- Teleport到body；覆盖式dialog、独立章节导航、代码复制。桌面最大980×760，窄屏将导航改为横向滚动；正文独立滚动，不改工作台尺寸。
- 开启时聚焦当前章节标题，Tab/Shift+Tab约束面板焦点、Esc/关闭按钮/点击外层遮罩发close；关闭或卸载释放body滚动并恢复原入口焦点。没有修改原iframe、会话或图形。
- 不依赖动效。clipboard不可用或被拒时提示手动选择代码复制，不假称已复制。外链均HTTPS、明确新窗并带noopener/noreferrer；纯文本插值，无v-html。

## 内容事实来源

独立纯内容model：`src/drawing/ui/flymind-documentation.ts`。五章节为介绍、使用方式、MCP安装连接、本地/云端/协作、关于。

- 实读 `bin/flymind.mjs`：Windows CLI命令mcp（默认）、setup、doctor、studio、login、logout；匹配版本的本地授权必须配置 `FLYMIND_CONTROL_PLANE_ORIGIN`，密码只在本机网页输入，选择团队与设备/工作区授权。
- 实读 `server/local-auth/runtime.ts`、`LocalAuthorization.vue`：本地读取/写入仍需有效云授权，不将登录等同自动上传/双向同步。
- 实读 `server/mcp-native/guide.ts`：先读get_drawing_guide，AI按当前任务taskName或workspaceGroupId归组，不能替代content.groups；修订/稳定requestId、导出任务继续与五制品一致。
- 安装/发布状态以 `docs/INSTALL_AND_USE.md` 与 `docs/releases/V1_1_DEPLOY_AND_USE.md` 的记录为依据：npm在线包/Registry未正式发布，无可直接npx安装的承诺；已发布mcp-v1.0.0历史包不被描述为已含当前login/云协作版本。历史tgz本地安装命令与当前授权步骤分开标注，先检查help确认匹配版本。
- 远程固定 `https://fly.hui7.fun/mcp`，支持OAuth的客户端完成登录、团队选择与授权；配置没有密码/token。服务实际可用性以服务状态为准，文档不宣称公网全链路新增验收。云端工作台链接为 `/#/cloud`。
- 本地图只在显式导出/目标团队导入后进入云空间；单图内容JSON和完整project文件的布局差异、仅画布四制品边界、团队viewer只读均明确。

## 定向验证

```powershell
& 'C:/nvm4w/nodejs/node.exe' --import tsx --test tests/flymind-documentation.test.ts
& 'C:/nvm4w/nodejs/node.exe' node_modules/vue-tsc/bin/vue-tsc.js -b
```

内容契约3/3、vue-tsc一次通过。测试覆盖固定远程地址与本地authority一致、可解析复制配置、无凭据与未发布在线安装命令、task分组/同步边界、实际CLI命令、导航ID与安全公共链接。

开发代理未启动服务/浏览器。PM随后完成CloudStudio/NativeStudio/LocalAuthorization入口、前台独立密码说明及构建；真实浏览器验证登录前后入口、章节、深浅主题、Escape关闭与焦点恢复，截图见集成报告。窄屏未实页验收；复制出现成功反馈，但跨工具剪贴板读回不一致，不称独立读回通过。工作台原有编辑器和数据源保持原逻辑。
