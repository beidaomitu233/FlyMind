# 管理前端 C01 小切片

保留Vben/Element Plus，当前仅接真实用户与团队管理。登录为手机号密码及实际captcha；无假注册、扫码、社交、验证码登录或找回流程。默认登录首页为 `/flymind/users`，导航来自Java bootstrap生成的M/C用户、团队菜单。

安装使用packageManager锁定pnpm10.28.1及现有pnpm-lock.yaml，不改依赖版本。不得把原源node_modules做可写junction。本次副本依赖与store独立，日志install.log仅为开发证据。

`apps/web-ele/.env.example`是无秘密公开环境模板：`VITE_BASE=/admin/`、hash路由、API `/api`。可复制为自己的本机配置或通过进程环境提供；不要把用户密码/令牌放进VITE变量。开发代理用`ADMIN_API_PROXY_TARGET`指向新隔离Java服务，默认127.0.0.1:18080，生产网关需将 `/api` 正确路由到控制面。

```powershell
npx --yes pnpm@10.28.1 --filter @vben/web-ele typecheck
npx --yes pnpm@10.28.1 exec node scripts/build-flymind-admin.mjs
```

以上仅静态类型/构建，不代表MySQL/Redis完整启动或浏览器操作验收。新用户行“更多→重置密码”关闭对话框即清空密码；重置/停用会撤销该用户全部应用设备会话。平台仍走旧Admin JWT+方法权限，不使用普通app token授权管理页。

已完成固定pnpm10.28.1 frozen-lockfile安装及web-ele类型检查；基线错误/最小修复详见TYPECHECK_BASELINE.md。构建需先运行工作区依赖图，不直接依赖源码目录已有dist。

最终复现构建必须使用scripts/build-flymind-admin.mjs：源环境helper只读.env文件，脚本从无秘密模板以wx创建临时production.local，执行既有Turbo依赖图，finally仅删除本次原字节文件；操作者已有文件则拒绝并原样保留。已受控验证EEXIST保护。产物静态核对/admin/、/api、无hm.baidu.com，摘要见.validation/build-result.json（214文件、3,462,977字节，treeSHA256 ebe9d4b6a37f0fde500103e763fc954a3fa2240728751ef1fbf6add1faec15e2）。这不是实网登录验收。
