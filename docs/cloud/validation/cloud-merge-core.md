# C03-M 协同渲染状态合并核心

2026-10-19，PM 实现并验证。仅核心切片，不等于实时协同产品已交付。

## 实现

- `mergeNativeSnapshots(base,local,remote)`：服务端历史为基线，节点/元数据属性/几何坐标/样式属性分别三方合并；同字段、删改竞争、插入身份碰撞、堆叠顺序冲突显式拒绝，不静默覆盖。路由点数组作为原子字段，引用和页身份重新校验。
- `nativeProtocolPatch(from,to)`：固定 draw.io 31.5.3 公开 patch 格式，从实际可见快照计算 delta；不依赖 autosave 已推进的 shadow。支持原生 cell ID、元数据、几何/线端、插入/删除与 sibling previous。当前只覆盖 cell 和页名变化，页面级渲染属性同步还未接入。
- `NativeDiagramService.saveCollaborativeEditor`：独立于原本机严格 CAS 保存。读取持久历史、合并当前正式快照、归一化原生编辑、验证投影，CAS 提交；竞争至多4轮。幂等摘要使用原始输入，确认丢失后同请求可重放原修订；持久修订就是顺序号。未挂 HTTP，不存在绕过团队鉴权的公开入口。

## 实际验证

`C:\nvm4w\nodejs\node.exe --import tsx --test tests/cloud-merge.test.ts`：6/6。含独立节点/同字段、同节点文本+坐标与样式、页/引用拒绝、公开patch结构、真实临时SQLite并发得到r2/r3、重启后幂等回执、冲突不改库和旧本机CAS拒绝。

`C:\nvm4w\nodejs\node.exe --import tsx scripts/cloud-merge-probe.mjs`：exit0，实际固定后台Chromium + 两个独立上下文 + 临时SQLite，无外联。三个真实场景全部通过：

1. 两端同时原生键入不同节点，服务端合并r2/r3，公开patch后两端完整drawioRenderSignature等于正式快照。
2. 收到远端后原生Undo，只撤销本人内容，保留对方节点；保存r4后两端一致。
3. 原生Ctrl+D复制，服务端规范fmId，增量metadata ACK和对端插入后3节点、两端完整signature一致，r5。

证据：`output/playwright/cloud-merge/report.json`、两端截图。自有浏览器/HTTP服务及临时DB已关闭清理。不是鼠标并发重连、网络断线或真实Java权限验证；没有使用用户当前数据。

## 接入门槛

仍需云端专用鉴权接口、工作台持续收取已提交修订、ACK期间新编辑重基、可靠草稿/断线恢复、同字段冲突选择、权限撤销和实际MCP/双Web集成。只从probe调用service不宣称产品可协作。页面级背景等属性同步须补齐或明确拒绝，不可返回成功却不应用。
