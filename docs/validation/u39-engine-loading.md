# U39 引擎打开与资源供应诊断

2026-11-01，限定诊断/隔离测量；未发布，未修改生产图形、账号、引擎供应或U35文件。客户端API并行/在途去重由另一代理独立处理，本文测量已包含该未发布优化。

## 已证实与未证实

- `git diff 2d4a27a 52b0f82`：U34→U38 的Host、Viewport、host controller/library、资源HTTP路由没有改动。固定 `/drawio/v31.5.3/`、普通图math=0、同workspace最多两槽、欢迎双预热和公开load复用仍在。CloudStudio用户/团队隔离不因本次应用发布取消。
- U38的engineResourceKey变化没有进入iframe或字体URL；vendor路径仍按DRAWIO_VERSION固定，字体仍按固定SHA query命名。不能据release key变化认定浏览器缓存失效。
- 公网固定index/bootstrap/app/extensions/font HEAD均200、immutable、gzip、无redirect。HEAD只证明策略，不证明下载吞吐。实际完整body很慢（下文）。
- 本次隔离真实UI两轮及“公网资源+隔离业务”一轮均实际复用两槽，热切期间没有configure/init。没有复现用户全部连续切图7–8秒，不能宣布其完整根因或已修好。
- 用户具体慢图XML、浏览器当前槽/缓存瀑布尚缺。Canvas、缺少fmDocumentId、math=1仍按既有安全边界不复用；尚不能证明用户图属于其中一种，不能借此归因。

## 线上资源实证

本代理只读公开资源HEAD：`output/u39/public-assets.json`，响应约29–111ms。PM独立完整gzip GET：app 2,220,672字节约6.966s，字体13,596,506字节约37.673s。供应/字节没有替换，gzip已存在，不能再以“增加gzip”宣称解决。

为直接复用真实Host而不伪造前端性能，新增临时夹具 `output/u39-network-preview.mjs`：只把固定draw.io/font GET流式转发到同一公网路径，保留响应缓存/压缩头，不转发cookie/Authorization；全部身份、图形API和SQLite仍在独立回环测试库。没有生产登录、图形请求或写入。运行记录：

- 冷浏览器首页双槽预热 **42,705ms**。
- app.min **6,572ms / 2,220,972 transfer bytes**；extensions **11,116ms / 987,153 transfer bytes**；字体 **37,534ms**。
- 第二槽app/extensions/font的transfer为0，缓存合并有效；复用槽中旧resource entry保留原cold值，不代表每次切图重新下载。
- 此代理方法保留公网字节与传输耗时，但浏览器URL/业务API为localhost，不是用户生产页面P95或同一TLS拓扑的端到端测量。

`output/playwright/u39-network-opening/report-timeline.json`：

| 图形 | 节点/边 | 当前XML及输入就绪 | 含真实编辑验证 |
|---|---:|---:|---:|
| 小流程 | 8/9 | 313ms | 466ms |
| 技术完整样本 | 24/14（9组） | 909ms | 1002ms |
| PBS | 23/26 | 875ms | 944ms |
| 合成宽树 | 240/239 | 1775ms | 2162ms |
| 从宽树回小图 | 8/9 | 2035ms | 2126ms |

以上从首页预热完成后点击开始；不能隐藏42秒冷准备成本。回小图时save/export出现在142/161ms及1321/1338ms，目标load在1759ms，说明该例主要时间位于原图退出/保存重基链路，非重新初始化。此夹具日志中的两条Vite WebSocket关闭是并行开发预览的HMR端口冲突，不是生产draw.io错误；没有把它当作线上故障。

## 本地资源/真实UI复用对照

`output/u39-preview.mjs` 使用相同当前源码、固定真实浏览器和全新临时库，5297。`output/u39-opening-probe.mjs` 沿用原U31探针；没有Playwright route、没有禁用HTTP缓存。点击后验证active槽、公开XML的当前fmDocumentId、真实双击节点出现原生文字编辑器，Escape取消。240宽树加载后通过实际缩放菜单验证编辑，缩放不计入已测ready。

首次套件 `report-full.json`：双槽预热2054ms，小图376ms、技术1051ms、PBS1012ms、240宽树2036ms、回小1595ms；套件请求中存在161–628ms的collaborative commit/列表刷新。保留其波动，没有用第二轮覆盖首轮。

第二轮 `output/playwright/u39-opening/report-timeline.json`：

| 图形 | 当前XML及输入就绪 | 含真实编辑验证 |
|---|---:|---:|
| 小流程 | 245ms | 337ms |
| 技术24/14 | 310ms | 401ms |
| PBS23/26 | 357ms | 425ms |
| 240宽树 | 629ms | 929ms |
| 从宽树回小图 | 283ms | 354ms |

两槽始终存在；切换消息中无configure/init，切出save/export约63–127ms，目标load约126–466ms。API health/get约2–75ms；这是回环低延迟条件，不代表公网鉴权回合成本。另一代理的150ms延迟HTTP实测另外记录旧串行约695ms、共享me/并行读约325ms，不把该差值声称为全部7秒根因。

## 测量限制与验证

早期匿名公网自造父页面harness先遇image文档setContent超时、再遇非同源frame导航失败；改同源后资源body测到，但自造configure握手未完成。该输出 `output/u39/public-engine.json` 保留失败事实，**不计为用户加载耗时或成功可编辑证据**；最终使用上述真实Host夹具，无放宽CSP/Host或增加超时冒充通过。

定向 `node --import tsx --test tests/drawio-host.test.ts tests/drawio-loading.test.ts` **22/22**。没有产品引擎回退或资源缓存错误的证据，本代理本批未改Host/资源生产代码；未重做字体供应、未改U35 renderer/svg-fonts性能文件。公网低吞吐冷下载已实证；具体用户连续热切7–8秒仍需其实际瀑布/图规模与会话退出阶段证据，不能以有限隔离样本达标承诺任意网络/规模SLA。

## 后续生产异常（未定位）

本节为首次异常时点记录。后续用户重启、小图保存确认、复杂图160秒超时及整机再次失联见[PM最终记录](u39-loading-regression.md)。随后本地已实现浏览器WOFF2按需供应并完成真实保存/重开验收，详见[字体专项](u39-browser-fonts.md)；上文“未改Host/未重做字体供应”只描述此前只读排查阶段，不能作为最终代码状态。

用户随后明确已删除所有图并授权新建测试图。PM通过远程MCP只发起一次8节点流程创建（`u39-perf-small-20261101`、requestId `u39-create-small-20261101`），调用超过30秒仍未返回，同期公网readyz本机探测12秒超时。尚未创建复杂图，也没有重试结果未知的写操作；是否已提交、服务端阶段及故障原因均未知。PM已触发独立只读健康Actions `41324537126`，后续以其实际结果及服务器证据为准。

这不能归因于OOM，也不能用已证实的字体网络成本解释服务健康接口同时超时。此前冷字体下载约38秒属于浏览器公开资源链路成本，不是此次MCP写入或主机异常根因证明。引擎代理暂停生产图API，仅停止自有5297/5298临时预览释放本机资源，保留临时输出；不修改、恢复或清理生产图形，不绕过幂等重试边界。
