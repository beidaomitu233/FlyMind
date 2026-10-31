# U38 云端持续更新与U37发布

日期：2026-11-01。状态：**已上线，应用与独立MCP网关均已验收。** 下文过程记录保留实际失败和修复；最终证据见末节。

用户明确授权发布本批，并重申本地固定配置、云端持续更新、不逐次手动重启。随后明确允许本次通过SSH部署；PM已用原固定主机身份完成本人扫码认证，未增加临时root密钥。版本保持1.0.0，不打tag。

## 交付范围

1. 纳入[U37](u37-guidance-incremental.md)完整绘图约束与增量修改修复；U36审计保留为依据，不扩大评分/配色API等未实施事项。
2. 远程每次工具调用先从授权应用取当前guide，读取失败不执行业务。每请求持有自己的规则快照，避免并发结果混用。规则/发布变更后，下一正常响应自动补发完整约束，随后发送短摘要；全文、JSON、PNG计入最终8MiB预算，不要求用户主动读guide或逐次重启。
3. 一次性补固定的受限网关发布入口：只发布已由应用发布器完整验证、当前生效的同一候选；校验归档SHA与prepared回执，固定服务、路径和权限。首次旧目录保留备份，停稳后原子切换独立网关软链，健康失败恢复原代码；同候选重试不再次重启。以后兼容业务/规则仅升级应用，网关保持连接。
4. Actions精简发布显式选择是否更新网关，默认不更新；应用、Java、网关分别有成功/失败证据。固定HTTPS地址、OAuth主体及18工具参数保持不变。

## PM实际检查

- 发布前公网`readyz`：`run-40213875235-1`、`ready=true`、`pendingWrites=0`。
- SSH只读确认应用、网关、Java均active；网关工作目录为root所有的旧真实目录`/opt/flymind/gateway/application`，不随`current`变化。
- 引擎关联74/74、MCP/文档26/26（含真实SDK跨两次应用重启、PNG与旧幂等回执）；完整build通过，173个预编译模块。日志：`output/u38-engine-regression.log`、`u38-mcp-regression.log`、`u38-build.log`。
- 长会话测试不先主动调用get_drawing_guide，跨应用升级后响应全文逐字匹配当前guide，工具schema/session/修订/历史PNG不变。隔离临时库及浏览器已清理；没有写生产用户图。
- 发布工具定向与Linux实际文件系统验证、候选来源及生产回执在完成后追加。

## 发布过程

- 首源提交`7fd304f1f6d95f5414856dddd0be855b66a71722`已推送。Verify `41224010252`通过：主回归412/412、CLI/发布工具11通过/1项Linux专测在Windows跳过。Linux发布工具workflow `41224010232`成功。
- 首候选`41224010216`被Windows源门槛阻止，234通过/1失败/1项Linux跳过；唯一失败来自新增发布测试把规范化后的实际路径与未规范化TEMP别名直接比较，错误断言还遮住了测试回滚结果。退回原代理：规范化夹具根目录并比较realpath，补真实目录别名回归；PM独立8通过/1项原有Linux跳过，生产代码不变。重新候选后才能晋级，不重跑失败提交冒充修复。
- 本次SSH离线传送并校验上述已提交source的三份静态工具，成功返回`GATEWAY_PUBLISHER_READY`/`serviceChanged:false`。已核publisher与dispatcher实际SHA、visudo与受限账号固定命令授权；应用PID1081、网关PID3412保持未重启。原始备份保留在root私有libexec目录。首次安装被精确摘要检查拒绝后未改服务，纠正终端换行抄录误差后才执行成功。
- 修正源提交`52b0f826aebdcef58f004a648d824763bcb6485f`的候选`41224699831`四门槛全部通过，Verify `41224699902`也通过。精简发布`41225859068`的1,682,043字节归档已收到服务器SHA确认，Java与应用分别返回成功；公网已为`run-41224699831-1`且ready/pendingWrites0。
- 该次网关晋级在停服务之前被就绪检查阻断。线上固定Node22.23.3实测：相同回环URL及相同Host/Origin，原生fetch返回403 HOST_FORBIDDEN，node:http请求返回200新release。精确修正独立发布工具的HTTP实现，不削弱应用Host校验；增加真实虚拟主机正负例、URL对象、拒重定向/压缩/超预算/截断/非法JSON验证。PM本地10通过/1项Linux专测跳过；静态工具更新及原发布作业重试仍待完成，不将应用已上线等同网关完成。

