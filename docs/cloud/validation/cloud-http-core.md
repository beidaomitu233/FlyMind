# C02-A：独立 Node 云端原生 HTTP 核心

日期：2026-10-19。状态：C02-A核心与C02-B三项风险收口待PM验收；不代表完整云产品、OAuth或多人协同已完成。

## 产物与接线

- `server/cloud/http.ts`：`createCloudHTTP(options) -> {app,workspaces,close}`。
- `server/cloud/export-pool.ts`：全局一个共享 renderer、串行 render、有限团队队列；借用 worker 的 `close` 不关闭共享 renderer，最终集中关闭一次。
- `server/cloud/start.ts`、`scripts/cloud-dev.mjs`：显式源码云入口。没有改已发布本地 CLI、Runtime、用户数据、包版本、Java/Vben/UI。
- `tests/cloud-http.test.ts`：真实 HTTP、临时独立 SQLite 和固定 Java 控制面契约 HTTP stub。该 stub 用于协议边界，不冒称已联调真实 Java 实例。

复用 PM 的 `CloudControlPlane`、`CloudTeamWorkspaces` 与 `cloudRequestId`。团队授权在每个 native/health 请求重新 introspect；body中的requestId按主体和团队命名空间转换后再进原生服务，不能重放另一用户响应。

### API

| 路径 | 行为 |
|---|---|
| POST `/cloud-api/auth/login` | 固定代理Java `/app/flymind/auth/login`，输入phone/password；sessionToken只写HttpOnly cookie，不回传JSON |
| GET `/cloud-api/auth/me`、POST `/cloud-api/auth/logout` | 固定对应Java认证接口，退出成功清cookie |
| `/cloud-api/teams` 及契约内 members/invites/transfer/leave | 固定Java路径映射，不接受任意上游URL；权限由Java权威校验 |
| POST `/cloud-api/invites/accept` | 固定邀请接受入口 |
| GET `/cloud-api/teams/:teamId/studio-api/health` | 返回该团队实际dataRootId和引擎能力，供NativeClient `bootstrapSession:false`；不暴露本机实例凭据 |
| `/cloud-api/teams/:teamId/studio-api/native/**` | 每请求授权后复用nativeRouter；write要求工作区头，保留CAS/幂等/质量/投影规则 |

Cookie为HttpOnly、SameSite=Strict、Path=/；HTTPS使用Secure及`__Host-`名。仅明确回环开发模式允许HTTP。拒绝外来Host、Origin、cross-site请求；cookie写操作和登录需要同源Origin。Bearer请求可用于非浏览器服务调用，不能通过不同Bearer+cookie模糊绑定身份。下载URL重写为团队前缀，并在下载时重新授权。

viewer允许读和创建导出/重试，不允许创建/修改/删除图或分组。导出容量不足在入队前返回503，其他团队正常读图不受导出队列满影响。

## 启动（待 PM 接真实 Java）

先设置独立云开发根，不使用local的`data`：

```powershell
$env:FLYMIND_CLOUD_CONTROL_PLANE_URL='http://127.0.0.1:<Java端口>'
$env:FLYMIND_CLOUD_DATA_DIR='<隔离绝对路径>'
$env:FLYMIND_CLOUD_PUBLIC_ORIGIN='http://127.0.0.1:5192'
$env:FLYMIND_CLOUD_PORT='5192'
$env:FLYMIND_CLOUD_DEV_LOOPBACK='1'
& 'C:\nvm4w\nodejs\node.exe' scripts/cloud-dev.mjs
```

生产要求固定HTTPS控制面/公开origin；反向代理须保留配置的公开Host/Origin，不能信任请求自选的forwarded身份头。当前入口默认只绑定127.0.0.1；内部网绑定另显式配置`FLYMIND_CLOUD_BIND`。资源沿已固定供应及`FLYMIND_RESOURCES_DIR`，无动态CDN。本切片不提供完整远程MCP/OAuth/协同room。

## 定向验证

1. `node node_modules/typescript/bin/tsc -p tsconfig.server.json`：通过。
2. `C:\nvm4w\nodejs\node.exe --import tsx --test tests/cloud-http.test.ts`：初始3项 **3/3通过**，总约36.7秒。
   - 登录cookie、错误Origin/Host、无Origin cookie写拒绝、冲突凭据、退出后失效。
   - 未登录不初始化团队根、相同ID在两个团队隔离、不同actor同requestId不串响应、root头/CAS/精确重放、viewer拒写、撤权后拒绝、未知路由404。
   - 实际`NativeDrawioRenderer`生成PNG任务，viewer通过团队制品URL下载，PNG签名/字节与manifest一致，跨团队404、未授权401，共享renderer最终close次数=1。没有mock图像替代原生渲染；临时产物测试后清理，没有保留用户数据。
