# 按执行任务归组（本地 PM 验收通过）

PM已完成独立集成及实页验收，详见[总验收记录](task-groups-and-return-routes.md)。下方为开发阶段原始验证记录。

日期：2026-10-21。本片不提交、推送、部署或修改用户工作区，不改图内业务分层。

## 规则与兼容

- AI `create_diagram` / shared `createAI` 必须提供明确 `workspaceGroupId` 或 `taskName`。AI根据当前用户任务自行命名，不额外要求用户每次手填。缺上下文返回可纠正的 `TASK_GROUP_REQUIRED`，不创建图或分组。
- `taskName`在落图短事务内按规范名称匹配当前已有组；不存在时建组并创建图。名称规范化后再次检查1–80字预算；极端规范重名必须明确组ID。并发新图与同请求重试复用一组，失败不留新空组。组被改名后不能仅因旧hash ID命中而将新任务错归该组。
- `create_workspace_group`增加可选 `reuseExisting:true`，默认保留旧的同名报错行为。任务图优先直接使用 `taskName` 原子创建，后续沿用返回的组ID。
- 手工新建仍复用原弹窗：默认显式指定组、当前图所属组、或本tab最近成功创建使用的有效组；不按后台修改时间猜任务。可选已有组或按需一行新任务名，无“未分组”选项；任务未就绪时禁创建。
- 旧图不搬迁；旧API读取和修改保留。底层人工create仍兼容未分组记录用于原内部/导入链路；新的Web新建和AI创建执行强归组。现导入投放/预检目标不改；Web复制仍传源图明确工作区分组。不继承外部project组织数据。`content.groups`仍仅为图内分层，不是任务文件夹。

## 验证

使用Node20，在临时SQLite或SDK内存传输中运行：

```powershell
node --import tsx --test tests/task-groups.test.ts tests/native-ai.test.ts tests/native-mcp.test.ts
```

首轮24/24通过，覆盖缺组拒绝、并发/幂等复用、失败事务回滚、已有组复用、改名再建原任务、规范化长度、复制/导入目标以及AI质量/CAS/导出状态兼容。新回归文件：`tests/task-groups.test.ts`。

原有直接AI创建fixture补显式测试任务名；SDK新增缺组在发送API前拒绝及schema公布taskName断言。随后 `native-mcp.test.ts`、`native-activity.test.ts`、`cloud-workspaces.test.ts` 合计26/26通过，`vue-tsc -p tsconfig.json --noEmit` 与 `tsc -p tsconfig.server.json --noEmit` 通过。首轮cloud-oauth仅补既有只读scope拒写fixture，完整验证见下段。未操作真实浏览器、用户Runtime或上线；手工弹窗默认组/禁创建/归属显示仍待PM实页验收。显式legacy开发MCP不在本片接线范围。

PM集成退回补齐：cloud-mcp、cloud-oauth、cloud-mcp-updates中创建及同幂等重放统一补明确任务上下文，三目标文件串行8/8通过（测试控制面authority，真实Streamable HTTP及原生渲染）。六个原生MCP探针的创建、重放、质量负例参数同步，legacy质量探针使用其兼容workspaceGroupId；仅做语法检查，不重跑大探针。README、AI_DRAWING_GUIDE、TECHNICAL_DESIGN及绘图skill的创建示例同步taskName/已有组ID、稳定requestId，不改变版本或发布状态。
