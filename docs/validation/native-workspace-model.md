# D08-P1 metadata 视图模型

状态：项目经理专项验收通过（2026-10-16）；仅独立准备，不接默认 UI 或越过 D07 门槛。

PM 阅读模型/测试及独立执行 `node --import tsx --test tests/native-workspace.test.ts`，**7/7** 通过。证据 `output/playwright/project-manager-d07/workspace-model-tests.log`。通过范围仅为纯 metadata 推导；侧栏实际交互、快照一致性和设备偏好仍待 D08。

新增 `src/drawing/state/native-workspace.ts`，公开 `buildNativeWorkspaceView(input)`。输入只有图形 metadata、分组 metadata、当前 ID、设备视图偏好、编辑中的 ID 和前次行序；`kind` 可省略，canvas-only 不需要虚构业务 content。没有数据库、请求、框架、时钟或偏好持久化依赖。

规则：

- 分组按创建时间及稳定 ID 排列；图形只有一个有效归属，组内与未分组互斥，删除项不进入活动列表。
- 搜索去首尾空格、忽略拉丁大小写，跨组单列并展示归属；清除搜索不重写调用者的展开偏好。
- 默认按 `updatedAt`，可选 `createdAt`，均降序且同值按稳定 ID；不写时间或 revision。
- 每组及未分组默认前五；展开只影响指定分组，当前/正在编辑行即使排在五项后仍可见且不重复。
- 原位改名/菜单操作期间，该组既有 sibling 行序保持，新到记录在末尾按排序追加；结束后使用最新排序。相同搜索条件下编辑中的原匹配行暂保留，即使标题已不匹配，`matchesSearch=false` 明确区分。
- 外部移组/删除不保留虚假旧归属，分别回报 `relocatedEditingIds`/`removedEditingIds` 供未来 UI 中止或说明。未知分组不自动创建，条目出现在未分组区并明确标“原分组不可用”及原 ID，等待刷新正式快照。

验证：`node --import tsx --test tests/native-workspace.test.ts`，7/7 通过；`npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck --esModuleInterop --types node src/drawing/state/native-workspace.ts tests/native-workspace.test.ts` 通过。测试覆盖用户规则、canvas metadata、搜索归属、排序/分页/当前定位、编辑稳定性、外部移动/删除及输入不变。未改 store、UI、路由或共享 types；未运行浏览器、全套测试或构建。未来 UI 接入仍需真实键盘/菜单焦点、列表滚动和设备偏好持久化验证。