## 边界

本次首次替换旧网关会结束其内存MCP会话，部分客户端需恢复连接一次；之后兼容应用/规则更新已验证不要求逐次重启。新增工具或不兼容协议仍需兼容维护，不能保证第三方客户端永不重连。原本机STDIO不会自动变为远程连接，也不自动上传本地图；使用固定远程URL的客户才能随云端业务升级。

明确排除U35字体性能修改、旧artifact-fetch续传后备、其它任务PRD模板/图片/README草稿。没有新增SQL迁移，不修改账号密码或图形归属，不自动重排存量人工图形。

## 最终生产验收

- 业务源`52b0f826aebdcef58f004a648d824763bcb6485f`；[完整候选41224699831](https://github.com/beidaomitu233/FlyMind/actions/runs/41224699831)四门槛全部成功，[Verify41224699902](https://github.com/beidaomitu233/FlyMind/actions/runs/41224699902)成功。候选源码、真实JAR/MySQL8/Redis7及Linux/Windows真实PNG/SQLite均通过。
- [生产41225859068](https://github.com/beidaomitu233/FlyMind/actions/runs/41225859068)第二次尝试成功：复用原不可变候选和归档，Java回执`replayed:true`，应用成功，网关返回`ok:true/component:gateway`。没有跳过业务候选验证，也没有用重建候选掩盖第一次Host检查失败。
- 独立静态发布器修正源`1879560d20079e0490765b65e91c46dfc2e9ac63`；publisher SHA256 `82a41b2189325ca345636447f231d79992d78e1d9c81c68df309813ed8e55c05`。该工具由已授权SSH校验预映像、离线传送固定源码后安装，应用发布仍由Actions完成。新工具[Linux门槛41226614312](https://github.com/beidaomitu233/FlyMind/actions/runs/41226614312)、[Verify41226614239](https://github.com/beidaomitu233/FlyMind/actions/runs/41226614239)均成功。此提交只修独立发布器/测试/记录，没有替换已验收的业务候选。
- 公网HTTPS实际返回`releaseId=run-41224699831-1`、`ready=true`、`pendingWrites=0`，`engineResourceKey=ac48f2ec24a09565b4d2213d5c3e0d424e924174cab7c1058a73a8617e47b4b3`。OAuth issuer仍`https://fly.hui7.fun/`，token endpoint不变；无凭据访问`/mcp`返回401，未取消鉴权。
- 服务器独立核对：`current`的candidate来源是上述业务源；`/opt/flymind/gateway/application`已是绑定该release/application的独立软链，实际网关PID1550283的cwd相同，加载的编译模块含动态完整规则刷新逻辑。三服务均active，旧真实网关目录保留bootstrap备份，部署锁已释放。
- 用真实受限`flymind-deploy`身份、相同forced-command和同一归档SHA再次调用网关晋级，返回`alreadyCurrent:true/clientReconnectRequired:false`，前后网关PID相同。此次是真实systemd幂等验证，不是只用fake服务测试声称不会重启。
- 真实同一SDK跨两次应用升级的完整规则/PNG/幂等演练来自隔离测试；本轮生产没有新建测试账号、图形或修改用户现有图形，也没有假称对生产OAuth用户做过该写入演练。公网与服务器实际结果、生产日志及归档还原证据分别在`output/u38-production.log`、`output/u38-compact-proof/`，包括9316条目完整还原、原manifest字节保留。
- 本次SSH已正常退出。后续同契约业务、规则、布局更新走现有Actions应用发布，网关默认不重启；固定远程配置不变，正常更新不要求客户逐次重装或重启。首次替换旧网关的内存会话可能需恢复一次，第三方客户端行为不作无限承诺。
