# U30-A 技术架构图与原生自由尺寸（待PM验收）

日期：2026-10-24。仅隔离源码/内存项目与独立隐藏浏览器；未启动用户Runtime，未改用户数据、版本、Git或线上服务。

## 共享契约

- 新业务类型 `technical`，显示“技术架构图”，profile `technical-standard@1`。节点使用原有 `module`，可选 `technology` 为1–64位小写技术slug；`groupId`可选，图内groups为可独立移动/缩放的逻辑容器。节点、组、边仍是原生mxCell/UserObject，非位图与canvas-only。
- 内容层无坐标/图标URL。标题、items、badge保持受控原生文字，description完整保留业务属性；technical最多6项短能力并沿用文字总预算，不将方案段落塞进卡片。人工历史长文字不被内容校验截断；AI变长且现有文字框不够时只重算该节点子文字并增高。
- 首次采用ELK：组内按真实边分层；组之间按组间逻辑边布局，未假造内容边，不沿architecture横带模板锁死。默认horizontal，实际方向回存rendering.preferences；显式vertical尊重。普通改字不调用ELK。
- 图标为PM提供的Simple Icons CC0固定commit `30053a0f492fd192740ad001031b3091be060986`，14个SVG/原色/来源摘要在 `resources/technology-icons/provenance.json`，静态模块 `engine/technology-brand-icons.ts`。别名含vue/node/nodejs/spring-boot/postgres；未知slug为原生通用六边形。图标独立可移动/缩放子元素，SVG data URI随.drawio保存，无CDN。安全检查只放行供应map字节精确相同的URI，任意SVG/活动数据仍拒绝。

## 自由尺寸修复

`controlled.ts`为缺省受控节点提供原生container/recursiveResize/resizable；不覆盖人工显式recursiveResize。已有文字子元素只要实际宽高足够容纳新文字，AI改字保留全部几何；不再要求其尺寸等于模板默认。分组仍recursiveResize=0，调整分组边框不强制缩放内部节点。`generic-patch.ts`只在节点本次确有几何变化/新增/重归属时考虑扩容，不因短文案去重新包住历史人工外溢节点。技术图标仅新增节点或明确technology变更才写入；普通文字变更保留已删图标，不重新补回，人工位置/尺寸/rotation/opacity保持，专用测试覆盖。

## 已运行验证

1. `C:/nvm4w/nodejs/node.exe --import tsx --test tests/drawio-technical.test.ts tests/drawio-controlled.test.ts tests/drawio-generic.test.ts`：最终17/17（technical6+controlled6+generic5），无skip。覆盖属性、品牌/别名/通用fallback、安全拒绝、无组节点、technology修改、受控元素复制/删除/次序、四型已有局部patch及无关元素保护。
2. `C:/nvm4w/nodejs/node.exe node_modules/typescript/bin/tsc -p tsconfig.server.json --noEmit`：通过。此前并行http.ts类型问题已由PM收口，不在本代理修改范围。
3. `C:/nvm4w/nodejs/node.exe --import tsx scripts/probes/drawio-technical.mjs`：technical和人工尺寸后的architecture实际固定31.5.3加载/保存/PNG/SVG均成功，内容hash/完整原生渲染签名严格一致。`output/playwright/drawio-technical/report.json`；technical PNG893×333，architecture2058×2263。已实际查看technical.png，Vue/Spring Boot/MySQL标识和标签正常。沙箱loopback首次ERR_NETWORK_ACCESS_DENIED，同命令获准后通过；未改网络保护。
4. `C:/nvm4w/nodejs/node.exe --import tsx scripts/probes/drawio-technical-ui.mjs technical`：真实E/S鼠标把手180×112→252×156，原生保存、AI短文案patch、新iframe重新打开后实际宽高及图标签名不回退。`output/playwright/drawio-technical-resize-ui/{report.json,resized.png,reopened.png,reopened.drawio}`。
5. 同脚本参数 `architecture`：实际module 300×158→380×194，同样保存重开+AI改字保持。`output/playwright/drawio-architecture-resize-ui/`。原生min模式缩放控件是只读菜单；脚本用公开100%菜单，不修改DOM。受控文字命中通过公开Alt+Shift+P选择父框，再公开selection核对仅同一主框子树；曾误选文字造成高度未变的失败诊断留在pointer/failure产物，不视为成功。无graph内部API。

## 边界/剩余验收

- 当前实际PNG主链为3组件、2组技术样本；14枚供应均静态可用，但未声称逐枚浏览器视觉验收或已复刻用户参考图全部关系。不能从参考图擅补业务。
- 分组也已真实鼠标E/S拉伸及标题条移动：technical group 480×200→564×240，位置(76,140)→(120,170)；architecture layer1644×410→1846×508，位置(64,128)→(161,210)。均保存重开后AI改字，全部业务节点相对几何逐一不变。命令为同UI脚本加 `technical --container` / `architecture --container`；证据 `output/playwright/drawio-{technical,architecture}-container-ui/`。已实际查看两张reopened.png。容器手势样本允许用户主动挤到其他容器上，验证自由编辑与保持，不将其视为全图避碰样本。
- 自由编辑允许用户人工将节点挤在一起；普通文字保存不替用户全图美化。新增/实际变长触发局部扩容无安全位仍明确拒绝，不移动无关人工节点。
- 本批不扩展technical旧图迁移/画布映射，不改MCP任务组准入（PM负责）、UI交互或其他模板重写；标签/图标不栅格化。锁约束沿原有引擎策略。
- 可审最小主链交PM集中验收，未宣称U30整体完成或已上线。

