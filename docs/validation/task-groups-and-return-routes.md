# 任务分组与外围回流路径

2026-10-21，本轮本地优化完成并通过PM独立集成验收。未提交、未推送、未更新版本；未恢复此前上线诊断。不代表完整v1.1或公网发布已验收。

## 需求及边界

- AI新建图形必须归入当前任务的工作区分组。明确已有 `workspaceGroupId` 时复用；AI根据当前任务提供 `taskName` 时，服务在图形创建的同一事务内复用/创建任务组。缺组给可纠正的结构化错误，不能静默散落未分组列表。
- 手工新建沿用原窗口，默认当前图任务组或本标签页明确选择的组；首次无组时在窗口内填写任务名。旧未分组图不按标题猜测搬迁，图内架构 `groups` 与工作区分组分开。
- 流程/泳道显式反馈、主流程逆行边走整体图形外侧的独立正交通道，多条回流预留间距和标签位置。横向与纵向都覆盖；同排正常跨泳道交接不能误判。
- 外围路径属于渲染规则，AI不提供坐标或路线点。普通文字编辑继续保留无关人工布局；显式重新排版才更新已有布局。

## 分工与验收

| 任务 | 负责人 | 范围 | 状态 |
|---|---|---|---|
| TASK-GROUP | 固定 dev_application | MCP/schema/guide、创建事务、原新建窗口与定向测试 | 本地验收通过 |
| OUTER-RETURN | 固定 dev_engine | 路由/触发条件、几何回归与脱敏导出 | 本地验收通过 |
| 集成验收 | PM | 审查、机器与实图核对、分组创建/幂等/失败无空组 | 本轮完成 |

## PM独立验证

测试仅使用隔离数据库/脱敏样本，不写入用户当前图。使用Windows Node20，串行执行以下9个文件，75/75通过，失败0、跳过0，约56秒：

```powershell
& 'C:/nvm4w/nodejs/node.exe' --import tsx --test --test-concurrency=1 tests/task-groups.test.ts tests/native-mcp.test.ts tests/drawio-outer-return.test.ts tests/drawio-editing.test.ts tests/drawing-quality-layout.test.ts tests/drawio-engine.test.ts tests/cloud-mcp.test.ts tests/cloud-oauth.test.ts tests/cloud-mcp-updates.test.ts
```

- 日志：`output/local-task-optimization/integration-tests.log`。覆盖缺组拒绝、规范名称复用、组改名再建、并发/幂等、失败无空组；真实MCP/HTTP/OAuth创建后读取组归属；流程/泳道横竖回流、PBS兼容和人工布局保留。
- `vue-tsc --noEmit`、服务端 `tsc --noEmit`、Vite构建、安装包预编译通过（162模块）。日志：`output/local-task-optimization/build.log`。
- 原生真实导出四组PNG/SVG并核对content及完整render signature；PM实际打开四张图核对外围通道与标签。证据：`output/playwright/drawio-outer-return/`，具体边界与开发修正见[外围回流报告](drawio-outer-return.md)。
- 实页使用临时SQLite、模拟控制面账号及真实云端HTTP/原生编辑器。图只在所属任务组显示；新建默认当前组；切换“新建任务分组”后空名禁创建；填写后取消不建空组；成功创建后组内显示、未分组不重复；再次新建默认最近成功使用的任务组，关闭正常。
- 页面截图：`output/local-task-optimization/task-groups-return-routes.png`。临时页面已关闭，测试服务已停止，未替换用户工作区或重启用户MCP。

## 使用与保留边界

- 新AI创建必须携带当前任务名或已有组ID；规则已同步MCP指南、AI绘图指南及skill。人工导入/旧数据按原目标链路处理，不猜测迁移历史未分组图。
- 已有图选择“自动排版”才能整体采用新走线；一般文案修改不覆盖人工线路。规则需由更新后的服务/MCP加载，本轮没有擅自重启用户运行中的服务或发布到云端。
- 允许必要的垂直交叉；自环保持原生loop。原生横向菱形SVG有一处最大0.07px绘制量化差，模型折点严格正交且内容/签名不变；未放宽模型或质量门槛。
- 两个新回归文件已加入本地测试与候选CI门槛；仅修改工作区，未触发发布。HEAD保持 `2e8e25b049e236436c336424af614691c4789154`，应用版本保持1.0.0。
