# 单活应用发布与维护排空（V11-06-A）

本页记录源码入口的实际行为；未证明 Linux 目标机、反向代理或公网发布已经可用。部署完整目标见 [v1.1计划](../releases/V1_1_PLAN.md)。

## 启动

应用：`node --import tsx server/cloud/start.ts`（生产制品使用预编译 `lib/server/cloud/start.js`）。

必填环境：`FLYMIND_CLOUD_DATA_DIR`、`FLYMIND_CLOUD_PUBLIC_ORIGIN`、`FLYMIND_CLOUD_CONTROL_PLANE_URL`、`FLYMIND_GATEWAY_KEY`（至少32字节）。监听默认 `127.0.0.1:5192`，可用 `FLYMIND_CLOUD_BIND/PORT` 设置。纯回环开发显式 `FLYMIND_CLOUD_DEV_LOOPBACK=1`。凭据放服务私有环境文件，不写 URL、日志或 Git。

启动顺序：

1. 校验固定 draw.io、字体/许可证及浏览器文件，计算实际代码/规则/供应 release。
2. 制品根 `candidate.json` 存在时，必须 `prepared:true`，当前平台、架构、Node ABI一致；使用其 `releaseId` 计算实际 manifest，并逐字段核对 `candidate.release`。`FLYMIND_CLOUD_REQUIRE_PREPARED_BUNDLE=1` 时缺制品记录直接拒绝；只读 metadata，不能用标签覆盖不匹配代码/供应。源码开发无 candidate 继续原 boot manifest。
3. 数据根先通过隔离检查，再取得 `<root>/.flymind-cloud-owner` 内独占租约；复用成熟 PID/nonce/失效恢复逻辑，与端口无关。活 PID 不强抢，超时不解锁，本机 Runtime 所有权目录不参与。
4. `renderer.ready()` 真正启动固定 headless Chromium并核版本。Linux 显式 sandbox，不降级到 `--no-sandbox`；Windows 使用既有 hidden pipe launcher。
5. 占用 HTTP 端口后才装配团队注册表/后台恢复扫描。预热完成前不开放业务；`readyz` 成功前不应切流量。

启动失败关闭本实例资源并释放自身租约。私有父子 IPC 的失败消息发送后断开，保证失败子进程实际退出。HTTP 端口占用不会先执行持久队列任务。

## 应用更新

`CloudMaintenanceGate.enter(method,path)` 返回幂等 release；路由必须在实际异步操作 settled 的 finally 调用，不能在 `res.close` 释放。PM 的 HTTP 装配已在管理代理、授权批准、协作提交和 native 实际写操作接入。

`SIGTERM/SIGINT`（测试另有私有 IPC）执行：

1. gate 停止接收新写入；返回 `503 CLOUD_UPDATING` 与 `Retry-After: 2`。只读轮询/下载保留。
2. 等待已接收服务端写操作结算；客户端断开不取消结算计数。
3. pool 停止新 reserve、扫描、claim；等待当前一次导出自然完成。尚未开始任务保留 SQLite，下一实例有界恢复；不预先调用 worker.close 中断当前导出。
4. 协作房间发送 `reconnect {code:CLOUD_UPDATING,retryAfter:2}` 后关闭流，不发送 access-revoked、不伪造 ACK。客户端保留未确认草稿/原 requestId，恢复最新持久修订后按现重基协议继续。
5. HTTP `server.close` 等响应排出，随后关闭 worker/browser/workspace，最后释放精确 PID/nonce 所有权并退出。

`FLYMIND_CLOUD_DRAIN_MS` 默认60000，允许1–120000毫秒，当前是每一排空阶段预算而非整个发布的总耗时。任一阶段超时保留维护状态、进程及租约，不启动第二写入者；再次停止可重试。服务管理器应禁用强制 SIGKILL（PM配置 `SendSIGKILL=no`），不能把强杀当作干净排空。备份/切换只在旧进程实际退出且租约安全释放后进行。

## 独立 MCP 网关

源码 `server/cloud/mcp-gateway-start.ts`；`FLYMIND_GATEWAY_PORT/BIND` 默认 `5193/127.0.0.1`，排空 `FLYMIND_GATEWAY_DRAIN_MS`。固定上游 `FLYMIND_CLOUD_APPLICATION_ORIGIN`，其余公共 origin/control plane/key 同上。

首次 listen 前向固定上游 `/readyz`（10秒预算、公共 Host/Origin、拒绝重定向）检查 ready；网关不启动本机 Runtime/SQLite/renderer。应用随后短暂维护不销毁网关 SDK 会话。网关自身停止先拒绝新 MCP/OAuth 请求，等待已经接受的 MCP POST/DELETE 的真实 `host.handle` Promise，再关闭 SDK transport、优雅关闭 HTTP；不调用 `closeAllConnections`。固定SDK当前启用JSON response，公开transport请求等待响应生成；没有把socket关闭等同执行结束。

本片未重写 OAuth SDK 路由的持久提交协议：已在途的 code/refresh 若因网关自身重启丢失响应，客户端需要重新授权，不能盲重放 refresh；权威端既有 refresh replay 撤grant规则保留。网关自身重启后旧MCP内存会话404，客户端仍需重新initialize；固定配置URL不变。

## 定向验证与限制

- `tests/cloud-maintenance.test.ts`：真实HTTP延迟写/ACK、新写503；断开socket仍阻挡排空；超时跨端口租约不释放；网关 awaited operation及新OAuth503；真实生产入口固定浏览器预热→第二写者拒绝→正常退出→新实例接管；缺资源未建数据根；prepared标签/ABI/摘要拒绝。
- `tests/cloud-http.test.ts` 新两项：真实鉴权HTTP延迟写断开后仍落库、SSE维护重连/readyz503；导出当前尝试结束，其余仍queued/attempts0，新pool无请求恢复。
- 队列测试故意注入 renderer 失败，仅验证持久排空调度，不将其计作PNG成功。本批正式入口使用真实固定浏览器预热；真实PNG由此前worker测试及PM集成另验。
- 新测试暴露并修复 scanner 满容量后 `return` 跳过末尾 kick；改为 `break`，不扩大扫描预算。
- 所有数据使用OS临时目录/本次自有子进程；没有访问用户当前Runtime、数据库或5189。
- 未完成线上Linux sandbox/字体/ABI及长连接代理的目标机验收；浏览器实时草稿恢复的完整UI发布测试由PM集中集成，本片SSE证明传输事件与持久状态。

本批状态：定向实现待PM验收，不宣称生产部署完成。

### 本轮执行记录

2026-10-20 Windows、固定 Node20.19.6：

```powershell
& 'C:/nvm4w/nodejs/node.exe' --import tsx --test tests/cloud-maintenance.test.ts
& 'C:/nvm4w/nodejs/node.exe' --import tsx --test --test-name-pattern 'HTTP maintenance|export quiesce' tests/cloud-http.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
```

结果：5/5、选定2/2、server tsc exit0。日志位于 `output/playwright/cloud-maintenance/{maintenance-tests.log,http-tests.log,server-tsc.log}`。正式入口测试的自有子进程均实际close后才清理临时根，无本批后台进程保留。

初次定向迭代发现三处具体问题并保留修复过程：测试gateway key不足32字节（修正夹具）、启动失败私有IPC仍引用子进程（发送失败后disconnect）、scanner满容量跳过kick（return改break）。没有通过延长超时或放宽断言掩盖这些失败。
