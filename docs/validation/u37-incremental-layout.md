# U37 增量原生布局/视觉一致性（待 PM 验收）

本轮只修 U36 复现的增量缺陷，不重做首次布局，不改 MCP/内容标准/UI、版本或生产数据。U35 字体性能改动及其他未提交文件保留。

## 实现范围

- `engine/drawio/generic-visual.ts`：提取首次编译的节点/分组/边视觉策略；`generic.ts` 与 `generic-patch.ts` 共同消费。新增技术节点保持透明/深灰+本地图标，新增技术组保留青蓝虚线与外置标题；新增应用架构组保留侧边层标题与二维字段风格。既有人工对象不套新样式。
- `engine/drawio/local-layout.ts`：最多 32×32 坐标组合、按距离取 512 个候选；以实际前/后置邻居、脑图父主题及当前 orientation 为锚点。绝对坐标避让所有业务节点（含分组内）、组标题、未改边标签/路线及其他组；新组也检查自身外置标题占位。仅被改节点可移动、目标容器可安全扩容，不移动无关对象；无局部安全位明确 `LOCAL_CONTAINER_NO_SPACE`，源项目不变。
- 末端比较原始/候选布局问题的相同对象对及冲突量：重叠面积、穿越长度、反向重合长度与问题次数。历史缺陷允许保留，但不得新增/加重为 `LOCAL_LAYOUT_CONFLICT`。普通短文案仍保持人工几何、样式、图标与锁；未调用 ELK 或全图重排。
- `routing.ts` 只新增已保存线路/标签的只读占位读取，未改 solver 规则。关联边仍由原固定路由器局部重算。
- `technical-layout.ts` 的依赖样式函数增加可选新边集合，仅为新增边使用本类型首次风格；旧人工线型/配色不重写。

## 实际验证

Node v20.19.6：

```text
node --import tsx --test tests/drawio-incremental-layout.test.ts tests/drawio-technical.test.ts tests/drawing-quality-layout.test.ts tests/drawio-layout.test.ts tests/drawio-editing.test.ts tests/drawio-engine.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit
```

- 最终 **70/70**，服务端类型检查通过。日志：`output/u37-engine-targeted.log`。
- 新增 14 项覆盖：root 技术新节点 V/H、多轮同组新增/改字/跨组移动/删除、人工样式保存后带标签的root新增连线、技术/应用架构新组样式、流程前后置插入 V/H、脑图新主题、历史重叠改字保留/面积变大拒绝、原生锁、真实拥挤组扩容拒绝及源不可变、旧线路子树完整签名保留、相同对象对穿越长度变大拒绝。
- 抽取样式后的首次编译与 U36 原始证据 **7 个样本 XML 字节 SHA 完全相同**（六型小样本+完整技术24节点/9组）。`output/u37-compile-parity.mjs/json`。
- 真实固定隐藏 Chromium 原生 load/save→PNG/SVG，严格内容/渲染签名通过，renderer 已关闭。`output/u37-incremental-render.mjs`；`output/playwright/u37-incremental/report.json`。本代理实际查看了三张 PNG：
  - `technical.png` 753×662：原两组/节点保留，新 Redis 在安全 root 空位、透明图标风格，非紫卡。
  - `architecture.png` 1958×570：新增运维层为本类型侧栏标题，条目独立小格；无关层/模块未重排。
  - `flowchart.png` 753×526：新增登记申请在真实前置附近，通过原生正交路径接回保留的核对资料；未把旧步骤挪开或放到全图底部。
  - 同目录保留 `.svg` 与 `.drawio`，三图 layoutIssues 均空、无资源警告。

## 明确边界

- 这是有限局部空位搜索，不保证所有拥挤图都能成功；失败应让用户明确选择自动排版，不偷移人工对象。
- 新增分组为局部安全分区，不对新组和已有图做全局美学优化。流程插入可增加局部折线以保留旧节点位置，不承诺最少折线或全图零交叉。
- 原生保存/导入和旧图不自动换肤；已有问题可保留。不是把整图全部历史缺陷拒绝掉，也不以内容100分代替几何检查。
- 合成小图导出验证不是用户业务质量评审，尚待 PM 独立集成验收；未提交、推送或发布。

## PM 集成退回后的标签通道窄修

PM在人工仅改Vue配色/描边与图标rotation后，同次新增root Redis和Spring Boot→Redis“缓存”边，精确复现 `ROUTING_LABEL_NO_SPACE 46×28`。原因是节点安全落点的48px间隔小于标签46px包络加两侧各6px净距，并非拥挤图。保留原标签、旧人工对象与路由门，将新incident带标签关系的预算计入邻居anchor及候选间距：短标签96px，长标签按原13px/labelWidth预算递增；无标签候选不变。相同回归成功且所有旧节点/图标/旧call边签名保留。PM原SDK集成脚本未修改，真实完整SDK/PNG复验由PM执行，前述三图证据为本窄修前一轮（不是把其冒充此次带标签场景的PNG）。
