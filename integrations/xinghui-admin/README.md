# 星辉管理后台受控源码副本

本目录来自 `D:/changhuiengineer/DevProject/xinghui-admin2` 的两份正式主仓库，2026-10-19按C01授权复制。未复制历史worktrees/Reference，也未建立嵌套Git。

- `frontend/`：Vben Vue管理端，正式UI/apps/web-ele及workspace依赖闭包。来源HEAD `e313de8bd9c92924efdba64b99452917e72b24b0`。
- `backend/`：Java17/Spring Boot管理后台，保留common/system-framework/system-admin/web-admin/web-app。来源HEAD `ff68475be7aeaa941fe62c78aa66272f075178fb`。
- 逐文件来源、字节数、SHA256及排除原因见 `../flyMind/docs/cloud/ADMIN_COPY_MANIFEST.json`；复用审计见 `../flyMind/docs/cloud/ADMIN_REUSE_AUDIT.md`。

## 当前边界

源码复制后已完成Java核心切片构建与H2定向验证，尚未完成真实MySQL/Redis启动与前端验收。源环境配置、默认JWT签名key文件和账号种子没有带入；目标已新建环境占位配置、强制JWT_SECRET类及显式空库bootstrap，详见backend/DEVELOPMENT.md。不得连接源数据库或使用源凭据。

保留Java控制面和Vben `/admin`，FlyMind继续保留原绘图UI。团队将作为独立业务对象：统一受控tenant下的账号通过membership加入多个团队，不能把原SysUser单tenantId直接命名为团队。账号授权、本地授权、多人协同与远程MCP尚未实现，复制后的C01第一切片已新增Java应用会话、团队与Vben管理API接线；其他能力尚未实施，详见backend/DEVELOPMENT.md。

前端原MIT及Vben版权已保留。后端未发现明确许可证文件，公开分发前须确认权利与第三方声明；FlyMind的MIT不自动覆盖该源码。后续修改先按PM冻结计划分批实施，不改源仓库，不自动迁移任何用户数据。
