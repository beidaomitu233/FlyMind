# U32 显式排版状态反馈

PM已完成限定实页、失败重试和构建验收，最终证据见[U32集成记录](u32-layout-feedback.md)，未发布。

2026-10-25。本批不提交、不部署、不修改用户数据。

## Viewport 接口与行为

`DrawioViewport` 新增可选 `layoutLoading?: boolean` 和 `layoutLoadingLabel?: string`，缺省为 false / “正在排版…”。独立于既有切图、预热、prepare loading。

排版状态层常驻 DOM，仅 opacity / visibility 过渡（160ms），保留真实画布为背景，不重挂 iframe、不改变布局或图元。浅色半透明浅灰、深色半透明黑灰，中心轻量状态与16px转圈；无全屏黑屏。排版期间仅实际 iframe 槽 inert，状态层在可访问树保留；wrapper aria-busy 表达工作中。退出状态立即释放交互并淡出，隐藏后不接收指针。prefers-reduced-motion 下不旋转、不淡变。

NativeStudio 生命周期由 application 代理接线：先 true + nextTick/双RAF，再执行 capture/flush/configure/merge；公开 load ACK、adopt 与双RAF之后 finally false。失败同样 finally 清理，不增加每次确认或伪造完成。

## 隔离验收入口

`output/u31-preview.mjs`，`http://127.0.0.1:5297/#/cloud`，夹具账号 alice / fixture-password。临时 SQLite 与夹具权限权威，不是生产/真实 Java 证据。

仅该夹具对 POST `/cloud-api/teams/team-a/studio-api/native/diagrams/:id/rendering` 延迟1500ms。POST `/__fixture/layout-fail-next` 可预置下一次503失败（不调用产品排版服务）；GET `/__fixture/layout-state` 可读请求次数与失败状态。这些端点和延迟不进入产品源码。

PM 独立检查：横/竖/自动排版期间原图仍在、转圈与文案可见、不能编辑；完成后状态消失且原生编辑可继续；失败后状态清理且原图保留；深浅主题/reduced-motion；iframe 数量与身份不因状态层新增。最终实页证据由 PM 记录，本文件不将样式实现称为实页通过。
