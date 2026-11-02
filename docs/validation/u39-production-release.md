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

部署工具修复`1705631ff1d79043ab918155ef0e58e3b809be41`已推送，[Linux发布工具41463417873](https://github.com/beidaomitu233/FlyMind/actions/runs/41463417873)通过（push校验模式，不含生产发布），Verify41463417877仍在运行。重复业务候选41463417983已取消，仍使用四门槛全部通过的c6ec126业务包。

[独立公网检查41463119883](https://github.com/beidaomitu233/FlyMind/actions/runs/41463119883)再次失败，域名和原1.14.176.76均不可达；原上传结束十余分钟后本机直连源站4秒仍无法建立连接。日志`output/u39-production-health-after-upload.log`。已询问用户当前控制台终端状态，尚未得到回复；当前保持不并发重试，不改发布基线检查、服务锁或权限。HTTPS备用仅准备并验证，尚未现场执行或声称部署成功。需要主机恢复且独立验证通过后继续。

## 用户要求本地备包与低负载重试

用户明确先在本地打好包再部署，并要求10分钟后进行。UTC15:30:53开始窗口，在UTC15:40:53（北京时间23:40:53）前不连接生产或触发部署，只查询GitHub/准备本地文件。Verify41463417877已最终success。

本地已取得并独立校验 `output/u39-deploy-local/compact/flymind-linux-x64.tar.gz`：15,123,368字节，SHA256 `9a72b63fbd4b056e9ea0e175ce07013ddb692e63995e5a41db44e85e9ac6b3ef`；tar内业务源c6ec126、release `run-41330814304-1`、Linux x64/Node22.23.3/ABI127，与已验CI原字节一致。证明在同目录proof，9,421项完整重放已由CI验证；不拿Windows依赖重编或伪造Linux包。该精简包需要服务器原41224699831基线，完整性仍由固定发布器验证。

现有服务器本来不运行npm/Maven编译，但全栈晋级会由Java/app两个调用各自还原完整目录并重复SHA检查。低负载方案改为app-only，保留Java与网关，不执行Java重启/MySQL备份；应用数据备份、单写者、完整SHA和回滚不省略。已实际 `git diff --exit-code 52b0f826 c6ec126 -- integrations/xinghui-admin/backend` 返回0，包含Java源码及全部迁移；没有SQL变更。workflow增加默认true的Java开关，只有app-only才要求两份已验源的backend全目录严格相同，否则必须走full-stack，不能任意跳过Java变更。PM本地发布相关22/22通过。

上述减少重复还原和重启，不表示服务器完全没有解包/复制/校验负担，也未证明上次上传中断的主机根因。等待窗口结束后先读ready核基线，再使用同一个已验包通过受限Actions的HTTPS通道进行app-only发布；不新增root工具或权限。
