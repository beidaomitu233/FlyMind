# U38 独立网关受限发布

2026-11-01，可审实现，尚未据此安装或操作生产。U37业务/规则源与U35未提交字体性能修改分开。

## 已证实的发布缺口

线上网关工作目录是固定真实目录 `/opt/flymind/gateway/application`，应用工作目录才跟随current。既有forced-command仅有upload/fetch/application/Java，不能升级网关。仅发布应用无法替换旧网关initialize代码。

## 最小入口

新增 `gateway-promote.mjs`（root安装名 `flymind-gateway-promote.mjs`）及固定wrapper；dispatcher/sudoers只允许：

```text
sudo -n /usr/local/libexec/flymind-gateway-promote production run-ID-attempt archiveSHA256
```

- 不下载或执行候选ops。应用先完成原有tar核验/全文件root权限及字节校验、排空备份和晋级；网关再核同一release的完整manifest、prepared回执archiveSHA、当前应用目标及readyz。独立网关软链固定绑定该release/application，后续应用current切换不改变它。
- 复用应用 `.deploy.lock`，写token/PID/release归属；安全前置失败或已验证回滚成功才释放自有锁。排空/回滚不明保留锁并明确报错，不强杀或抢旧锁。
- 同目标重复执行只核实际进程cwd及官方OAuth metadata，不重复stop，不失效当前会话。
- 首次升级先正常stop、证实MainPID=0，再把原真实目录同父rename成 `bootstrap-时间-UUID`，保留原内容；原子切换软链，启动后验证实际PID的cwd与目标及OAuth issuer/token endpoint。失败恢复原真实目录/原软链并核就绪，不改env/SQL/data/service配置。
- 网关自身这次换代码会断现有MCP会话，客户端需重连；不承诺第三方客户端自动重建。后续同契约规则/业务升级由应用提供当前guide，是否同长会话完整刷新另由应用代理专项验证。

## 一次性静态安装

`install-gateway-publisher.py` 由PM在已授权root控制台执行。先将最终审查commit中 `gateway-promote.mjs`、`ssh-command.py` 放在root保护目录；使用该commit原字节SHA及线上旧dispatcher精确SHA调用：

```text
python3 install-gateway-publisher.py --source-directory /root/reviewed-gateway --publisher-sha256 NEW_PUBLISHER_SHA --dispatcher-sha256 NEW_DISPATCHER_SHA --old-dispatcher-sha256 ce137e7b612a8033e2bcb4fd47cad2e7da1e5116a808e9e2d124a59487c2cad7 --deploy-user flymind-deploy
```

安装器只安装publisher、wrapper、dispatcher和专用gateway sudoers，固定Node路径；校验全部源字节、root保护链和原dispatcher preimage，Node --check/visudo先行，取得既有app/CP各自锁。静态备份root0600，逐文件原子替换，失败恢复原字节/权限。无下载、service重启、SQL、环境、SSH key或账号改动。哈希由PM对最终commit冻结，不能把工作区CRLF hash与git blob混用。备份保留在固定libexec下私有随机目录。

## Actions

compact-deploy新增 `deploy_gateway` 布尔input，默认false；production/main/同run候选验证、Environment、并发锁照旧。只有明确true才传 `DEPLOY_GATEWAY_DEPLOY=true`；uploader顺序Java→application→gateway，任一失败阻断后续。服务器未安装入口前不得勾选。现app-only默认和权限不变。

## 验证与限制

本地Node定向：`node --test tests/cloud-gateway-deployment.test.mjs tests/cloud-deployment.test.mjs tests/cloud-full-stack-promote.test.mjs`，20项19通过/1项Linux原子软链替换在Windows明确跳过。覆盖第一次真实目录换链、启动失败原目录回退、排空失败不改路径、同目标幂等、锁归属、Java/app失败不触网关、配置拒绝；不把fake systemctl当Linux实机验证。

Python：`python tests/install-gateway-publisher.test.py` **4/4**，包含固定sudo命令、dispatcher精确白名单、源hash拒绝及临时文件失败回滚；既有 `python tests/cloud-ssh-command.test.py` **3/3**。Linux完整权限/原子软链和systemd实际排空/恢复仍由CI/PM独立验收；本代理未接生产、未提交推送。compact prepare及cloud-candidate source已接新Node/Python测试，compact pushpaths和candidate PR路径也包含新文件，不运行绘图大套。
