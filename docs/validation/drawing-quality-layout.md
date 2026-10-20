# Q02 渲染与布局质量

日期：2026-10-20。状态：待 PM 验收。当前质量分支；未修改用户图、数据库、版本或 vendor，没有提交/推送。

PM后续结论：本批夹具及兼容范围已验收，已独立打开最终flow-fixed和真实MCP的三张PNG，见[集成记录](drawing-quality-integration.md)；不代表全部历史复杂泳道已修复。下文保留原开发回报及退回轨迹。

## 已实现

1. **标题禁入区**：`drawio/routing.ts` 将图标题、架构层的实际48px标题条作为固定 libavoid 障碍，层容器正文仍可进入，不把整个容器封死。原节点避障继续生效。
2. **标签贴线**：按真实字体/换行尺寸分槽，边文字只能在线上或线段旁约8–24px净距范围，不再把标签远放到84px外。线上标签使用已有原生白底遮住所属线段；禁止别的线穿标签、标签压节点/标题或互相压字。近线无空位返回连线ID、尺寸和“显式自动排版预留通道”建议，不把大段坐标作为公共错误。
3. **按文字预留通道**：普通横排按标签宽度确定 ELK 层距；新建/显式泳道排版按跨角色标签宽度预留列间通道。保留 libavoid正交求解，轨距36px，不手写通用走线器，不补业务边。旧flow e08实际96px短线放不下90px标签+净距、PBS e12实际100px列缝放不下137px标签的问题已通过通道尺寸解决，而非恢复远放标签。
4. **流程 description 为属性**：仅 flowchart 的非note业务节点采用 `fmDescriptionMode=property`；完整 description 留在该节点 `fmDescription`，不再生成巨大正文子图元，project原样回读。没有截断或缩字。架构/数据流/脑图及泳道原可见字段保持，note正文仍可见。
   - standalone缺模式标记仍拒绝；已确认base可恢复模式标记，**不恢复旧description正文**。属性修改、patch和内容hash往返已覆盖。
5. **首次布局对齐**：`layout-policy.ts` 在 ELK 已分好的rank带内对齐形状；树父节点在自身子节点范围居中，单根流程主干居中。不往 content 写rank/位置或假边。脑图只用真实 parentId 关系排名，非父子业务交叉线后交路由器处理，避免交叉线改变主题分类顺序。
6. **默认脑图紧凑方向**：未明确 orientation 时比较V/H两个 ELK候选，按画幅比例与占地选择；记录实际 `fmOrientation`。`engine/project.ts` 最小适配在新建项目时将选定方向回存 preferences，不修改调用方options或内容hash。显式V/H始终尊重；长宽比只产生可机器读取提示，不禁止用户切方向。
7. **机器门槛**：`inspectNativeLayout` 返回稳定code/cellIds；首次generic编译检查节点重叠、节点压标题、非正交、线穿无关节点/标题、标签碰撞/离线过远。硬问题拒绝返回成功图；人工save/project不调用排版gate、不偷偷重排。单独长宽比为提示，不能等同内容无效。

## 夹具与真实产物

可导入 `tests/fixtures/drawing-quality/scenarios.ts`：

| 导出函数 / ID | 复现范围 | 实际PNG |
|---|---|---|
| `layerHeaders` / `quality-layer-headers` | 截图1：三层五模块、可见三条缓存/请求关系；不推测底层未画关系 | 798×861 |
| `componentCollaboration` / `quality-component-collaboration` | 截图2：网关→三端点→业务输出，按PM裁决使用dataflow/card，避免把“业务结果”伪装系统模块 | 1094×951 |
| `wideMindmap` / `quality-compact-mindmap` | 截图3：13主题、3支各3叶，保留同级数组顺序 | 810×881，自动horizontal |
| `compactFlow` / `quality-compact-flow` | 真实动作/判断/start/end正例，说明保留为属性 | 753×785 |

