# 绘图质量修正：PM集成验收

日期：2026-10-20。结论：**本批Q01–Q03限定范围通过**。沿用两个固定开发代理，PM实际审查、退回修正并独立验收。非云端协作交付、非完整D09/G2评测，不宣称任意复杂图都已美化。

## 分支和数据边界

- 协作代码已单独留存本地 `codex/cloud-collaboration-20261020` / `e5ad1e84becec256571d0a0ad84d3ea99641722b`，包括受控后台源码及交接；尚未完整验收，不再继续本批云端开发。
- 质量工作在 `codex/drawing-quality-20261020`，基于稳定4967e04。质量代码未提交、无推送；应用版本仍1.0.0，只有绘图内容标准升为1.1。
- 测试/导出使用临时数据根或脱敏夹具；没有对真实图执行修改、迁移、删除或重排。

## 审查与退回

1. 内容规则覆盖validate/create/patch/update，兼容和原生入口共用标准；质量不合格先拒绝再布局。items/badge/description/note的类型和总量预算封堵文字搬家；只加解释再微改标题/边标签不算结构修改。旧人工草稿可以保留，AI修改不得新增/加重原有error或warning。
2. 明确区分依赖和执行：架构箭头合法；截图2的“网关→多个端点→业务结果”重建为数据流，不用业务结果伪装架构模块。有限组件名称检查不能证明所有业务语义，仍需读图核对。
3. 架构标题条避让、标签贴线及按文字预留通道；流程description完整留为节点属性，不撑成段落卡片；未指定方向的脑图比较两种方向，父子居中。
4. PM实际查看初版流程PNG发现反向共线，视觉上绕过中间任务，退回同一引擎代理。修复前向流程端口并增加OPPOSITE_ROUTE_OVERLAP负例；PM重新查看 `flow-fixed/quality-compact-flow.png`，确认两分支各经过任务后汇合。未仅以issues=[]代替视觉验收。

## 独立验证

### 定向回归和构建

```powershell
& 'C:/nvm4w/nodejs/node.exe' --import tsx --test tests/drawing-quality.test.ts tests/drawing-quality-layout.test.ts tests/native-ai.test.ts tests/mcp-quality.test.ts tests/native-mcp.test.ts tests/drawio-controlled.test.ts tests/drawio-layout.test.ts
npm run build
```

- **54/54通过**，无失败或跳过，包含五类V/H兼容、历史PBS23节点26边内容往返、局部修改保留无关人工几何、描述属性往返及质量拒绝不写库。
- 构建退出0：Vue/server类型检查、Vite与125模块预编译成功；没有为本批重复完整历史测试矩阵。
- 证据：`output/playwright/quality-pm-tests.log`；开发切片证据见本目录 `drawing-quality-1.1.md`、`drawing-quality-layout.md`。

### 真实STDIO MCP → Runtime → draw.io

```powershell
& 'C:/nvm4w/nodejs/node.exe' --import tsx scripts/probes/drawing-quality-acceptance.mjs
```

临时独立SQLite和后台Runtime，真实SDK及固定浏览器导出；成功后关闭自有客户端/Runtime并移除临时根。没有使用当前用户数据来做创建测试。

| 实际产物 | PNG尺寸 | 结果 |
|---|---|---|
| 三层GPU架构 | 798×877 | 三条原关系保留，标签不压层标题 |
| 三分支请求流程 | 762×973 | 动作/判断/入口/结果完整，分支经过任务汇合；description仍可读取 |
| 13主题部署脑图 | 810×905 | 自动横向树，三个分支分行；不再超宽叶节点横排 |

PM实际打开上述三张PNG查看。每图PNG签名/尺寸核对，返回五制品 `png/svg/drawio/json/project.json`、编辑链接与revision=1；合法措辞patch后revision=2，description原文回读不丢失。

四种负例（架构decision、组件伪流程、长description、items绕过）validate均false，create均QUALITY_FAILED且列表不增；非法patch/update拒绝后记录和修订完全未变。另起兼容STDIO临时库，核对相同四负例及patch拒绝，共用标准1.1。产物及结果在 `output/playwright/drawing-quality-acceptance/`。

## 已授权的本机MCP工作区切换

用户明确选择“切到已有draw.io工作区”。使用Codex CLI更新同名flymind单项配置，保留前后注册JSON于 `output/playwright/mcp-workspace-switch/`，没有覆盖其他MCP配置。

- 新入口：本仓库绝对Node20 + `bin/flymind.mjs mcp`，指定原有draw.io数据根、私有运行目录、固定resources和5189端口；未创建新的空工作区替代原图。
- 旧兼容库57张图原样保留；没有自动迁移或合并。
- 新注册配置的实际独立STDIO客户端成功读取标准1.1、native pilot、五类能力、原有15张图列表和原生图纯内容/修订。
- 切换前后只读SQLite摘要完全相同：15张图（10张原生、5张旧格式只读）、30条历史、1个分组；图形全文/修订/时间、历史、分组、删除标记与工作区身份摘要均未改变。
- 对应检查脚本 `scripts/probes/mcp-workspace-check.mjs`，实际报告 `output/playwright/mcp-workspace-switch/report.json`。工作台在 `http://127.0.0.1:5189/#/native` 运行。
- **当前聊天仍持有旧连接**：实际调用其guide仍返回1.0、非native。配置已生效于新连接，不会自动热替换现有进程；需在Codex设置→MCP服务器→flymind→Restart后重新读取guide，确认1.1和原生能力。未为刷新连接关闭整个Codex。

已有draw.io数据根目前位于历史 `output/playwright/review-session/` 下；它是正在使用的用户工作区，**不得按普通测试输出删除**。实际路径仅留本机注册/忽略的会话记录，不把用户数据提交仓库。

## 仍有边界

- 硬布局门槛适用于generic首次编译/显式重排，不能据此宣称所有旧泳道反向共享通道已解决。历史PBS只读布局诊断仍有7组反向共享段；本批改善泳道列间标签空间，但未对真实图偷偷全排。人工旧图不会被自动“修复”。
- 长宽比是提示，显式横/纵方向始终尊重。人工固定通道太窄时可返回边ID和重排建议，不移动无关元素。未知人工装饰和普通垂直交叉不等同布局错误。
- 标准不能证明业务真实；AI需先选对类型、提炼内容、检查实际图片。截图工程重建用于验证，并未找回/覆盖三张原始图XML。

本批至此停止追加测试/范围，后续问题以具体图和关系复现继续处理；无质量提交、发布或版本变更。
