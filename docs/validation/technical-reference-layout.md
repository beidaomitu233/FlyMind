# 技术架构图参考还原（U30，待 PM 视觉验收）

## 来源与业务边界

用户参考图片 `codex-clipboard-c2a93565-1b6c-465d-aa4c-fabb6c6997ce.png`，图中为 ruoyi-vue-pro 技术架构示意。本批仅转录图片可见组件/关系，不宣称其实现或当前 FlyMind 使用同一技术栈。

纯业务示例：`src/drawing/core/technical-sample.ts`，导出 `technicalReferenceContent(id?)`，无坐标/样式。共 24 节点：2 终端 + 前端 3 + 接入 3 + 后端 3 + 存储 4 + 上方 3 + 运维 3 + 监控 3；9 分区。重复 Nginx/Spring Boot 保持图片中的同名显示，由稳定内部 ID 区分实例，不补实例间依赖。

图中许多箭头接分区框而非具体实例。当前业务 schema 只允许 node→node，因此示例使用相应分区的代表实例作为真实原生端点：例如 HTTP 用前端中间实例→Nginx 中间实例，部署用 Jenkins→后端代表实例。它们仅是分区关系的表达锚，不推断全实例拓扑，不把 node edge 偷连到 group。未给 Docker/Portainer/Druid/SkyWalking 添加图片没有明确单列的依赖线。源码顶部图注/URL 不作为业务节点复制，不在图中塞来源解释框。

## 视觉策略

- 主链按真实技术类别与有向依赖安排：客户端→前端→接入→后端→存储。
- Quartz/消息/锁位于上方；运维和监控位于下方，辅助分区内横向排技术图标。
- 透明蓝色虚线分区，外置组名；技术节点无淡紫卡底/边框，72px 青蓝图标与深灰短术语占主体。
- 依赖主链正交，客户端与辅助依赖采用原生曲线样式。没有将屏幕截图当背景图片嵌入。
- 品牌形状仅使用项目已供应的 Simple Icons CC0 数据，派生为统一青蓝色；Quartz/终端/锁等为 FlyMind 自行编写的通用 SVG，不仿造未供应商标。原固定供应文件未修改。
- 所有业务组、图标、文字保持独立原生 cell。普通改字保持已存几何和样式，不在 patch 中重新套新主题；既有显式重排继续由现有配置契约保留人工 style。

`technical-layout.ts` 是新图渲染策略，不依赖参考 node/group ID；已验证改 ID、改组名、逆序 group 数组时主/辅布局一致。未知无分区技术使用真实拓扑的分层，不发明业务连接。

## 可复验入口

- 定向规则：`node --import tsx --test tests/technical-layout.test.ts`。
- 完整真实原生导出：`node --import tsx scripts/probes/technical-reference.mjs`。
- 独立输出默认 `output/u30-technical-reference`，含纯内容、完整项目、原生 XML、PNG、SVG、report。
- 同一次 probe 会将一个前端代表实例改字，核对所有既有 cell 的 geometry/style 完全保留。

最终定向规则 **4/4 通过**。完整固定原生 renderer 导出成功：`output/u30-technical-reference/reference.png`，**1842×1568，282,239 字节**；同目录保留 SVG、完整项目、纯内容、draw.io XML 与 `report.json`。24 个图标均为 72px，术语为 18px 深灰常规字；内容投影与纯业务 fixture 一致，普通改字后所有既有 cell 的 geometry/style 完全保留。实际供应为 draw.io 31.5.3、Chromium 151.0.7922.34、固定 Noto Sans CJK SC。

本轮尝试主链 top 400→360、下方辅助间距 170→120 时，严格路由检查发现调度线穿接入服务外置标题，未导出该布局。按 PM 边界回退至已通过的 400/170，不删除标题障碍或缩小图标换取比例。最终宽高比约 1.17，较参考图约 1.45 更纵向；此差异与代表实例锚边界保留，待用户对照确认，不作自评分。

首次完整编译曾发现旧路由把 technical 的 `startSize=0` 透明框作为内部表头障碍；由引擎所有者修正，未放宽真实表头碰撞检查。同组带标签依赖保留至少 64px 节点净距，其余组仍用原间距。未运行 Java/团队回归，未启动 Runtime，5208 按要求继续驻留。本批实现与上述唯一最终 PNG 冻结，待 PM 验收。

兼容收口：显式 vertical 转置后按未旋转节点实际宽度重新保障同组标签净距（至少 64px）并扩容分区；仅新布局/显式方向变化使用，不触普通人工保存。新增 180×148 节点方向回归通过，最终 horizontal PNG 不受影响。
