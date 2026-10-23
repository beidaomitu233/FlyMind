# AUTH-23：前后台账号与管理登录修复

状态：PM本地限定验收通过；未提交、推送、部署或重置线上密码。集成证据见[本批验收](auth-documentation-20261023.md)。

## 已确认与修复

- 本地真实 Spring Boot/Tomcat + MyBatis-Plus 登录链复现：`POST /user/login` 成功；按原配置携带原样 JWT 请求 `/user/info`、`/user/router` 均返回业务 `code=201`，H2日志明确 `Column "tenant_id" not found`。
- baseline 的 `sys_user_role`、`sys_role_menu` 无 `tenant_id`，原租户插件未排除。只在当前 `application.yml` 补这两张关系表的排除项；原始 Flyway SQL未改，用户/角色实体表继续按租户隔离。相同 JWT 修复后 info/router 成功，实际路由有用户菜单。
- 线上仅由PM确认 login200、info/router201；未取得线上SQL日志，因此不能把本地根因称为线上日志实证。

## 独立凭据与兼容

- 新增 `V20261023_01__flymind_app_credentials.sql` 和 `app_flymind_account`；复用原 `sys_user.user_id`，不改团队、图形及FK。
- 启动时一次性兼容导入受控应用租户的普通账号及有应用成员/会话历史的双用途账号。已有独立前台凭据绝不覆盖；纯后台角色账号（包括角色暂时停用）不自动开通前台。
- 管理开通前台账号可复用已有手机号身份，但只创建独立前台凭据；新身份的后台哈希随机且无后台角色。后台登录要求实际启用后台角色。
- 前台新设/重置密码至少6个Unicode字符、非全空白、最多72 UTF-8字节，不要求组合；后台新设/重置/改密仍至少12字符，原有后台改密组合约束保留。旧密码登录不强制重新设置。
- 前台状态、密码不再改变后台状态/密码或撤销后台JWT；前台停用、重置和自助改密撤销全部前台应用会话、OAuth grant、设备grant。

## 自助改密契约

`POST /app/flymind/auth/password`，应用 Bearer，严格 body `{currentPassword,newPassword}`。

- 成功：HTTP200，`{code:200,message:"成功",data:{success:true,reauthenticate:true}}`。
- 原密码错误：HTTP400，`errorCode:INVALID_CURRENT_PASSWORD`，现有会话仍有效，可纠正输入。
- 真正的Bearer无效：HTTP401。
- 成功后重新登录；不返回密码/hash/token。

## 实际验证

`output/auth23-java-final.log`：五组40项全部通过，0失败、0错误、0跳过；包含真实Node→Tomcat本地授权及云OAuth组合。H2数据库与mock Redis明确隔离，未连接用户或线上数据库。真实MP用例在一个测试内先复现原配置异常再验证修复，故该日志中的两段缺列堆栈是预期证据。

```powershell
$env:JWT_SECRET=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
& 'C:/Users/12062/.m2/wrapper/dists/apache-maven-3.9.11-bin/6mqf5t809d9geo83kj4ttckcbc/apache-maven-3.9.11/bin/mvn.cmd' `
  -f integrations/xinghui-admin/backend/pom.xml `
  -s integrations/xinghui-admin/backend/build-settings.xml `
  '-Dtest=FlymindHttpRuntimeTest,FlymindAppAccountsTest,FlymindIdentityTest,FlymindSecurityTest,FlymindOAuthTest' `
  '-Dsurefire.failIfNoSpecifiedTests=false' `
  '-Dflymind.nodeExecutable=C:/nvm4w/nodejs/node.exe' package
```

PM已对最终停用角色识别与真实HTTP链独立复验：FlymindAppAccountsTest和FlymindHttpRuntimeTest共10/10、无跳过，包含Node组合调用；最终system-admin可执行jar已重建。日志`output/auth-docs-20261023/pm-java-integration.log`。没有遗留Maven进程。

## 未验证边界

- MySQL真实迁移及线上SQL日志、真实Redis与Vben部署登录由PM后续验收；本次不称线上已修复。
- 原Node/UI改密接线由PM独立负责，不在本报告冒充Java端测试。
- 未修改应用版本、用户当前密码、既有用户ID、团队或图形数据；无服务常驻进程。
