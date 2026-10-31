# U37 强制发送绘图规则与增量修改修复

日期：2026-10-27。状态：**本地限定验收通过，未提交、推送或发布。**

## 用户选择和范围

按U36审计后的用户决定，先同步本地/远程较完整绘图约束，并修复增量修改。保持内容/渲染分层与现有18工具参数契约；本批不做评分机制改革、配色配置入口扩展或新的业务概览模型。

## 分工与设计

- 固定dev_application：MCP初始化自动携带指南与正式标准，远端从已绑定当前应用读取权威规则；创建/修改工具说明及结果/错误回执发送明确约束，不新增确认弹窗或guide token。初始化发送能保证服务返回规则，不能保证所有客户端模型都遵循。
- 固定dev_engine：局部安全放置新增/归属变化对象，优先参考业务邻居和方向，避让全局节点/容器标题等；新对象采用本类型风格；保持无关人工对象，不全局重排。无安全空间时明确拒绝，新失败不提交半成品。
- PM：独立审查和实际MCP集成，保留用户数据及其它未提交内容。本批不提交推送、不改版本、不从本机SSH或发布。

## 验收门槛

1. 不先调用guide，SDK initialize已取得完整绘图约束；两端都覆盖内容类型、简洁、真实关系、任务分组、修订/幂等、增量保留和图片交付。
2. 远端初始化取到当前应用规则；读取失败应明确失败，不回退固定网关旧规则。18工具外部参数及structuredContent兼容。
3. U36复现的新增Redis不再覆盖原节点/分组标题，不退回通用紫卡；新对象和同类型首次绘制策略一致。
4. 连续新增、文案增长、归属调整和受影响连线保持安全；无关人工几何/样式/图标及锁不改变，不以全局重排假装增量修复。
5. 历史已有布局问题不一律阻塞普通无关改字，但不能新增或加重被改对象的布局错误；无空间拒绝后完整源项目和数据库修订不变。
6. 真实隔离云端MCP创建→修改→PNG与源文件交付通过；记录实际测试和限制，不把合成小图等同所有复杂图已解决。

## 实际结果

### 规则发送

- 工厂在构建SDK server之前读取完整指南与正式标准；远端通过当前已绑定应用的 `/guide` 取权威规则。读取失败、结构无效或空规则时初始化明确失败，不静默返回固定旧网关规则。本地初始化只读文档，不提前启动Runtime。
- 实际Streamable HTTP SDK在未调用get_drawing_guide前已收到8988字符，包含完整标准和增量执行要求；仍为18工具，外部参数及structuredContent保持兼容。
- 创建/patch/update说明包含从材料提炼业务、最新修订、稳定ID、保留无关内容与人工结果、检查quality和实际PNG、失败不重建等要求。成功写回执与工具业务错误附同一正式标准里的短摘要，不每次重复全文、不写后再额外请求指南。摘要标明最近成功取得和标准版本；显式读取guide后刷新，既有长会话初始化全文不会自动重发。
- 最终回执将摘要开销纳入8MiB预算；若因此不能内联PNG，保留已保存身份、原内容、导出状态、job和下载资源，标预览过大，不冒充导出失败或重建图。
- 正式标准、AI指南与skill一起更新；说明准确标注公开配置入口仍仅支持relayout/orientation，本批没有借提示词宣称配色入口已修复。

### 增量修复和退回

- 新节点/分组/边与首次编译共用类型视觉策略，修复技术节点退回紫卡；已有人工样式、图标与几何不套模板。六型小样本及完整技术24节点样本的首次XML仍与U36字节SHA相同。
- 按真实前后置邻居/父主题及方向，在最多512个有限候选中避让全局业务节点、容器标题、旧标签/线路与非目标分组；目标分组只在不会扩大对外冲突时扩容。不移动其它节点，不做ELK全排。
- 局部修改末端比较原有/候选冲突对象对和冲突量，不能只用“已有相同错误代码”放过加重的重叠或穿越。历史缺陷可原样保留，不一律阻止普通无关改字。
- PM第一次真实SDK集成发现“新增Redis并带缓存连线”的常见操作仍报ROUTING_LABEL_NO_SPACE。已退回原代理，精确复现后将incident边标签预算纳入局部候选/邻居间距；没有删除标签或缩减测试。原集成脚本第二次实际通过。

### PM独立执行与证据

```text
npm run build
node --import tsx --test --test-concurrency=1 tests/native-mcp.test.ts tests/cloud-mcp-updates.test.ts tests/drawio-incremental-layout.test.ts tests/drawio-technical.test.ts tests/drawing-quality-layout.test.ts tests/drawio-layout.test.ts tests/drawio-editing.test.ts tests/drawio-engine.test.ts tests/native-business-service.test.ts tests/flymind-documentation.test.ts
node --import tsx output/u37-mcp-integration.mjs
node --import tsx output/u37-storage-atomic.mjs
```

- **97/97、0失败、0跳过**，完整构建通过，日志 `output/u37-pm-regression.log` / `output/u37-pm-build.log`。新增增量测试已接入package默认test和候选CI真实执行入口，原生MCP初始化测试也补入候选CI。
- 实际MCP/Chromium/临时SQLite链路：连接完整规则→创建技术图revision1→通过编辑保存接口人工改Vue填色/描边/图标rotation12至revision2→AI新增Redis及“缓存”连线至revision3→原节点改字至revision4→完整update删除新增对象至revision5。每轮返回真实PNG/规则摘要；所有旧节点几何/人工样式和图标签名保持，最终layoutIssues为空。PM实际查看 `output/playwright/u37-pm/technical-added.png`，Vue人工黄色卡与旋转图标保留，Redis透明图标风格及标签正常；同目录保留drawio/report.json。
- 旧revision冲突返回原错误和规则摘要，图形不变。另在真实SQLite服务里放入合成拥挤分组，新增无空间时完整项目和revision1均不变；证据 `output/u37-storage-atomic.json`。不是只比较纯函数输入就声称数据库原子性。
- 引擎代理的70项定向、3张真实原生PNG/SVG/源文件证据详见[增量专项记录](u37-incremental-layout.md)；PM分别审查了技术/流程图输出。没有将小合成样本称作所有复杂业务图质量已解决。
- 以上全为自有临时库/回环HTTP，结束已关闭连接与隐藏浏览器、清理临时数据；没有调用生产账号或修改用户图形。

## 部署依赖和剩余边界

1. 线上独立网关使用 `/opt/flymind/gateway/application`，现应用晋级只切换current目录。**仅发布应用或更新指南文档不能改变旧网关75字符的initialize；后续发布必须同时升级网关供应，再由客户端重连。** 本批没有绕过受限Actions、扩大SSH权限或部署；没有新的提交/推送授权。
2. 服务端能保证发送规则，并执行现有质量/几何准入，不能保证所有客户端都展示或模型都遵守。已有长会话用get_drawing_guide刷新，重新initialize才自动重发完整规则。
3. 局部空位与标签间距是有限安全策略，不能保证任意拥挤图都可原位插入；失败需用户明确选择整体重排，不挪动无关人工对象。没有新增最少折线、任意复杂图零交叉的承诺。
4. U36提出的评分机制、业务来源核对、概览/主次表达、完整配色配置入口仍不在本批。本批不宣称它们已解决。
5. 版本仍1.0.0，保留U35以及其它任务未提交内容；未将性能修改、部署后备或PRD模板混入本批结果。
