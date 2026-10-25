# U31 图形打开性能

PM已完成下述限定范围验收，最终结果以本文“最终限定收口”及[独立集成记录](u31-interaction-performance.md)为准；中间迭代的退回项保留历史，不表示当前仍未修复。未发布。

日期：2026-10-25。仅源码和隔离临时 CloudStudio；未部署、未改用户图或版本。

## 定位与改动

- 原 Viewport 每次切图销毁旧 iframe，重新执行固定 draw.io 初始化；即使资源在缓存中，实测仍需约 1.5–2 秒。
- 线上公开 HEAD 已确认 gzip 存在，但全部 `/drawio` 资源为 `no-cache`。新增 `/drawio/v31.5.3/` 固定供应路径及一年 immutable 缓存；旧路径继续 revalidate，未知版本 404，供应原字节和 CSP 不变。
- 固定 vendor 默认初始化 MathJax。普通未压缩无 `math=1` 文档使用公开 `math=0`；公式/未知格式保留默认。未修改 vendor。
- 同一可信 workspace 内最多保留两个独立引擎槽，欢迎页在 health 成功后预热隐藏原生引擎（固定 Noto 非空占位，不持久保存）。当前图首次 ready 后启动第二个 inert 槽。隐藏槽使用 visibility，欢迎卡保留。
- 切图先由原流程确认草稿和保存，再在备用引擎公开 `load`；新 controller 等精确 XML 的 load ACK 和双 RAF，之后原子激活。旧槽保留为下一次备用。普通 autosave/ACK 不 load。
- origin/source 精确匹配；业务保存事件还核对当前 `fmDocumentId`，旧图迟到事件丢弃。Canvas、未知业务身份、公式图不走复用。用户/团队切换仍由 CloudStudio context key 卸载整个 Viewport。重新打开的文档不保留前次 Undo，和原重建 iframe 的行为一致。

## 前期迭代测量

`scripts/probes/drawio-opening.mjs`：仅允许回环 fixture；没有使用 Playwright route（route 会禁用 HTTP 缓存）。从真实列表 click 开始，等当前 active 槽、公开 export 核对当前 fmDocumentId，再双击实际业务文字并确认原生 `.mxCellEditor` 可见，Escape 取消。包含 API、绘制和真实编辑交互；不把预览或隐藏 standby 当打开成功。

隔离预览 `http://127.0.0.1:5297/#/cloud`；fixture authority 非 Java 生产证明，数据根为 OS 临时目录。账号 alice / fixture-password 仅此夹具。

| 单次观测 | 规模 | 点击至当前可编辑 |
| --- | --- | --- |
| 原每图初始化，已加缓存/跳过 Math | 流程 8 节点 / 9 边，冷开 | 2360ms |
| 同上，热开架构 | 37 节点 / 2 边 | 1682ms |
| 两槽复用初轮，回切流程 | 8 / 9 | 321ms |
| 欢迎页预热后首次打开 | 流程 8 / 9 | 336ms |
| 第二槽尚未初始化完成时立即打开技术图 | 完整 24 节点 / 9 组 / 14 边 | 2055ms |
| 复用打开 PBS | 23 节点 / 26 边 | 448ms |

证据：`output/playwright/u31-opening/report.json`、`report-full.json`。初轮 requestMs 混用计时原点已修为 Playwright `responseEnd`（相对请求开始），最终 HTTP 记录不再负数。隔离 health 约 2–3ms、图 get 约 14–73ms，远小于原引擎初始化；未因此跳过团队授权或扩大服务验证改动。

冷缓存本地第一轮 app 约 9.77MB、字体 16.44MB、extensions 3.94MB；热资源 transferSize 为 0。线上既有 gzip，不能将其说成缺 gzip。预热耗时独立记录（最后一次约 1071ms），不能把这一成本说成消失。不是 P95，也不是任意网络/机器保证。

## 压力测试的历史定位

另建纯合成 240 节点 / 239 边纵向流程链，仅临时库。服务编译成功、公开 XML 核对当前图成功，但真实 viewport 中没有可双击业务节点；首节点在 viewport 外，随后只读选取可见节点也失败 `NO_CURRENT_NODE_IN_VIEW`。因此没有“240 节点当前可编辑 <2 秒”的证据，未强制 fit/缩字或伪标通过。

第二槽初始化未结束的立即切换仍可能略超复杂图 2 秒（本次 2055ms）；网络冷下载、超大/极端长图、公式/Canvas 均保留明确边界。未承诺无限复杂度。PM 仍需独立核对改字→保存→切图→重开及真实 UI，最终接受由 PM 决定。

## 定向验证

```powershell
C:/nvm4w/nodejs/node.exe --import tsx --test tests/drawio-host.test.ts tests/native-session.test.ts
C:/nvm4w/nodejs/node.exe --import tsx --test tests/drawio-loading.test.ts
npx vue-tsc -p tsconfig.json --noEmit
C:/nvm4w/nodejs/node.exe --import tsx scripts/probes/drawio-opening.mjs
```

Host + session 53/53；静态缓存/路径 1/1；vue-tsc 通过。新增 warm-controller 测试明确旧 load ACK 不激活、切换中和切换后旧 autosave 均不提交，当前图 autosave 正常。原 pending/草稿/重基/关闭测试保留。

迭代顺序：先核对线上缓存/压缩、Math 和每图初始化；缓存首片测得仍 1.5–2 秒后才引入有界两槽复用；再补欢迎预热和实际完整样本。未扩展字体供应、布局、业务引擎或部署。

## 最终限定收口

欢迎页在 health 成功且页面 loading 已结束时直接预热两个隐藏槽；真实深链接不会同时启动两槽加入首开关键路径，仍单引擎 prepare，ready 后再启动备用。prepare 遇到未 ready 的 welcome 槽时沿用已有初始化和原 deadline，等待后公开 load，不丢弃重新下载/初始化。取消会清等待绑定；失败只丢候选，保留当前画面。

最后一次隔离测量（report-full.json）：小图 325ms、完整技术24/14 412ms、PBS23/26 448ms；240节点239边四叉宽树当前 XML + native load/input ready 602ms，通过真实原生100%缩放菜单后双击可见业务节点验证编辑，总 921ms（缩放不是原 ready 耗时）。槽数始终最多2。随后从此压力图回小图总1516ms/ready1443ms，包含大图退出捕获/保存结算成本，因此不能声称所有来源的“小图切入都 <1s”。没有继续扩大保存/布局/字体工程。

极端纵向240链补得真实正确 XML + input ready 为554ms；1%整图 fit 下文字/定位难以用于双击，不是未加载。保留 report-long-chain.json，包括最初误用 readonly 缩放输入的定位错误；最终宽树用真实菜单100%验证。

最新两处变更后 vue-tsc 通过；PM 原关联81项回归/真实改字保存→切图→刷新重开检查另由PM记录。冷缓存直接深链接仍单列，不能将欢迎页预热收益冒充首次进站网络成本或任意规模保证。

保存身份补充：当前消息缺失 fmDocumentId 或 XML 身份无法解析时，controller 发明确可恢复错误（尚未保存），不关闭引擎、不静默显示成功；正常离开仍由原 capture(true)/本地草稿和服务器验证链保护。非空旧图身份不匹配直接拒绝。补充缺ID、解析错误→恢复正确消息仍可保存的单测，Host 21/21 通过。失败的预热槽标记 failed，下一次准备不会等待已失败槽。