这些是截图可见结构的脱敏工程重建，不是找回了用户原XML，不声称所有原始文本/手工样式逐字复原。未用费用节点代替流程结果、未推测未给关系。

执行：

```powershell
node --import tsx --test tests/drawing-quality-layout.test.ts tests/drawio-layout.test.ts tests/drawio-controlled.test.ts tests/drawio-generic.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json
& 'C:/nvm4w/nodejs/node.exe' --import tsx scripts/probes/drawing-quality-layout.mjs
```

- 最终定向 **27/27通过**；server tsc通过。覆盖原五型 V→H→V样式/尺寸/人工装饰保留、受控字段复制/删除、局部patch无关人工几何、flow属性模式缺失/ACK恢复、PBS23节点26边原样往返及反向共线路由负例。没有为本批重复全套。
- 真实固定 headless151/原生draw.io后台导出 **4/4通过**：每张保存返回XML与输入完整视觉signature相等，project内容逐项一致，captured XML machine issues均为空。已实际打开查看四张PNG：层标题无白标签压入；数据流同层顶部一致、网关居中；脑图13节点不再2394×505扁平横铺；流程说明不再撑大卡片。
- 输出 `output/playwright/drawing-quality-layout/`：各ID的 `.content.json/.input.drawio/.drawio/.png/.svg` 和 `report.json`。探针支持 `FLYMIND_PROBE_OUTPUT` 隔离输出。
- 使用现有固定隐藏浏览器launcher与NativeDrawioRenderer，没有起用户Runtime/访问数据库。renderer在finally关闭；测试没有遗留自有服务。遵守本批指定隐藏启动方式，未安装Playwright CLI或额外依赖。

### PM视觉退回：流程反向重合（已修，待复验）

首张 `quality-compact-flow.png` 的否分支与该task输出在同一水平段反向共线，导致视觉上像绕过任务；最初machine gate没有检测到这一项，不能用原issues=[]证明图可用。

- 前向flow边现在纵向固定下出上入、横向右出左入；回流边使用侧向端口。继续交给固定libavoid求解，没有改节点位置、内容或关系。
- machine gate增加 `OPPOSITE_ROUTE_OVERLAP`：不同端点集合的边反向共享同一有效线段即拒绝。同向分支/汇聚主干正常；同一对节点的明确双向依赖可共用自身终端短桩，不将所有合法双向关系判错。
- 新负例重建被退回的反向线段并断言能检出；五型方向兼容测试保持原断言通过，没有改成期待错误。
- **只重渲flow**：`FLYMIND_PROBE_ONLY=compactFlow`、`FLYMIND_PROBE_OUTPUT=output/playwright/drawing-quality-layout/flow-fixed`，原生导出/完整signature/内容校验通过，issues=[]；已实际查看新PNG，两分支分别从task底部流向end顶部，不再绕过中间任务。最终flow产物以该子目录为准，最初错误图保留作对照，其他三张没有重复重渲。
- 首次flow-only命令因新增筛选器多一个括号在解析阶段失败，未起浏览器；修正后 `node --check` 通过、真实命令exit0，约5.3秒渲染。

## 边界与剩余风险

- 内容选型、纯语义预算与四入口一致质量准入由 Q01 负责；本层不根据技术名词或箭头把架构硬判成流程。
- 自动方向只影响新编译且未显式设置方向的脑图；旧图保存不自动转向。显式全排保留已有人工尺寸/配色；旧巨大手工框不会在普通save时被擅自缩小。
- 检查对象是业务主节点、已声明标题禁入区和业务边标签；不宣称任意未知人工装饰/任意复杂非平面图全局无交叉。普通边之间的合法垂直交叉没有一概禁止；共享脑图父子主干允许。
- 局部patch不移动无关节点/边；旧人工通道太窄不能安全贴线时会明确诊断，需要用户显式重排，不偷改旧图。
- 字号使用现有模板默认值，未为了通过画幅门槛缩字或裁图。本批真实XML/PNG指定范围待PM独立验收，不自行宣布质量阶段通过。
