# C02：固定 draw.io 公开增量协议能力实验

日期：2026-10-19。状态：待 PM 验收；这是能力实验，不是协同产品实现。

## 范围与运行

- 脚本：`scripts/cloud-diff-sync-probe.mjs`。
- 命令：`node --import tsx scripts/cloud-diff-sync-probe.mjs`，本次 PATH Node **24.19.0**；没有实例化 SQLite/连接用户数据，不涉及 Node20/24 的 SQLite ABI。后续含 SQLite 验证须使用 PM 指定的 `C:\nvm4w\nodejs\node.exe`20.19.6，不重装现有依赖。
- 固定 draw.io **31.5.3**；项目固定 headless **151.0.7922.34**，使用已验收的 `launchHiddenBrowser` 私有管道及隐藏自有进程；一个本机独立静态 HTTP 服务、两个独立 browser context/iframe。
- 只调用公开 `configure/load/export/getDiff/patch/resetDiff/invokeAction/fit`；文案通过实际编辑器键入，位置通过真实鼠标拖动，复制用 Ctrl+D，删除/Undo 用固定原生公开 action。不调用 graph/model 内部 API，不改 vendor。
- 输出：`output/playwright/cloud-diff-sync/report.json`；`different-labels-* / same-field-* / positions-* / delete-copy-* / undo-* / acknowledged-undo-* / delete-incident-* / endpoint-protocol-* / autosave-*.drawio`，另有两端最终截图。
- 最终运行 exit **0**，13条实验记录，外联请求记录为空，自有浏览器/临时 profile 和静态服务已关闭。`ok:true` 表示预定实验执行完成，**不是所有并发场景都收敛**。
- 输出目录内旧 `failure-*`/`events-*` 为定位阶段残留，不是最终成功运行证据。定位修复：checksum 实际为 number；原先鼠标起点越过了可见画布，已用实际 DOM 命中断言和 XML 几何变化闭合；Delete 后空 diff 的根因是 shadow 未确认，不扩大超时掩盖。

## 实际结果

| 场景 | 观察与断言 | 能力边界 |
|---|---|---|
| load.diffSync/getDiff | 两端真实改不同节点，得到 `patch.u[pageId].cells.u[cellId].xmlValue` | patch 使用原生 cell ID，不等于业务 ID；xmlValue 包含整个 UserObject，不天然是单字段操作 |
| 不同节点同时改文案 | 先双方各改，再交叉 patch；两端完整原生视觉 signature 相同，strict投影保留两个文案 | 证明这一组互不相交修改可合并，不证明任意并发收敛 |
| checksum/resetDiff | 故意错误 checksum 得到 `checksumMismatch:true`；reset 返回新 checksum | checksum 为 number；不匹配是**应用后**信号，不是变更被拒绝/回滚，也不是安全哈希 |
| 同字段同时改文案 | A本地“甲客户端A”，B本地“甲客户端B”，各应用对方patch后分别得到B/A | **不收敛**。缺少服务器排序/重基/冲突规则，不能直接广播后宣称协同 |
| 不同节点同时移动 | 两端真实鼠标拖动60×30屏幕px，互换原生geometry差异；signature相同且与基线不同 | 比较完整几何，无坐标容差，无服务器全排 |
| 原生复制 | Ctrl+D产生新native ID，但fmId仍重复；两端视觉一致 | strict投影报 `DUPLICATE_BINDING`；现normalize可分配业务ID至4节点。必须增量确认规范身份，不能把未归一化副本作为正式项目保存 |
| 复制确认后删除 | 空闲时双方reset shadow，再原生deleteAll选中副本，发送删除delta | 两端恢复3节点、同signature；明确不删除原对象 |
| 未确认本地修改后Undo | A改甲，B接收；B改乙，A接收；A Undo恢复甲且保留乙，但A getDiff为空 | A shadow还在旧基线，Undo后的净状态与shadow相同，B仍保留旧甲，**不收敛** |
| 显式ACK基线后Undo | A改甲、B应用后，空闲时A reset确认；再收B改乙；A原生Undo并发回delta | 两端同signature，甲撤销、乙保留。仅证明空闲ACK的这组Undo语义，不证明ACK期间继续输入的重基 |
| 删除节点/关联线 vs 另一节点改字 | A原生选中丙并deleteAll，B同时改乙，然后交叉patch | 两端2节点/1边、同signature与严格业务投影，删除关联线不靠服务器补删 |
| 端点公开patch | 构造符合本地DiffSync cell schema的 `{target:'fm:node:c'}`，真实发送两端公开patch | 原生端点实际改变，strict投影的ab.target=c、两端signature相同。**这是协议输入，不冒称鼠标重连生成的差异**；鼠标重连与并发重连待后续专项 |
| autosave增量 | 开autosave，实际改甲，接收带patch/checksum/XML的autosave并转发 | 两端相同；随后getDiff已为空，表明autosave推进编辑器shadow，不等于服务器已持久确认。Host必须保留可靠outbox |

