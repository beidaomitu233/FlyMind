# AUTH-23：通过 Actions 发布控制面

2026-10-23。最小发布代码已实现并通过本地隔离验收，真实Actions和目标机控制台初始化尚待验收，不是已部署说明。用户要求停止本机直接SSH；本机扫码会话已关闭，不再以临时root密钥或手工上传替代Actions。

## 当前缺口

`cloud-candidate.yml`已测试并打包Java、admin及绘图应用；新增独立`flymind-control-plane-promote`先处理Java，成功后才调用原app/admin晋级。生产完整栈开关必须显式启用，手动部署限main同run全部检查通过；源码/真实控制面/平台互为门槛。旧服务器尚未安装新受限命令，生产自动开关保持关闭。安装细节见[控制面Actions](CONTROL_PLANE_ACTIONS.md)。

本批本地证据见[验收记录](../validation/auth-documentation-20261023.md)。用户已授权本批提交、推送合入main并继续Actions发布；不改版本号，不从本机SSH，完整发布链验收前不启生产自动开关。不得伪造干净来源或使用旧bcb643a候选冒充本批代码。

## 最小实施顺序

1. 获授权后提交已验收修复，沿现有main源码与Linux平台验证生成同一次run的不可变候选。生产前确认JAR、application、admin对应同一source SHA及清单摘要。
2. 在仓库实现独立的控制面发布命令及隔离测试；管理员从已审查源码，通过**服务器控制台一次性安装**root所有、部署账号不可写的入口和精确sudo/forced-command白名单。现有受限账号没有修改这些文件的权限，不能通过候选自带ops或开放任意shell绕过。
3. Actions仅调用固定命令，参数限制为环境、releaseId和SHA。它从已校验的同run候选读取`control-plane/system-admin.jar`，不接受任意URL、JAR路径、shell或服务名；固定目标/服务从root私有配置读取，不信上传者环境。保留现有私有env、数据库专用账号及身份ID，不启bootstrap、不打印密钥。
4. 维护时暂停新登录/写入并等待在途操作收口；先验证可用的MySQL备份及当前Flyway版本，再备份旧JAR，安装新JAR、重启既有控制面服务，检查迁移完成、就绪与权限。此次新增`app_flymind_account`，不删除旧凭据或关系表，不重置用户密码。
5. Java验证通过后，使用原绘图应用晋级流程更新application/admin，再验收同源端到端链。若失败，不继续后续晋级；保留失败原因与旧JAR。仅在确认新增schema向后兼容时回退代码，不自动用旧数据库覆盖已确认写入。Node的migrationLevel不代表MySQL可回退。

## 必须验证的完成条件

- 受限账号可执行上述固定发布，其他命令/路径/来源被拒；并发发布互斥；无本机SSH操作。
- 同一run制品来源、摘要、权限、备份、迁移及失败处置的隔离测试通过；目标主机一次性入口安装有实际证据。
- 后台真实login→info→router成功；前台测试账号登录→自助改密→旧前台会话/OAuth/设备授权失效→新密码登录。后台凭据和后台会话不受影响。不要用真实管理员的密码测试代替隔离测试账号。
- 原团队/图形归属保留；创建、编辑保存、PNG导出与固定MCP授权正常；维护后协同恢复。
- 记录运行ID、source SHA、Java和应用实际release、迁移版本及就绪结果。全部通过后才开启后续无人值守生产更新。当前以上服务器条件尚未验收。
