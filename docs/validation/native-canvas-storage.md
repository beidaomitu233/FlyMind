# D07-B3 仅画布存储与入口接线

状态：分支接线完成，待引擎全部映射能力冻结及真实联合验证。`imports.drawio/canvasOnly` 仍为 false，未声称 B3 可正式使用。

## 同库联合模型

消费 A 的 `NativeDrawingProject`、`validateNativeProject`、`inspectNativeImport`、`inspectNativeCanvasCells`、`createNativeCanvasProject`、`rebindNativeProject`、`mapNativeCanvas` 和 `nativeCanvasRenderSignature`；B 不解析 XML 或复制业务映射。记录仍在同一 diagrams/document/history，canvas 以 `mode:'canvas-only'` 判别，没有 content/kind/contentHash/quality。

保留业务专用 getNative/createNative/commitNative 严格入口，新增联合 drawing 读写入口；业务操作遇仅画布返回 BUSINESS_MAPPING_REQUIRED。事务外正式校验，事务内 root、模式、修订、删除和 receipt 复核/CAS；只有显式 canvas-map 可以由画布转业务。原生保存复用队列、草稿与单请求语义，画布 no-op 使用 A 的原生签名 helper，原始 XML/hash 不被替换成规范化字符串。全部写入统一拒绝 XML 超过 4,000,000 字节。

图形列表、回收站、MCP metadata 和保存 session 接受无 kind 的画布身份；返回 canvas-only 状态，不产生假业务内容或质量分。导出与历史快照使用同一不可变作业和租约，画布仅生成 png/svg/drawio/project.json，json 请求明确 CONTENT_EXPORT_NOT_APPLICABLE。失败作业不能交付空文件清单冒充成功。完整备份/恢复正式核验联合项目、四制品和来源文件；原 workspace identity/epoch 屏障继续有效。

## 导入与转换入口

- `POST /native/imports/preview`：只读预览 content/project/drawio，返回名称、模式、类型（如有）、来源摘要、兼容问题及是否启用。
- `POST /native/imports`：原有幂等创建，增加 drawio 与完整 canvas project 分支。原 UTF-8 字节预算 2,500,000、请求预算 4,000,000 不变；压缩/多页/损坏业务元数据由 A 拒绝，不能降级仅画布。
- 原文件在 artifacts 同一 imports 审计目录。drawio 使用 source.drawio；既有 JSON 来源路径不变。来源文件与 receipt 同事务登记，未登记孤儿不可下载。
- `GET /native/diagrams/:id/business-mapping`：只读原生 cell 目录，无坐标推断。
- `POST .../business-mapping/preview`：显式属性校验，无写入。
- `POST .../business-mapping`：expectedRevision/requestId/root，A 正式映射/校验后同 ID 新修订，原稿保留在历史。

NativeStudio 选文件后先展示按需确认面板（文件名/名称/模式/目标组/影响性问题），确认前不建图。结果未确认时锁定原 payload 与 requestId；确定拒绝后可保留输入修正。仅画布的更多菜单提供按需属性表，所有 cell 要明确选业务用途或装饰，连接端点/父子/角色/阶段/分层均为用户填写；校验、确认转换、原稿历史和属性方案下载明确。底层能力未启用时禁止转换，保留查看/下载。

已有业务图的友好属性修复入口仍是明确缺口：本表不冒充该功能。A 后批拟提供待保存 XML 的 inspect/apply 与公开 merge；届时复用字段组件，继续 CAS/IDB，不由 B 字符串替换 XML。正常编辑器工具保持原生；脑图已接更多菜单“删除当前分支”确认、A 专用 Host 方法、返回 XML→现 session.edit/flush，未阻断 autosave。

## 已执行验证

- `node --import tsx --test tests/native-canvas-storage.test.ts`：获审重跑 **6/6**。首轮沙箱阻断临时目录原子 rename；未放宽断言。
- 该文件的 renderer 是注入 mock，真实格式 PNG、四文件摘要/读取、历史画布修订导出和备份/恢复实跑；不声称它是实际 draw.io 渲染证据。
- 受影响六文件首次 **63 项中 61 过、2 失败**，发现失败任务 delivery 空清单及 MCP 未省略 undefined content 两处边界，已修。修后只复跑 `tests/native-exports.test.ts tests/native-mcp.test.ts`，**23/23**，日志 `output/playwright/native-canvas-service/corrected-tests.log`；首轮保留 `affected-tests.log`。
- 新增 canvas session 身份/保存测试及 MCP canvas list/get 契约测试已包含上述目标回归。
- `npx tsc --noEmit -p tsconfig.server.json` 与 `npx vue-tsc -b` 单独顺序执行均通过，日志同目录。之前组合命令 server tsc 曾触发 V8 Zone OOM、其后 vue-tsc 自然退出成功；没有杀用户进程或把该轮当通过。
- legacy-generic 的非绘制 ignoreEdge 标记同步：显式业务线 1、派生父子线 0，目标迁移 12 项通过，不重复已验收八图探针。

## 尚未验证

等待 A 五型/configure/全部 mapping 冻结后优先跑 B1/B2 默认 SDK 与真实页面，再集中 B3 真实 Runtime/Vue/原生保存/四制品/显式属性转换、失败输入保留及旧稿再读取。当前未重新 build、未启公开能力、未新增生产业务记录，也未触及生产数据库或上级 pm.db。新独立默认测试候选：`tests/native-canvas-storage.test.ts`（6 项）。