3. 增加队列预算测试后，只定向执行 `--test-name-pattern='global export queue' tests/cloud-http.test.ts`：该项通过（其余3项按命令过滤，未宣称重新全跑）。模拟阻塞renderer验证容量1时另一团队新导出503、同团队普通读取仍可用、close中断活动任务并集中关闭一次。

Node20可执行文件在本会话普通沙箱被拒绝访问，以上SQLite测试获批准后执行；没有用PATH Node24重装better-sqlite3。初次HTTP测试的fetch未按预期发送自定义Host，修成node:http明确发送请求头，产品Host保护没有放宽。

## C02-B：三项风险收口（实现与定向证据）

本小批次只修改`server/cloud/http.ts`、`export-pool.ts`、`tests/cloud-http.test.ts`与本报告；消费PM新增`DiagramStore.nativeExportQueueState`，没有改Store其他函数。

1. **断开不是操作完成**：移除`res.close`释放逻辑。native路由在实际`json/send/next`完成才释放工作区和队列reservation，正常`finish`仅作已完成响应的确认。真实HTTP请求进入延迟create后destroy socket，再放行入库：没有客户端job轮询，任务仍被worker执行、持久状态结束。没有把传输断开当成取消操作。
2. **启动与周期恢复**：pool启动后分页读取明确云根`teams/<64hex>/flymind.sqlite`；每批默认16目录，内存队列仍最大32，满容量降低扫描频率且保留游标。root/teams/候选目录/数据库拒绝符号链接与越界realpath；缺库/未知格式不init、不seed。先只读验证现有native工作区metadata/任务表，再统一调用Store队列状态函数，不复制claim/queue SQL。
   - 有效running租约阻挡该team时保留entry，按`nextAttemptAt`唤醒；过期后恢复。扫描与唤醒定时器均unref、close时清理，无while busy spin；长租约唤醒间隔截断至60秒，避免Node定时器溢出。
   - 真实新Node20子进程从预置SQLite恢复一个queued和一个旧running租约任务，不接收任何HTTP/页面请求；两个任务最终执行。故障注入renderer有意拒绝图像生成，仅验证调度/租约恢复，不冒称这条新用例生成PNG。原C02-A真实PNG证据仍独立有效。
   - 原queued状态为`{pending:true,ready:true}`；claim后为`ready:false,nextAttemptAt=leaseUntil`；新进程渲染尝试时间均不早于旧租约到期。额外未知SQLite字节未变，空/非法目录未被初始化，指向local-only的junction未被纳入扫描。集中renderer close一次，新子进程实际退出。
3. **错误脱敏**：全局JSON formatter在路由之前安装，覆盖inner nativeRouter与outer异常。FS/SQLite代码或明显私有路径改为503 `CLOUD_STORAGE_ERROR`；未知5xx保留稳定code，移除内部message。测试注入inner EACCES含`D:\private\...`与outer 500内部细节，均不泄露。普通CAS/业务质量/授权4xx结构继续保留。

定向命令：

```powershell
& 'C:\nvm4w\nodejs\node.exe' --import tsx --test --test-name-pattern='aborted HTTP|sanitizes|fresh process' tests/cloud-http.test.ts
```

结果：**3/3目标项通过**，约6.4秒；其余4项按名称过滤，未声称重新全跑。服务端tsc通过。未再重复原生PNG大探针。PM可统一运行当前7项HTTP与workspaces测试。

## 仍未验收/未实现的范围

1. 当前仍单进程团队Store/单节点写入假设；没有部署级root租约/多副本room fencing，不宣称横向扩容安全。
2. 恢复只处理配置的、由部署管理员控制的cloudDataRoot；不迁入local根，不恢复未知库，不提供损坏SQLite修复。
3. A本批没有联调真实Java、没有做浏览器云UI登录，没有实现OAuth/HTTP MCP或多人重基。以上成功测试仅作为本切片验收输入。

请求 PM 审查当前核心并确定下一可靠性切片；不自行宣布C02整体通过，未提交推送。
