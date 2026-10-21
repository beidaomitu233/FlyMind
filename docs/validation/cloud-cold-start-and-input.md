# 云端冷加载与失焦输入修复（待 PM 验收）

日期：2026-10-21。线上首次创建 API 已成功，但编辑器初始化超过 30 秒；缓存后重开成功。PM 的自动化 fill/Tab 曾出现文字未提交；后续真实键盘操作成功，因此不将该自动化现象直接认定为旧版真实用户输入故障。源码审查发现待提交表单值与状态重渲染、自动保存与显式提交的边界可加固，本片据此处理。本片不访问线上服务器或用户数据库。

## 修改

- Host 初始化默认期限由 30 秒改为 90 秒，Viewport 候选由 40 秒改为 100 秒。仍必须收到固定协议 configure → init → load 的真实加载回执，随后双 RAF 才可显示；超时保留旧图，允许用户明确重开，不重放创建。
- Nginx 示例只对 `/drawio/`、`/runtime-assets/` 下 JS/CSS/SVG 启用 gzip、Vary。API/授权响应不在此规则中；保留资源原有 Cache-Control 与验证行为，不设永久缓存。固定 app.min.js 约 9.8 MB；真实线上 Content-Encoding、耗时和 Nginx 配置检查由 PM 执行。
- 标题及属性文字、条目、标记、说明在 input 时进入独立内存表单草稿，失焦才提交内容修改。Vue 状态重渲染及远端记录更新不会覆盖未提交的输入。草稿按图和字段隔离，只在对应提交确认后清理；较早确认不清除较新输入。这是表单输入缓冲，不冒称已写入 IDB 或服务器。
- 同修订且会话已就绪/有本地编辑的重复协同事件不再清空属性面板。真实较新修订继续协同处理，并保留未提交字段草稿。
- 显式属性/排版操作先停止定时自动保存，等待已有保存任务收口，再 capture/flush、提交、应用和采纳修订；busy 期间不启动新自动保存，捕获完成后再检查边界，避免旧画布提交与显式内容操作交错。

## 定向验证

使用 `C:/nvm4w/nodejs/node.exe`：

```powershell
node --import tsx --test --test-name-pattern="cold editor|manual title" tests/drawio-host.test.ts tests/native-business-service.test.ts
node --import tsx --test tests/native-text-drafts.test.ts
node node_modules/vue-tsc/bin/vue-tsc.js -p tsconfig.json --noEmit
```

- 前两项定向用例 2/2 通过：模拟计时证明 30 秒后不假就绪、90 秒有界失败；临时 SQLite 中人工改标题/节点文字后内容与 XML 投影一致，旧 revision 保存拒绝。
- Vue 自定义渲染器用例验证输入框和 textarea 在 input 后、blur 前经历保存状态重渲染及远端字段更新，仍保留输入，旧确认不清新输入。该用例不冒称真实浏览器已验证。
- 类型检查通过。未启动服务、未运行浏览器/导出大探针、未执行 Nginx。线上完整失焦保存与刷新回读、冷缓存加载及压缩实际生效仍由 PM 实页验收。

## PM 独立复核

- 最终 `drawio-host`、`native-text-drafts`、`native-business-service` 联合 **24/24**，类型检查及 Vite 构建通过。日志位于忽略的 `output/deploy-fly-hui7/final-input-tests.log`、`final-ui-build.log`。
- 字段确认信息在首次 await 前快照，重试沿同一快照；已补慢 capture 期间继续输入、旧确认不清新输入及条目原始换行的回归。
- 在独立临时 SQLite、夹具身份及真实 draw.io 浏览器中，使用真实键盘修改标题“保存与导出验收”及起点“接收客户反馈”；侧栏和画布更新，刷新后持久内容仍在。该实页证据不使用线上账户或用户当前数据库，不替代公网链路验收。
- 最终修复构建的工作台实际点击 PNG 导出并完成下载，文件 PNG 签名正确、37,030字节、753×525；文件名使用本次导出时间。该结果是 Windows 隔离环境证据，未据此宣称线上 Linux 导出成功。
