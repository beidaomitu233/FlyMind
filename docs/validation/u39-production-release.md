# U39 生产发布记录

2026-11-02，用户明确要求“部署吧”，沿用本批提交/推送及Actions发布授权，不改版本号或标签。

## 已验证来源

- 业务源 `c6ec126605b62dc00b7af255a56992b29bcdc6cc`。
- [完整候选41330814304](https://github.com/beidaomitu233/FlyMind/actions/runs/41330814304)的source、真实Java/MySQL/Redis、Linux和Windows四门槛全部成功。CPU保护9项通过；云/本地契约255通过、无失败，Windows不适用Linux软链项跳过；UI56/56。两平台各6类真实PNG/SQLite烟测成功。
- [Verify41330814407](https://github.com/beidaomitu233/FlyMind/actions/runs/41330814407)同源成功，主回归429/429；附加14通过、1项Windows不适用Linux专测跳过。
- 发布前公网ready实际为 `run-41224699831-1`、pendingWrites=0、HTTP200约119ms。只选择该已部署候选41224699831作基线，不更换数据库、账号或用户图，不重启稳定MCP网关。

## 首次生产尝试

[Actions41460296256](https://github.com/beidaomitu233/FlyMind/actions/runs/41460296256)：prepare成功，原候选与基线来源、完整Linux还原树均通过。production在上传阶段失败：15,123,368字节归档，至330秒本地仅4,980,736字节进入SSH输入队列，427秒报 `SSH_INPUT_FAILED`。未得到upload-confirmed，客户端没有执行后续Java/应用promote命令；本地发送队列数字不能当作服务器已接收/fsync的字节数。

期间公网域名与固定1.14.176.76源站均TCP连接超时。新版本尚未执行，不能把此次不可达归因于新CPU保护、应用切换、数据库迁移或新绘图任务。实际主机/公网故障仍需恢复后读取现场日志；没有盲目重启、删除锁或并发晋级。原失败日志留在 `output/u39-production-failed.log`。

## 有界传输后备

改为暴露已有的受限artifact-https通道，服务器只接收短时下载能力并主动HTTPS取包，保留固定GitHub API来源、官方存储主机校验、ZIP/tar双摘要及原服务器发布入口，不增加root权限或长期凭据。

必须区分两种来源：业务candidate仍绑定41330814304/c6ec126；精简归档是当前compact workflow的 `flymind-compact-linux-x64` artifact，不能错误地从业务source run取完整Linux包。显式artifact producer run/name/SHA三项绑定当前workflow，业务manifest身份仍独立校验。未知名字、半覆盖、来源/摘要不符均拒绝。最终生产回执随后追加，不以传输后备已准备代替上线。

PM已审查并独立运行传输/发布相关回归：23项中22通过、1项Windows不适用Linux权限专测跳过，0失败；日志`output/u39-https-transport-tests.log`。代理专项7/7通过，既有服务端helper/SSH权限不变，不混入未提交的artifact-fetch续传草稿。不重建业务候选；仅发布工具读取当前compact制品的来源有独立绑定。
