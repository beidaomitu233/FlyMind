# D03 接入能力预检

日期：2026-10-16。执行者：项目经理。仅证明固定 draw.io 31.5.3 的两项接入能力，不等于 D03 或保存队列验收通过。

## 实际结果

1. 使用公开 `configure` 的 `libraries` 内联配置，业务节点库在 `offline=1` 下出现。展开后实际点击原生模板，原生保存 XML 中新增 `fmType=node / fmKind=task` 对象及“业务步骤”标题，无需 URL 图形库、外网或引擎资源修改。
2. 使用公开 `merge` 发送一项 UserObject 元数据变化，收到 `event=merge`，关联值在 `event.message.message`；原生 Ctrl+S 保存了该属性。
3. 合并前后实际非零画布滚动位置一致，未重新 `load`。随后真实 Ctrl+D 可以复制原先选择的业务节点，原生保存 XML 中节点数由 1 变 2，以此验证选区仍可操作；没有用内部 model API 伪造变更。
4. 再点击业务库插入模板，原生保存中节点数变为 3；截图和完整 XML 已保存。
5. 对普通 `mxCell` 连线直接设置 `fmType/fmKind/fmId/fmRole/fmAdapter`，经公开 merge 和真实 Ctrl+S 后属性仍保留，`directCellMetadataSurvives=true`。固定版本的根 model 自定义属性丢失不等于所有 cell 自定义属性都会丢失；不能只凭推测要求全量包装。

浏览器 Chrome 155.0.8059.80，外部请求 0，页面异常 0；仍保留已知本地 `/drawio/null` 404。探针独立随机回环端口，未打开 FlyMind Runtime、现有用户页面或数据库。运行使用自动审批允许的外层环境，因为受限浏览器无法访问本机回环地址。

最终一次运行直接复用 `server/native-routes.ts` 的 `drawioStaticRouter` 和实际 CSP，以上业务库、merge、原生保存、选区操作及普通连线元数据验证均通过。没有仅用一个未设安全头的仿制静态服务器证明正式路由可用；探针只导入模块定义，不调用 DiagramStore.init。

脚本：`scripts/probes/drawio-host-capabilities.mjs`。证据：`output/playwright/drawio-host-capabilities/{result.json,run.log,editor.png,merged.drawio,library-inserted.drawio,direct-cell-codec.drawio}`，均为忽略的测试输出。项目经理实际查看 `editor.png`，确认原生库和新增形状。

## 固定版本配置边界

源码核查：`Editor.configure` 将 `libraries` 传入 `Sidebar.customEntries`，`entries[].libs[].data` 接受原生库条目，其中 `xml` 可以是未压缩 mxGraphModel。库标题配置采用本地化对象，例如 `{main: '业务节点'}`。模板中的明确业务类型用于后续归一化，不能给每次新增的对象写死同一个业务 ID。

`defaultCustomLibraries` 的 U URL 库分支会在 `isOffline()` 时拒绝加载，即使是本机 URL；本轮使用内联库，未通过关闭 offline 绕开。默认库展开仍需在 Host 配置中验证，本探针通过真实点击展开。

## 尚未证明

- 未证明保存 A 返回时，对正在编辑 B 的画布发送 A 的完整 XML 是安全的。当前只验证空闲状态的一项元数据合并；正式接入必须防止旧确认覆盖新输入。
- 未证明合并期间的输入法、撤销基线、切图迟到消息、失败恢复或保存队列；这些仍在 D03-A2/B2。
- 新模板没有 `fmId`，且本探针不是泳道归属测试。唯一 ID、复制内部连线、跨角色/阶段及严格内容投影仍由 D03-A1 实现与验收。
- 没有将库配置或测试成功提前写成当前工作台的已上线功能。

复现：配置现有 `DRAWIO_PROBE_PLAYWRIGHT` 和 `DRAWIO_PROBE_BROWSER`，运行 `node --import tsx scripts/probes/drawio-host-capabilities.mjs`。不安装新浏览器或包。
