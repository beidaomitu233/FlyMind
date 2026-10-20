# C01-UI 类型基线与最小修复

2026-10-19，仅修改受控副本，源目录未改。首次 `web-ele typecheck` 共8项：新接线2项、原源基线6项。依赖/锁文件版本未更改，未使用any、ts-ignore或放宽tsconfig绕过。

| 路径 | 原错误 | 最小差异 |
|---|---|---|
| apps/web-ele/src/api/system/flymind.ts | RequestClient没有patch方法（2项） | 使用既有request，显式method PATCH和data，HTTP契约不变 |
| apps/web-ele/src/views/monitor/operlog/index.vue | ElTag不接受宽泛string颜色（2项） | 枚举原6种映射的合法字面量，未知值交组件默认 |
| apps/web-ele/src/views/system/menu/index.vue | unused import、缺空参数、TreeOptionProps不含value（3项） | 去unused；传{}；用原生node-key=menuId保留ID绑定 |
| packages/@core/ui-kit/form-ui/src/form-render/form.vue | unused wrapperRef解构（1项） | 仅删除外层解构；useExpandable内部useTemplateRef仍绑定同名DOM并保留全部计算 |

安装：官方registry剩余固定@iconify/json@2.2.431连续ECONNRESET后停止自有安装进程。使用原frozen lock在单次命令指定公开镜像，只下载剩余1包，1751包复用；未写永久镜像配置，也未读取源npm凭据。新store位于D:/AIBuilder/PM/.cache/pnpm-admin-store，node_modules属于副本，不指向源node_modules。

锁文件SHA256：`CE79599F18ACA25A001CAF7B0FCB1D03C177CA2EEA9CC51ED3BC3F7603620A53`，安装前后及类型检查后均相同。安装日志install-official.log/ install.log；最终类型检查typecheck.log，退出0。

首次直接运行app build缺少@vben-core/design的dist，这是工作区依赖尚未构建。实际交验使用既有Turbo dependsOn ^build顺序构建web-ele闭包，不改导出映射、不复制源dist、不改依赖以绕过。

最终构建入口为scripts/build-flymind-admin.mjs。Vite产物检查发现过程环境不能替代上游helper的.env文件读取，故脚本只临时创建新模板配置、拒绝覆盖已有文件，结束清理。最终11/11构建通过并验证公开base/API；原index.html的继承统计块已按PM授权移除，无替代跟踪。日志build.log/.validation/build-guard.log，完整逐文件摘要.validation/build-result.json。锁SHA未变。