## 最终冻结

17项目标测试与server tsc最终通过，4次指定UI链路（两类节点、两类容器）均report.ok=true，相关自有隐藏浏览器和临时HTTP宿主均finally关闭。未运行生产服务或修改用户库；其余UI/供应打包由PM独立接线验收。本批只请求上述范围验收。

## U30-A MCP接线独立复核（同日，待PM验收）

- 可复现脚本：`C:/nvm4w/nodejs/node.exe --import tsx scripts/probes/drawio-technical-mcp.mjs`。真实SDK StreamableHTTP→已鉴权CloudHTTP→临时SQLite→固定NativeDrawioRenderer，权威为脚本内合成测试宿主，**不是实际Java/OAuth登录测试**。未使用用户Runtime/用户库。4项checks全通过，finally关闭服务/浏览器、删除独立临时库（tempCleaned=true）。
- 实际listTools schema的create_diagram.content.kind包含technical，nodes含technology；get_drawing_guide(kind:technical)返回正确技术样本/technology规则。缺taskName/workspaceGroupId返回TASK_GROUP_REQUIRED，列表确认没有写入；带taskName实际创建并返回工作区任务组、r1，同图get_diagram内容逐字段相同。
- 真PNG以MCP认证resource读回，893×333，34642字节，SHA256 `7d0c1fc86507e2df75ac8d8adcf8a8bdfa26c8a165e55c726b5f1568848a8e61`。五制品链接键齐全；本次仅PNG逐字节读回，不冒称其余4制品逐个下载。证据 `output/playwright/drawio-technical-mcp/{report.json,technical-mcp.png}`。
- 修复 `tests/fixtures/native-business.ts` technical落入dataflow兜底的问题，添加module/technology技术夹具，保留原测试task节点ID。`tests/native-business-service.test.ts` 改为读取实际初始方向后切向相反方向；technical默认horizontal时同向relayout的合法no-op不能硬要求r2。仍严格要求实际XML改变、r2、幂等、CAS和内容hash不变。定向该文件最终4/4，包含6型实际create/read/patch/update。
- 同步 `docs/DRAWING_STANDARD.md` technical类型、technology、可选逻辑组、120字符description、最多6项短能力/单条24中文或64外文、总量160及人工几何保护。与引擎quality一致，不改版本号。

### PM应接入的测试/发布入口（本代理未改package/CI）

1. package默认test需加入 `tests/drawio-technical.test.ts`；test:cloud若覆盖全部对外能力，也建议纳入该文件和既有 `tests/native-business-service.test.ts`。后者已在默认test。
2. `.github/workflows/cloud-candidate.yml` source显式文件清单尚未含technical目标测试；若仅改package并不会自动覆盖这个显式命令，应同步加 `tests/drawio-technical.test.ts`。
3. `scripts/cloud-bundle-smoke.mjs`目前仍是固定5型列表，新technical尚不属于平台原生烟测矩阵；发布前由PM决定加到Linux/Windows候选，而非称现有5型制品烟测已覆盖6型。
4. `docs/AI_DRAWING_GUIDE.md`仍有“当前五类”、items/groups仅架构的历史表述；原生get_drawing_guide走nativeGuide+已同步DRAWING_STANDARD，实际返回无此冲突；包内旧通用说明仍建议PM集中同步。
5. 旧content clipboard whitelist与canvas→business显式映射不接technical；属于旧画布/映射边界，当前原生MCP创建/编辑/导出不走它们。本批不扩展迁移与映射。package已包含resources/technology-icons/，无需重复加。

## 最终显式入口/契约收尾

按PM授权完成，未改package（PM已接入）：

- `.github/workflows/cloud-candidate.yml` source contract显式清单加入 `tests/drawio-technical.test.ts`。
- `scripts/cloud-bundle-smoke.mjs`改从**候选自身编译产物**profiles读取supportedKinds；目前6型逐型原生PNG/SVG/drawio/json/project.json烟测，报告同时记录supportedKinds。断言种类非空/不重复、每个sample.kind严格对应，避免新能力无样本却静默复用旧图。保留供给/文件hash/不可变prepared检查、Linux公开metadata权限和原全部验收。
- `docs/AI_DRAWING_GUIDE.md`补technical类型、少文字6项规则、逻辑组与人工编辑边界；`server/contracts.ts`实际schema字段说明同步module、technology、可选groupId、description/items/badge/group与160总文字预算，没有收窄人工内容存档结构上限。

本次只运行：`node --check scripts/cloud-bundle-smoke.mjs`通过；Node20+tsx内容预检动态6个kind均sampleFor.kind对应、validateContent与nativeContentSchema通过；`tsc -p tsconfig.server.json --noEmit`通过。**未执行候选打包或Linux/Windows正式6型后台渲染烟测**；前文隔离technical原生PNG/真实MCP证据保持有效，实际候选由下轮平台流水线验证。代码/报告再次冻结，无自有运行进程。
