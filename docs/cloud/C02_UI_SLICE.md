# C02 云端工作台薄接线（待 PM 验收）

2026-10-19。本切片只改前端，不宣称 C01/C02 整体通过或公网可用。

## 实现

- 新入口 `/#/cloud?team=<id>&diagram=<id>`，复用 NativeStudio 原侧栏、画布、标题、工具、创建、导入与导出。
- 手机号/密码通过 `/cloud-api/auth/login`，身份读取 `/auth/me`；仅同源 HttpOnly cookie，不把令牌/密码写入 localStorage。密码请求结束清空。
- 选择团队来自 me 列表；每个 NativeClient 固定 `/cloud-api/teams/<id>`，禁本地 Runtime bootstrap，health 后固定 dataRootId，写请求沿用 workspace header/CAS/requestId。
- NativeStudio 默认本地行为不变，新增 apiBase/clientOptions/draftRepository/readOnly/interactionLocked 注入及 prepareLeave 方法、account slot。
- 换团队/退出先走原 capture+flush+草稿保护；网络操作期锁定旧工作台交互，避免保存检查之后继续编辑。URL 显式团队，无全局 active-team cookie。
- 草稿数据库按 userId+teamId 隔离，原草稿键继续含 dataRootId。退出卸载工作台，新账号不枚举旧账号数据库；不回放本地旧 localStorage。
- 成员按需弹层接入邀请（已有账号）、角色修改、移除、转交、退出；账号菜单提供创建团队、接受邀请和退出登录。权限仍由服务端逐请求验证。
- viewer 画布和写工具 inert、侧栏写菜单禁用、额外 transport 拒绝非导出写入；仍可读图和生成/下载导出。目前未给 iframe 注入真正 viewer 模式，因此只读画布不能直接平移/缩放，后续可由 Host 只读接口改善。

## 实际验证

- `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`：通过（最终修改后）。
- `node --import tsx --test tests/cloud-client.test.ts`：6/6；注入 fetch 的 cookie、团队路径、根 header、草稿命名空间、viewer 写拒绝/导出允许、管理 API 与错误语义。
- `node node_modules/vite/bin/vite.js build`：通过；最终日志 `output/cloud-ui/build.log`，生成 CloudStudio lazy chunk。
- 未启动 Runtime/Java/容器/浏览器，未写业务库，未改服务器、Java/Vben、引擎、包版本或依赖。

## 尚未验证

真实 MySQL/Redis 完整启动、Java→Node→浏览器登录、跨团队同 ID、真实 IDB、编辑与导出下载、viewer 服务拒写、会话撤销/过期及多 tab 账号变更。跨 tab cookie 换账号时当前页面尚未主动重新认证/自动隐藏旧画面；需联合阶段明确验证并补身份变更收口，不能声称该边界完成。
