# D06-A v2泳道迁移编译层核验

状态：2026-10-16 项目经理已验收D06指定迁移编译范围；独立两个真实样本、最终联合245/245及构建通过。复杂覆盖与其他类型待D07，不扩大为全类型迁移已完成。

## 公开契约

入口`src/drawing/engine/migration/index.ts`：

```ts
previewLegacySwimlane(input: unknown, options?: {sourceCreatedAt?: number})
  : Promise<LegacyMigrationPreview>
convertLegacySwimlane(input: unknown, options: {
  expectedSourceHash: string; sourceCreatedAt?: number
}): Promise<LegacyMigrationPreview>
```

`LegacyMigrationPreview`包含`status:'ready'|'blocked'`、`sourceHash`、`converterVersion:'1'`、可选`contentHash/geometryDigest/project`、`counts`和带`severity/code/path/message/businessId?`的诊断。`blocked`不包含可提交project。convert缺少有效expectedSourceHash或源摘要变化抛错；匹配但本身不可映射的源仍返回blocked，不把部分转换当成正式项目。

sourceHash为SHA256，规范序列化`{source:完整原始v2,normalizedContent,sourceTimes:{createdAt,updatedAt}}`；包含全部原rendering、未知字段、原始源时间以及明确补入的缺失createdAt。它不是数据库原文字节摘要；B另算原文SHA并在事务中核对revision/CAS。converterVersion不改变应用、引擎、adapter或profile版本。

输入先验证为有限JSON并复制；预览/转换无数据库、网络、文件写入、随机身份或运行时生成的来源时间。必须有原updatedAt；缺createdAt仅可由调用方明确传源记录时间，时间不合法或createdAt晚于updatedAt则阻断。原始项目ID和业务ID均保留；原始输入由B留存，迁移编译层不覆盖它。

## 映射方式与范围

1. 仅v2纵向泳道。旧`validateDocument→layoutDocument`作为一次性解释器，取其实际`DiagramScene`；没有调用v3 compile、libavoid、renderScene或全图重排。位置覆盖只有部分字段时，迁移的是旧引擎最终实际box，不用覆盖表中未出现的字段猜坐标。
2. 原生业务UserObject/mxCell保留内容全部已支持字段、数组次序、description/items/badge/color/parentId等元数据；不在根藏完整content供投影。业务ID和原生cell ID命名空间隔离，节点ID与阶段ID相同仍能往返。
3. 原生角色头、阶段主容器及明确lane/phase交叉容器使用旧scene的范围；绝对坐标只换算为相对parent坐标。没有tableLayout，防止首次load重排。旧阶段size、逐字正向阶段标题、旧标题渐变、角色头、分隔线和浮动note位置均从旧场景/规则映射。
4. 节点保留实际x/y/width/height、shape、字号和颜色。note按旧floating-text最终宽高迁移，禁止拿positions中旧引擎本来不使用的宽高覆盖实际显示。旧`objects.locked`转为原生locked，节点顺序按旧orderedNodes在原生可保持的兄弟层中物化。
5. 真实旧edge.points/path转为原生固定端口+折点，不再调用新solver；保留箭头、线色/宽/虚线、标签颜色/字号/labelWidth和绝对标签中心相对于路径中点的offset。曲线不能被pathPoints完整表达时阻断，不悄悄改正交。已有源图路线拥挤不会在迁移中自动美化。
6. 同一交叉格、成员叠放连续的旧objects.groups转原生group；位置换算保持绝对box。跨角色/阶段、含浮动note、或成员与非成员穿插叠放的组合阻断；跨容器业务节点相互覆盖也阻断，避免原生parent层次改变旧叠放结果。
7. 支持的旧nodeDefaults/edgeDefaults保留为preferences，同时元素现状已物化到XML。当前profile不能表达的默认策略阻断，不重置为新模板默认。positions/ranks/per-cell styles/edges/texts等一次转换后由XML持有，不与旧覆盖长期双写。

## 不可映射与默认化检查

旧校验器会移除过期渲染引用、清理锁/顺序/组合或替换非法theme/orientation。预览同时检查原始rendering与规范化结果：这类变化、未知根/内容/渲染/子样式/points字段，都有原路径blocking诊断；不能因旧校验后字段消失便ready。

其他四类图、horizontal、额外业务分层、复杂module/card/topic视觉、card专属渲染、note.description合成可见正文、不可表达的曲线路径及上述组合边界等待D07。note.description当前阻断原因是旧引擎把它并入可见文本，现严格投影尚不能无损区分该显示部分；不会只保留隐藏metadata而丢正文后宣称成功。普通任务的description/items/badge元数据原样保留；本轮不宣称D07复杂可见字段完成。

