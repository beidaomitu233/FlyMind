# U34 发布 U31–U33

日期：2026-10-26。用户明确要求“推送上线”，授权本批提交、推送及通过 GitHub Actions 发布；不改版本号、不打标签、不从本机 SSH。

**最终状态：已上线。** 业务源 `2d4a27ab43179bbcd11e1a94f99c4e606071ca3c`，完整候选 [40213875235](https://github.com/beidaomitu233/FlyMind/actions/runs/40213875235)、Windows Verify [40213875139](https://github.com/beidaomitu233/FlyMind/actions/runs/40213875139) 全部成功；精简生产发布 [40215091552](https://github.com/beidaomitu233/FlyMind/actions/runs/40215091552) 的 prepare/production 均成功。公网实际 `releaseId=run-40213875235-1`、`ready=true`、`pendingWrites=0`。本记录的发布前状态为过程历史，以下最终验收覆盖它。

## 目标和来源

- 首页整卡交互、统一 Agent 安装提示、大卡引导；原生引擎固定资源缓存、两槽复用和欢迎页预热。
- 横竖切换和自动排版的平稳加载反馈，失败恢复及同请求重试。
- 前台自助注册、安全会话、个人空间与六位用户 ID，与后台权限隔离。
- 原生产基线只读核对：`run-40090921255-1`，`ready=true`，`pendingWrites=0`。仍使用既有精简 Actions 路线；旧全量自动生产开关关闭，不将推送等同上线。

## 发布前审查

复用原两位开发代理，PM统一审查和暂存。关联本地验收见 U31/U32/U33 记录，真实公网结果待发布后追加。

1. 注册同源检查在 Express 路由大小写/尾斜杠变体下存在缺口。已退回修复为注册专用中间件强制同源，变体无Origin+Bearer及跨域必须403；完整HTTP/客户端/表单32项通过。
2. 候选源码门槛补齐新增的交互/引擎/注册测试；Java `Flymind*Test` 已包含新注册测试。
3. 真实 JAR/MySQL8/Redis7 烟测补匿名注册生命周期、同手机号并发409和真实注册限频；不更改受限发布器证据协议，不添加新SQL迁移。
4. 上次旧 Verify 的唯一失败为 Windows Runtime owner.json 原子替换偶发 EPERM。按真实失败位置修复短暂文件共享冲突：有界重试原子rename、每次检查所有权、失败只清自有临时文件，不删除目标或重试整个启动。

保留并排除：旧 artifact-fetch 续传后备/测试/workflow；其它任务 PRD 模板、示例、图片及 README 链接；历史 U30 状态草稿。实际提交列表在暂存后逐项审查，禁止把日志、用户数据库、凭据或浏览器数据加入制品。

## 执行状态

发布前复核（历史状态）：交互/引擎/注册关联65项通过；Windows Runtime及原生HTTP关联27项通过（含3项真实文件共享场景）；新增注册smoke本地夹具10项通过。完整构建与发布来源门槛17项通过，真实MySQL/Redis由Actions执行。当时尚未推送或部署，随后按下述结果完成。

首个业务提交 `e2852428b1a169629c41e7ffefb49a710764216a` 已推送。完整 Verify 的 verify job 成功；候选 `40213435114` 在旧 local-auth UI probe 的单iframe定位断言失败，未进入生产。原代理修正两个探针为唯一活动iframe、总量最多2，按稳定iframe身份计算load，保留正常同步无重载检查；显式冲突恢复增加完整服务XML与实际节点可编辑验证。本地授权3项、完整云端双客户端12项均实测通过，日志 `output/u34-local-auth-ui.log` / `u34-cloud-ui.log`。本次修正只调整探针对已验收双槽的识别，不放宽保存/冲突/隔离门槛；随后重新构建候选。

## 最终生产证据及边界

- 候选 source、真实 control_plane_runtime、Linux 和 Windows 平台全部成功。真实打包JAR/MySQL8/Redis7完成4个匿名注册、3组双并发（每组1成功+1重复409）、第6次手机号注册尝试429；注销重登身份/个人空间稳定，既有管理员和前台密码隔离回归继续通过。并发HTTP未使用产品调试接口强制制造相同RR快照，口径保持明确。
- 真实 JAR SHA256 `fd0a70ce3f567bc31eca71795596e68844291cbfe168c6997ad2b7eba0f4cdb7`，runtime证据源码身份同上述提交；SQL仍原11项，无新增迁移。证据 `output/u34-real-database.log` / `u34-runtime-evidence/`。
- 增量包1,900,046字节，SHA256 `92b0daba1b93051b8492434d69f289c85115b2a015465a1afb87fd5364a4fe0d`；实际Linux还原核对9311条目及原始manifest，复用650,613,301字节既有资源。75秒收到服务器上传确认，随后Java及应用各自返回 `ok:true` / `run-40213875235-1`。证据 `output/u34-compact-proof/`、`output/u34-production.log`。
- 公网HTTPS健康接口为新release且待写请求0，engineResourceKey为 `31a86a1ca6944ac92e5c01f0acbf9798a388a279e9a268c087e6552eda1d46ae`。
- 公网注册：同源无效手机号返回400 `INVALID_REGISTRATION`；大小写/尾斜杠变体带Bearer但缺Origin或跨域均403 `ORIGIN_FORBIDDEN`，全部no-store且不设置Cookie。未通过这些无效请求新建账号。
- 真实线上浏览器仍保留原用户登录，欢迎页三个整卡入口、现有分组/图形列表正常；点击连接卡出现支持任意MCP Agent的两步简化说明，没有客户端切换和旧高级CLI区域。截图 `output/playwright/u34-production/welcome.png`、`agent-connect.png`。
- 未退出或更改用户原会话，未新增线上测试用户/图形、未修改用户图的排版。注册成功、编辑和加载过渡的完整操作由隔离实页与上述真实基础设施/双平台门槛提供证据，不假称对生产用户图执行了这些写入测试。
- 全程应用发布由Actions执行，无本机SSH、版本号或标签变更。其它任务未提交文件仍原样保留。
