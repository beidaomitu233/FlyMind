# OUTER-RETURN：流程返回路径走整体外围

状态：本地PM独立验收通过，见[总验收记录](task-groups-and-return-routes.md)；未提交、推送、改版本或操作线上。仅使用脱敏夹具和固定静默后台浏览器，无用户数据库/用户Runtime。

## 本批实现

- 流程图、泳道的首次编译/显式重排/实际受影响边路由：显式 `feedback`，或主方向上目标框确实位于源框之前时，走图形整体外围。不同阶段优先使用实际阶段次序；主轴框重叠的普通同排跨角色交接不因轻微中心偏差被当作回流。自环继续原生loop，本批不扩展。
- 纵向使用右侧、横向使用底侧独立通道。包络包括完整泳道框、标题、浮动note和保留旧线路/标签；通道按实际标签宽/高留距，非仅节点最右/最下界。note的 `businessType` 已归一为node，其实际box也参与避障，不移动note或使其占主排名。
- 固定供应libavoid的公开free-point API分别求解出入腿及外围主干；不修改vendor、不添加自研网格router、不往content添加坐标/美化字段。标签只在所属外围主干选近线安全槽。
- 不扩改泳道普通顺向端口。返回边的矩形侧端口与常用中点分开；菱形/椭圆只取真实cardinal点，避免悬空。只对实际观测到的反向共享段做一次有界solver重试，临时障碍只约束新边；仍无解明确拒绝，保留旧人工线路。允许必要的垂直交叉，不承诺非平面关系零交叉。
- `patch.ts`、`generic-patch.ts` 仅补edge.kind变化的路由触发。普通文案保存不调用全图重排；未涉及cell的样式、折点、几何保持签名，paint不因重路由被重置。

## 兼容修订

原PBS重排测试以前因e17无标签槽而预期拒绝，本策略让外围通道释放了安全空间，实际重排已成功。现断言核对内容操作结果、严格正交/节点/标签/反向共享段门槛 `inspectNativeLayout=[]`、人工装饰保留、调用方原XML/hash/revision不变；不再强迫安全结果失败。独立人工占满走廊的无槽拒绝及源不可变测试仍保留，未吞异常或弱化门槛。PBS业务原始23节点/26边及来源异常不补边、不修语义。

## 验证

Windows Node20.19.6：

```powershell
& 'C:/nvm4w/nodejs/node.exe' --import tsx --test tests/drawio-outer-return.test.ts tests/drawing-quality-layout.test.ts tests/drawio-engine.test.ts tests/drawio-editing.test.ts
& 'C:/nvm4w/nodejs/node.exe' node_modules/typescript/bin/tsc --project tsconfig.server.json --noEmit
& 'C:/nvm4w/nodejs/node.exe' --import tsx scripts/probes/drawio-outer-return.mjs
```

- 定向52/52：外围8、质量布局10、引擎18、原生编辑16。日志 `output/playwright/drawio-outer-return/tests.log`。server tsc通过。
- 四个真实原生导出通过，PNG/SVG/input.drawio/native.drawio/content.json及 `report.json` 同目录。实际加载并capture后内容完整相同，严格native render signature相同；原生输入几何正交，四夹具节点/标签/穿框/反向重合门槛均无问题。
- 已实际打开四张PNG：`flowchart-vertical.png`（1473×1087）、`flowchart-horizontal.png`（2394×416）、`swimlane-vertical.png`（1718×1181）、`swimlane-horizontal.png`（2414×1195）。均可见两条分离的大外围回流，浮动说明不被路径穿字；菱形返回端点贴实际轮廓，无原先矩形侧75%点造成的空隙。
- 测试证明未标feedback的真实返回仍外绕、顺向同排交接不误判、仅改kind触发、人工cell和纯文案修改不改其他线路；反向共享段故障保护不写原始输入。
- 首轮曾尝试统一泳道所有顺向端口，造成PBS水平及旧人工标签兼容问题，已撤回该扩大改动。随后定位互为feedback共用段与菱形右中点同原入线冲突，收窄到一次返回端口/共享段重试后52项通过；无持续参数搜索。诊断几何仅在ignored输出日志，公开错误只保留边/障碍ID及建议。

## 绘制限制与PM裁决

真实SVG读回8条返回路径中7条完全正交；横向流程菱形返回路径有最大0.07px的原生SVG绘制量化偏差（例如1195.75→1195.82）。对应输入与capture的模型框/折点为整数、exitX=.5且严格正交，内容与完整签名未变。详细路径在 `svg-path-quantization.json`。PM已接受小于0.1px的原生绘制边界；没有改renderer、没有放宽输入几何或签名门槛，不宣称SVG数值绝对零斜差。

外围通道会扩大画幅；普通保存不会把已有内部人工回流自动换线。已保存的旧图需要用户显式自动排版，或后续真实端点/kind/相关几何修改才触发本策略。不可安全保留人工线路的局部修改仍可明确拒绝，不偷偷重排旧图。最终视觉及范围验收由PM完成。