旧网页字体栈显式替换为固定Noto Sans CJK SC，并有`FIXED_FONT_SUBSTITUTION`警告。保持原字号/box/线和文字位置，不声称旧字体字形逐像素相同；当前原生渲染的合成粗体/字体资源沿用D04已验配置。

## SVG渐变资源检查窄修

真实迁移标题使用旧渐变。首轮native保存XML严格签名已过，但既有renderer直接在序列化SVG抓`url(...)`，把`url(&quot;#...&quot;)`误判外链。经PM授权，仅新增`server/rendering/svg-resources.ts`，从严格解析DOM后的attribute.value和style文本提取URL，XML实体只由解析器解码；没有全局替换实体、删除渐变或改业务/几何/paint。

内部`#gradient`引用通过；实体编码https/file外链、CSS import、活动元素和on事件仍拒绝；原有字体嵌入SHA校验保持不变。固定native PNG/SVG由同一renderer产生，不用旧SVG/Sharp重绘迁移产物。

## 实际测试与证据

修改文件：

- `src/drawing/engine/migration/{types,legacy-swimlane,index}.ts`
- `tests/drawio-migration.test.ts`
- `scripts/probes/drawio-migration-native.mjs`、`scripts/probes/helpers/migration-fixtures.mjs`
- 批准窄扩权：`server/rendering/{renderer,svg-resources}.ts`、`tests/drawio-renderer.test.ts`
- 本报告。未改store/runtime/native-routes/UI/package/应用版本或用户数据。

命令与结果：

| 命令 | 实际结果 | 证据 |
| --- | --- | --- |
| `node --import tsx --test tests/drawio-migration.test.ts tests/drawio-renderer.test.ts tests/drawio-svg-fonts.test.ts` | 27/27 | `output/playwright/drawio-migration/tests-final.log` |
| `npx tsc -p tsconfig.server.json --noEmit` | 通过 | 本轮终端输出，无错误 |
| `npm run build` | vue-tsc/server tsc/Vite通过 | `output/playwright/drawio-migration/build.log` |
| `node --import tsx scripts/probes/drawio-migration-native.mjs` | 最终两样本全通过，独立renderer，无Web Runtime/DB | `output/playwright/drawio-migration/report.json`、`native-final.log` |

真实probe首次sandbox localhost被DENIED，获审批后同命令运行。早期严格签名差异仅为model缺math/shadow默认属性，生成器显式补0后通过；没有放宽renderer签名。渐变误报按上述授权窄修后通过。

| 真实原生样本 | 尺寸 | 本轮最终耗时 | 核验 |
| --- | --- | --- | --- |
| pbs-source | 1898×3310 | 3966ms | 23节点/26边，score38及4个原问题完全相同；全部节点绝对box逐值一致，内容hash和原生保存XML严格签名相同。 |
| manual-overrides | 1965×3390 | 3710ms | 移动/两轴尺寸/矩形外观/颜色字号、note文字宽度位置、阶段扩容、指定端口折点与标签、双箭头虚线、同格组合/锁/顺序保留；源对象不变、严格投影及native签名一致。 |

夹具来源是脱敏PBS内容基线；手工覆盖样本通过现有旧editor的pinScene/placeNodes/resizeSwimlanePhase/reorderObjects/lockObjects等持久化操作构造，组合ID固定，避免随机值。它是旧操作格式回归夹具，不冒称读取了用户原库或新做了一轮真实人工拖拽。真正原生打开/保存/导出由固定draw.io完整编辑器与固定Chromium执行。

每个样本落盘`*.source-v2.json`、`*.scene.json`、`*.preview.json`、`*.input.drawio`、`*.captured.drawio`、最终`*.drawio/*.png/*.svg`。A已实际打开两个PNG检查：主布局和手工紫色节点/紫色标签、加长第二阶段、右侧note、底部note均在图内；原执行区线/标签仍较密，按源几何保留，未自动重新走线。不是以机器38分冒充业务质量通过。

## 待验收与后续边界

请求验收上述纯转换/预览及SVG资源检查范围。B负责原文/修订/备份/CAS/回滚设施；这里不测试正式用户数据提交。D07仍需补齐其他类型、横向、跨格组合和复杂可见字段，以及已记录的lane/phase/尺寸变化后的incident边策略。代码冻结，等待PM独立联合回归/build、同两样本复跑和B集成结果。
