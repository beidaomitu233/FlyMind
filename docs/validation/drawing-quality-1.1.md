# Q01 内容标准 1.1 交验

日期：2026-10-20。状态：开发切片冻结，待PM验收；不代表渲染/布局或整体产品已通过。未改应用版本、PRD、用户数据库或渲染代码，未提交推送。

PM后续结论：本切片限定范围已验收，独立54项与真实SDK结果见[集成记录](drawing-quality-integration.md)；下文保留开发时回报，不将其自测冒充最终集成。

## 修改范围

- `src/drawing/core/drawing-quality.ts`：标准1.1；按kind限制业务字段与容器；流程/泳道24中文/80外文标题、短description；items/badge/note和每节点总预算；有限纯技术组件/显式参数预算检查；流程入口、方向可达、结果路径；泳道保留task入口与真实feedback持续循环；脑图单链分类不误判，仅明确编号步骤序列报错。架构模块依赖箭头合法，不套流程起终点。
- `server/application/native-quality.ts`：薄包装共享core，legacy/native同一error/warning非回退比较；同族严重程度下降可改善，多条目增长有actual/limit。
- `server/application/native-diagrams.ts`：validate先quality、不合格不compile；AI patch/update先用纯内容转换检查，再patch/投影后复查，不让非法文字先落入布局错误。manual create/editor/import未加AI准入。
- `server/contracts.ts`、`server/mcp-native/guide.ts`、`server/mcp-legacy.ts`：schema描述与指南1.1；依赖箭头与执行先后分开。legacy validate质量不合格时不布局且省略尺寸，validation schema尺寸可选，未伪造数字。
- `docs/DRAWING_STANDARD.md`、`docs/AI_DRAWING_GUIDE.md`、`skills/draw-with-flymind/SKILL.md`：同步字段、预算、结构和修改规则；纠正过期“原生仅泳道/配置全不支持”，仍以真实capabilities为准。
- 测试：更新 drawing-quality/native-ai/native-mcp；新增 `tests/mcp-quality.test.ts`（请PM接默认入口）。

## 拒绝说明绕过

仅新增/修改批注或非数据卡备注，不能冒充结构修改；新增批注后微改原节点、边、容器文案仍拒绝。比较结构时不把边label、普通边默认kind写法或边ID改名算拓扑变化。真实用户批注可声明annotation，但文字、类型与质量非回退仍检查。仅改原业务文案而不添加批注仍支持。

## 实际命令与结果

项目PATH为Node24，而better-sqlite3为Node20 ABI115；首轮PATH命令被ABI拒绝，未重装依赖。最终使用PM确认的 `C:/nvm4w/nodejs/node.exe` 正常权限：

```powershell
& 'C:/nvm4w/nodejs/node.exe' --import tsx --test tests/drawing-quality.test.ts tests/native-ai.test.ts tests/mcp-quality.test.ts tests/native-mcp.test.ts
& 'C:/nvm4w/nodejs/node.exe' node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
& 'C:/nvm4w/nodejs/node.exe' node_modules/vue-tsc/bin/vue-tsc.js --noEmit
```

- 最终32/32，server/Vue类型检查退出0。
- 日志：`output/playwright/quality-q01-tests.log`、`quality-q01-types.log`。
- core10项，native-ai9项，真实legacy默认SDK STDIO1项，native MCP协议12项；native协议使用注入transport，未将其称为真实原生PNG闭环。
- 真实legacy STDIO仅临时根：guide1.1、validate组件伪步骤返回valid=false且无假尺寸、create/patch/update质量拒绝，前后列表/修订未变，正常关闭子进程并清理临时根；未启动Web或渲染。
- native服务测试用临时SQLite：四入口同预算、400字符非法标题在布局前QUALITY_FAILED、无半写/无回执；人工不合格草稿仍可存；历史PBS实际措辞修改非回退、无关人工几何保留。
- 中间PBS e12标签空间不足失败已交引擎代理；其路由修复后本组最终通过，本代理未改其代码。

## 兼容变化与未验证

- 五份现有标准示例仍100分、passed；没有重写其内容。
- 原测试“加note再改节点文字可通过”改为明确拒绝；纯文案和显式批注正例保留。
- 原200字符流程description由1.0的wordy变成1.1的long_description，断言按真实新预算更新，没有放宽标准。
- 脱敏PBS源JSON与23节点/26边未改。1.0历史38分保留原报告；1.1只读评估为0：旧note带laneId/phaseId新增6个字段问题，另有原判断条件/孤点/不连通及结果路径问题。不是业务数据修复或损坏；人工草稿可保留，AI修改只比较同一1.1标准不新增/加重，不猜边、不擅自清旧字段。
- 本批没有真实PNG/SVG视觉验收、用户截图复刻、大回归或用户库操作；PM在Q03用双入口真实SDK/渲染统一验收。
- 有限高置信名称/编号规则不能证明所有业务含义、分类与依赖真实，未以动词匹配宣称专业性。实际来源不明仍须确认。

全部自有定向进程已结束。冻结后等待PM审查，不自行启动后续阶段。
