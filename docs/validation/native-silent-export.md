# Windows 原生导出静默启动修复（2026-10-18，指定范围已验收）

## 根因与实现

固定 `chrome-headless-shell.exe` PE subsystem=3（Windows console executable）。本地Playwright1.62.1实际`coreBundle.js`的`launchProcess`调用child_process.spawn，Windows分支没有windowsHide；headless只关闭浏览器UI，不保证控制台不可见。原Runtime launcher的windowsHide只覆盖自己的Node child，不覆盖Playwright再启动的浏览器。B已只读独立核对。

`server/rendering/hidden-browser.ts`仅在Windows由应用自有spawn启动同一固定exe：`windowsHide:true,shell:false`、专用mkdtemp profile、stdio3/4 `--remote-debugging-pipe`。通过固定Playwright公开`connectOverCDP(transport)`接入；无TCP调试端口、无新依赖、无vendor/node_modules改动、无全局child_process patch。UTF8按NUL完整帧后解码，支持跨chunk/多帧，128MiB CDP帧预算不误用Host5MiB限制。非Windows仍用原Playwright launch。

生命周期显式发送CDP `Browser.close`，有界等待；断连/异常幂等关闭，await owned child close后清理专用profile。必要强杀仅本次owned PID tree，taskkill也windowsHide、shellfalse和3秒timeout。清目录前核对resolved绝对父目录与本次mkdtemp前缀；不清用户路径。renderer.close等待当前launch settle，按launch身份guard缓存，避免旧disconnected清掉新browser或关闭时漏掉新启动进程。Playwright close和CDP close均有界，不让清理卡住强杀分支。

固定供应/字体/版本校验、origin/source消息隔离、任务context、外联阻断、输出与硬预算全部保留。

## 实际验证

- `node --import tsx --test tests/drawio-renderer.test.ts`：8/8，包括真实spawn配置、缺exe立即失败、原资源/字体/尺寸/参数限制。
- `npx tsc --noEmit -p tsconfig.server.json`：通过。
- `node --import tsx scripts/probes/drawio-hidden-renderer.mjs`：独立2节点中文流程小样本。首次沙箱回环拒绝后同命令获批；该轮遇60秒硬超时，清理完成。启用`DEBUG=pw:api`对同一代码/同一样本阶段诊断后实际导出成功，未放宽预算或修改供应。原因尚未证明，不能把DEBUG当产品修复或声称无偶发超时。
- 成功产物：`output/playwright/hidden-renderer/silent.png`27840字节，`silent.svg`21922659字节；report记录固定151、privatePipeNoTCP、ownedPID25300正常退出、profileRemoved=true、缺exe5ms失败。
- PM独立真实worker出口：`output/playwright/editing-parity-20261018/silent-export-pm.json`，baseline-flowchart PNG833×1535，PNG/SVG字节与SHA通过、文档未变、QA实例正常关闭，总约8秒。用户Runtime未由A启动/修改。

早期诊断曾记录窗口标题扫描；该记录不作为“无闪窗”保证，最终专用脚本已删除所有PowerShell/user32/窗口读取且不再重跑。可验收证据限于实际worker成功、应用真实spawn参数、固定exe类型与自有进程/profile清理；没有桌面截图或所有二级窗口的完备可见性证明。最终脚本现只做导出和进程生命周期，无UI读取。

修改：hidden-browser.ts、renderer.ts、tests/drawio-renderer.test.ts、scripts/probes/drawio-hidden-renderer.mjs及本报告。未提交/推送/改版本，未测试写入用户数据库，未跑大probe。

## PM验收与运行更新

PM复审代码和B独立结论，独立运行真实worker及服务端tsc通过。PNG已打开核对，PNG/SVG下载SHA与manifest一致，文档及revision不变；5191验收实例正常停止。约01:54以同一数据根更新5189，PID31880再次确认存活、日志正常，用户页面和数据不变。本次仅验收静默进程启动及受影响导出链路，不扩大为完整路线通过；偶发超时继续保留为未确定原因的记录。