原生 `getDiff` 不会自行确认 shadow：它返回相对现影子的累计差异。实验中“新增后又删”若不推进影子，会返回净空差异，接收端仍留下先前新增。正确处理不是把空差异强行改成删除，而是维护每客户端已确认基线及连续pending。

## 必须冻结的服务端顺序与 pending 重基规范

以下是下一实施切片的要求，本实验没有写 room/server 产品代码。

1. **权威与命名空间**：room按服务端已授权 `(teamId,diagramId)`定位，单写入所有者/fencing；每事务分配单调seq，规范提交产生唯一revision。文档更新、幂等回执及广播outbox原子落库。人和MCP经过同一顺序点。
2. **事务信封**：`{clientId,opId,baseSeq,baseRevision,clientShadowSeq,patch}`。room join返回固定engine/adapter/protocol版本、规范snapshot/revision/seq；presence不改文档修订。opId绑定主体/团队，重复精确重放。
3. **客户端分三份状态**：最后确认的规范基线、已经发出但未ACK的操作、后续本地pending。autosave推进的native shadow不是服务端确认；每条autosave delta须先进入可靠队列，不因下一次getDiff为空而丢弃。
4. **旧基线处理**：server保留有界操作历史和必要的基线；旧base的patch先做可验证的重基，不能按收到顺序盲覆盖。`xmlValue`须解析为受限属性/受控字段变化，区分“改label”和“携带旧fm元数据”；不同字段能否安全合并要逐类验证。geometry、parent、terminals、style也各有冲突域，不能视所有cell更新彼此独立。
5. **同字段及结构冲突**：同字段不同值、删节点vs改节点、父子/容器竞争、端点并发改和锁必须给确定规则。首版可明确返回结构化冲突及原操作/当前revision，保留本地草稿，用户选择后新事务；不可静默LWW丢用户输入。不同节点能合并的已验证场景可自动处理。
6. **ACK/远端到达时**：根据seq去重，在当前规范基线上重放/变换本地pending，再以公开delta更新可见状态及影子。`resetDiff({xml:旧ACK})`会merge，不能拿旧A全量覆盖仍在编辑B。只有没有未确认/新输入且checksum一致的空闲点，才可使用本实验的简单reset确认法。未完成重基前不要把该方法推广为自动生产ACK。
7. **身份/投影**：服务器normalize得到的新fmId/受控字段清单以精确元数据delta确认；原生cell ID是同一复制对象身份。不得重新生成不同业务ID、恢复用户已删正文或按像素猜归属。正式revision必须通过strict project/内容校验；无效事务保留明确错误草稿。
8. **Undo**：本地只撤销本地用户事务；远端patch不得变成用户撤销目标。根据真实ACK时序、pending重基和native undo栈验证，不能通过load清栈“解决”协同。该实验正反两例必须保留为回归。
9. **重连/恢复**：LastAckSeq后补日志、同opId重放，房间重启不会重复提交。checksum不同提示恢复，不把完整旧snapshot静默覆盖活跃客户端；日志窗口过期须显式可恢复流程。
10. **MCP写入**：用最新expectedRevision，在room序列内执行现patchDrawio/validate/Store提交，发原生delta给人；导出固定正式修订快照。AI内容仍不接受坐标。成员撤权、readonly与锁在每事务核验，不以房间连接存在作为授权。

## 下一步与未验证项

- 本批已足以确认公开协议可复用及“裸广播不等于协同”。尚未实现服务端rebase、durable outbox、断线恢复、身份ACL与统一提交适配，不据此启用多人功能。
- 真实鼠标重连生成差异、并发同字段冲突选择UI、ACK在途继续输入、中文IME未提交、跨容器和复杂受控字段/group/锁的同时编辑，需要按上述规范分别验收；不可由两端简单例推断通过。
- 新增/复制fmId规范ACK及投影不能直接修改当前产品保存路径；应由下一明确切片冻结接口后实施。
- 只新增本probe与本报告；无vendor、产品源码、版本或用户数据改动，未提交推送。
