# UI-A 嵌入编辑器明暗外观（2026-10-18，指定范围已验收）

## 接口及文件

DrawioHost.vue、DrawioViewport.vue新增可选`appearance:'light'|'dark'`，默认light；Viewport对active和candidate都传当前外观，prepare/会话/消息/API代理契约不变。新`engine/drawio-host/appearance.ts`只提供同源文档UI样式与外观类型，未改vendor、依赖、NativeStudio、WorkspaceSidebar、studio.css或用户数据。

Host在iframe load及真实ready前注入一个固定ID样式节点，主题prop变化只更新根`data-flymind-appearance`属性。不改src、不发送load/merge、不重载XML，不访问内部graph。官方固定`dark=0`仅在首次URL禁原生图形暗色反转；应用dark由独立UI CSS实现，不调用setDarkMode或改图形颜色。

## 视觉范围

工具条、菜单、底栏、浮动形状库、表单/对话框、按钮与滚动条统一平面中性色，去重灰/渐变/重阴影；light白/浅灰，dark侧栏#191919、主UI#212121、弹层#2b2b2b，边框#3a3a3a，少量#8b83ff强调。仅原生工具的单色图标允许UI局部滤色，图形SVG、色块预览、库shape缩略图和cell编辑文字不作反色/filter。

图纸及原生网格保留白底（包含page=0无分页画布），不改网格启停/密度；避免原黑字边标签落到深色画布不可读。dark工作台背景/loader与UI为中性暗灰，白色图纸/导出原色不变。普通画布图元样式、坐标、文档时间与内容均不由此模块写入。

旧常驻opaque loader、纯CSS140ms显spinner、reduced-motion、真实load+双RAF、双Host隔离/原子换图均保留，loader只跟随背景/前景token变化，无额外布局mount或背景过渡。

## 验证与限制

本批仅源码只读核对固定grapheditor.css的真实类名/原生CSS变量和官方dark参数；没有运行终端UI自动化、启动新服务/Runtime或操作用户数据。类型检查与最终实际明暗页面/弹层/切图/保存导出由B/PM集中进行，未声称实页视觉已通过。

待实页复核重点：native按需菜单/动态弹层的文字对比、单色工具图标与色块、保白图纸、切主题选区/视口不跳且XML未变。未知未来vendor UI类名可能需窄补样式；不把当前CSS视为所有第三方插件外观契约。

类型检查：B集中单次`npx vue-tsc -b`已通过，包含Host/Viewport新增prop与helper。按固定源码补安全分页条件：当`.geDiagramContainer`含真实`.geBackgroundPage`时仅外围workspace跟主题，独立原生paper及grid样式原样；page=0无独立纸张，维持白色无分页图纸以免原黑标签失去对比。PM实际DOM复核若要求page0环境进一步收敛，需另据结构窄改，不能用反色掩盖。

PM实页底栏小修：按观测DOM给`.geTabContainer .geTab>div.geButton:empty`单色图标单独提亮，覆盖新增页面/页面菜单；只替换`input.geZoomInput`的下拉背景为灰色chevron，不filter输入框文字；`.gePageTab.geActivePage`及其span统一使用主题selected/accent，移除旧蓝灰active底。未改顶栏/模型/几何。该纯CSS补丁冻结，待PM单次bundle实页复核。

PM实页已确认上下层明暗一致，底栏图标可见、活动页签统一、属性面板与原生菜单文字可读。另按实页DOM只提亮子菜单单色箭头。主题操作前后完整document摘要与修订/时间不变，原生图纸及PNG保持原色；实际PNG下载通过。无分页样本DOM确实无独立paper，因此保白；不声称无分页底图也已变深。原5189页面已加载新构建，截图与证据见`output/playwright/appearance-20261018/`及[工作台报告](native-appearance-ui.md)。

## 用户追加：黑色工作背景，已验收

本节替代前述无分页工作区保白的限制。用户明确要求白色网格背景变黑，现仅dark环境容器及无分页直属根SVG的CSS背景为#171717，soft-light混合原生透明网格图像。未设置background shorthand/image/position/size，未改SVG子图元或文档；原有白色泳道内容仍保留。B只读复审和一次Vite构建通过，PM实页dark rgb(23,23,23)/soft-light，切浅色恢复rgb(255,255,255)/normal，网格图像和位置一致。当前5189已载入并保留深色；截图`dark-background.png`、数据`background-check.json`位于原appearance输出目录。未重复与CSS无关的导出测试，未提交推送改版本。

用户另要求去除底栏GitHub入口：仅精确隐藏`.geTabContainer>a[href="https://github.com/jgraph/drawio"]`，明暗均不显示或进入键盘/AX；给缩放框保留右对齐。一次构建及PM新页实测通过：可访问链接0、display:none，页签/+保留、缩放自定义39%正常。截图同目录`footer-updated.jpg`。未改供应或许可材料、其他位置链接和文档。

## BG-A 深色网格环境窄修（待PM实页验收）

2026-10-18 用户明确要求网格白背景改黑。仅新增dark限定CSS：`.geDiagramContainer`背景#171717；page0直属root svg的CSS背景同#171717，`background-blend-mode:soft-light`只混合原生透明网格background-image。未改background-image/position/size，网格密度、zoom和启停沿原生inline样式；none不会被加回网格。light撤去dark限定覆盖，恢复既有原白背景/原生网格。若真实`.geBackgroundPage`存在，外围变暗而独立原纸张保持原样，不新造纸张。

不选中svg子图元、不修改fill/stroke/text/XML，不filter画布，不改导出或文档时间/几何。原生图形白色填充允许保留。黑字无底浮动说明/边标签可能在暗背景下对比不足，须PM据实页定位；本批不擅自反转或改业务图形配色。仅CSS与本报告，无服务/自动化/数据操作、无版本提交推送。
