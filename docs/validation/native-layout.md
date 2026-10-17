# 显式自动排版与横竖切换（2026-10-18，待PM验收）

## 本批冻结接口

复用现有 `POST /studio-api/native/diagrams/:id/rendering` 与 `configureDrawio(base,changes)`，请求为 `{rendering:{relayout:true,orientation?:'vertical'|'horizontal'},expectedRevision,requestId}`；完整 NativeRecord/CAS/幂等行为不变。未指定方向则保留正式 preferences；原无方向按vertical模板默认。公开引擎只准 `relayout/orientation`，其他尚未完成视觉配置明确 `UNSUPPORTED_RENDERING_OPTION`，不把能力开关当全部字段已完成。

五profile实际开放 configureRendering 与 vertical/horizontal。普通保存/normalize不调用本批布局。显式重排会重置业务节点位置、连线旧端口/折点，保留业务语义、ID、paint/字体/形状/尺寸、业务分层和脑图父子；未知装饰原样保留。人工原生组合暂时 `GROUPED_RELAYOUT_UNSUPPORTED`，锁定对象 `LOCKED_OBJECT`，在独立候选XML计算失败后不提交/不拆组。跨格组合不扩语义。

## 实现

- `drawio/index.ts`：公开最小配置入口，复用既有配置/增量原文物化器，不把完整图替换成首次编译产物。
- `generic.ts`：ELK按实际方向；架构保业务层/治理组，在横向按组横排，纵向仍原横带纵排；保留已存人工单卡尺寸。脑图同级按数组顺序约束，端口统一。
- `relayout.ts`：只映射受控对象新几何并保原样式/未知装饰；切方向不把旧阶段另一轴宽度误作新阶段最小高度，避免V→H→V膨胀。
- `routing.ts`：实际固定libavoid路由，清旧曲线/bezier/rounded/端口偏移等过期约束，写正交边；脑图父子source bottom→target top或right→left，固定同向中点端口。固定供应同一事务共享固定pin多连线只返回首条，已取实际solver输出定位；父子线改为各自调用同一供应solver、仍把全部业务node作障碍，形成干净共享直角主干；普通业务边仍批求解，不引入自研router/修改vendor/换依赖。
- `profiles.ts`：五型真实能力；旧rebind能力断言与runtime-instance错误能力握手断言窄改为新矩阵/取反，不改生命周期行为。

## 精确验证

- `node --import tsx --test tests/drawio-layout.test.ts tests/drawio-configure.test.ts`：8/8。五类脱敏基础夹具各同一文档V→H→V，完整内容/hash不变；人工paint、节点尺寸、未知装饰全签名保留；旧curved/bezier/端口偏移清除、每段正交；脑图父子端口一致；原生组拒绝且源XML不变。另泳道phase尺寸回切不膨胀断言单独定向1/1通过。
- `npx tsc --noEmit -p tsconfig.server.json`：通过。
- `node --import tsx scripts/probes/drawio-layout-native.mjs`：固定Chromium/原生draw.io6/6，泳道/脑图/架构同一文档H→V；每次真实load/save严格视觉签名与全部业务内容等价并原生PNG/SVG。初次sandbox回环被拒，同命令批准后退出0。证据 `output/playwright/drawio-layout/report.json` 及6组PNG/SVG/drawio/project。
- `FLYMIND_PROBE_OUTPUT=output/playwright/drawio-layout/fresh` 同脚本 `--fresh-mindmap`：只补首次脑图1/1真实往返，不重复6样本；`fresh/report.json`。
- 已实际查看脑图H/V和泳道V PNG。脑图父子线为统一正交主干，同层对齐、同级顺序保留；纵向17主题树自然较宽，未声称任何规模都无需缩放。

未运行全套、未启动Runtime、未访问用户数据；仅固定renderer自身临时assets HTTP与headless，finally均关闭。B独占原UI/Host/controller/client接线，PM集中bundle与5191实际交互验收。本批不扩迁移/映射/评测/全视觉标准；D07整体仍未因此通过。
