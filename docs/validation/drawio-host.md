# D03-A2 原生编辑器 Host

日期：2026-10-16。状态：待项目经理验收。当前只交付可集成的 Vue Host、公开 embed 消息控制器与离线业务库；保存队列/恢复由 B 的 session 负责。本记录不代表 D03/G1 或 D04 导出全部通过。未提交、推送或改应用/adapter 版本，未访问用户数据库。

## 接口与文件

- `src/drawing/ui/DrawioHost.vue`：props `sessionKey: string`、`initialXML: string`、`title?: string`。切图须 `:key="sessionKey"` 强制 remount；若原组件的 sessionKey 被直接更改，将关闭旧控制器并报 SESSION_CHANGED。
- emits：`ready({sessionKey})`、`xml({sessionKey,xml,reason:'save'|'autosave'})`、`saveRequested({sessionKey,reason})`、`error({sessionKey,code,message})`。XML 先 emit，随后 emit 对应保存意图；B 可据 reason 决定 flush 策略。
- expose：`captureXML(): Promise<string>`、`commitAndCaptureXML(): Promise<string>`、`hasUncommittedText(): boolean`、`fit(): void`。普通抓取仅返回 XML，不 emit 存储事件；fit 仅显式调用。commit 只用于用户主动保存/切图边界，先公开 invokeAction/save，再顺序 export/xml；原生 save 仍会 emit 保存事件，B 须对该事件与 capture 同 XML 去重。
- `src/drawing/engine/drawio-host/controller.ts`：独立控制器及事件类型，可纯协议测试。组件仅绑定 window message/iframe postMessage。
- `src/drawing/engine/drawio-host/library.ts`：固定 URL 与 inline libraries 配置。业务步骤、业务判断、开始、结束、浮动说明五个原生模板有可见文字与清晰库标题；含 fmType/fmKind/fmAdapter，不含预分配 fmId。浮动说明独立 text 样式，无底无边、240×72；普通库元素没有业务绑定，仍为装饰。

初始 XML/title 在 setup 固定，仅 configure→init 后首次 load。没有 watch 保存响应 XML、自动 merge/load/fit，也没有另建存储队列或读写 editor 内部 graph。Host 与 B 的 session/client/drafts 相互独立。

## 消息边界

先精确检查 `origin === location.origin` 与 `source === 当前 iframe.contentWindow`，再解析消息；其他窗口或 origin 静默忽略。协议只接受 JSON 字符串对象和已知事件，XML 上限 5 MiB、消息上限 12 MiB（按 UTF-8 字节计算）。初始化超时 30 秒；抓取超时 10 秒、最多同时 16 个。卸载或切会话拒绝全部 pending，迟到回复不 emit。

出站仅固定公开动作 configure/load/export/fit，以及显式 commit 专用 invokeAction（actionName 仅 save）；没有向调用方暴露任意 action/actionName。capture 使用 `{action:'export',format:'xml',message:唯一token}`，固定 31.5.3 回复的 message 是原请求对象，按 `event.message.message` 精确关联，同时检查 request action/format、reply format 和 XML 类型/字节上限。不同会话与乱序抓取不能串包。load 回复没有该 token，仅在严格初始化阶段接受一次；不把初始 load 回复当模型修改事件。

`editing.ts` 是固定 31.5.3 的小型 DOM 适配：hasUncommittedText 只读同源 iframe 的可见 `.mxCellEditor`，编辑器开着即保守 true，即使内容尚未改变；读取失败/无 document 返回 true。它不调用 graph、不写 DOM、不重建编辑器事件系统，不负责未 ready 的切换策略；B 应在导航或 beforeunload 合并自己的 session dirty 状态使用。

Host 对可信原生 XML 做协议类型/大小检查，完整 XML/业务安全校验仍由 normalize/严格 project 与服务保存入口负责。供浏览器同 origin 加载的固定 vendor 属受信执行代码；其他页面消息不进入 Host。

## 真实组件验证

`scripts/probes/drawio-host-browser.mjs` 用 Vite middleware 编译真实 Vue 组件，临时 HTML 直接 import 组件；Express 挂固定本地 vendor 资源，随机 loopback 端口。Vite cache 在被忽略的测试输出目录；不启动 Runtime、写数据库、改变现有服务或复制 vendor。外网请求和 service worker 被阻断。

现有 Playwright 1.62.1 与 Chrome 155.0.8059.80 最近运行 2026-10-16T07:36:47Z 通过：

- 中文双角色/双阶段真实泳道，原生选中后 Ctrl+D、文字提交、业务库鼠标拖入交叉格、原生箭头拖连；均收到 session-scoped autosave/save。
- 父组件变更 initialXML/title 模拟确认状态，收到的 load 次数仍为 1，fit 仍为显式调用的 1 次；滚动/视口保持，随后 Ctrl+D 仍复制原选区。
- capture 与原生 Ctrl+S 的 XML 一致，归一化后 6 节点/4 边；新模板节点取得明确角色/阶段归属，原始 description/items/badge 原样保留，严格 project 一致。
- 实际拖入浮动说明到表格外，归一化为 fmType=annotation，无角色/阶段要求；无底无边，主阶段几何及 note 自身几何不变。该步为 7 节点，边数不变。
- 原生文字编辑未提交时抓取，编辑框仍可见且文字保留，返回旧的已提交模型，期间未 emit 模型 XML；显式 commitAndCaptureXML 通过原生 save 提交，再返回新模型。hasUncommittedText 实测初始 false→编辑中 true→普通 capture 后仍 true→显式 commit 后 false。自动化模拟 compositionstart/end；没有证明操作系统级中文输入法所有候选态/浏览器版本行为。
- capture 在 remount 时立即拒绝 SESSION_CLOSED；旧 iframe source 的迟到 save 与父窗口同 origin 伪造 save 被拒绝，新会话仅加载其初始文档。
- 无外部请求、page error、请求失败。固定编辑器三次本地 `/drawio/null` 404 保留在记录中，未影响上述动作。

证据在 `output/playwright/drawio-host/`：`browser.json`、`host-edited.png`（已打开自检）、`native-copy.drawio`、`native-explicit-commit.drawio`、`native-wording.drawio`、`native-insert.drawio`、`native-connect.drawio`、`native-note.drawio`、`normalized.drawio`、`note-normalized.drawio`、`test.log`。

## 命令

```powershell
node --import tsx --test tests/drawio-host.test.ts tests/drawio-engine.test.ts tests/drawio-project.test.ts tests/drawio-editing.test.ts > output/playwright/drawio-host/test.log
npx --no-install vue-tsc --noEmit
$env:DRAWIO_PROBE_PLAYWRIGHT='C:\Users\12062\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
$env:DRAWIO_PROBE_BROWSER='C:\Program Files\Google\Chrome\Application\chrome.exe'
node --import tsx scripts/probes/drawio-host-browser.mjs
```

目标回归 55/55（Host 14 + 原引擎/项目/编辑 41），vue-tsc 通过。Host adversarial 覆盖 origin/source/空source、非法 JSON/对象/数组、UTF-8/字节上限、消息顺序、重复 init/load、未知 action/event、嵌套 token/乱序回复、错误回复、启动/抓取 timeout、pending 上限、unmount 与旧会话、发送失败；显式 commit 仅允许原生 save，DOM 风险检测覆盖无 document/读取失败/隐藏与可见编辑器。

## 后续边界

当前普通 capture 不承诺获取尚未由原生提交的文字；普通 autosave/确认响应绝不强制结束输入法或文字编辑。跨图切换/明确保存前由调用方显式选择 commitAndCaptureXML。protocol 没有经验证的未提交文字 dirty 事件，不能把模型未变化视作无未提交输入；DOM 检测仅用于保守提示，不是完整输入法状态模型。

OS 输入法完整验证、复杂字段 Edit Data 完整体验、并发保存确认/恢复 UI、G1 复杂 PBS 两轮人工/AI、密集边标签质量仍属后续集成门槛。PM 新固定的 Chromium151/字体供应尚未用于本探针；本轮 Chrome155 结果不能冒充固定151验证或 D04 导出验收。
