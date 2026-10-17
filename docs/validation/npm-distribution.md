# MCP 安装包与 GitHub 分发验收

日期：2026-10-18。用户先授权执行 npm/Registry 路线，随后因尚未注册 npm 明确改为先发布 GitHub；npm/Registry 上架延期。MIT 由用户明确选择。复用原 dev_engine、dev_application；PM独立验收，不改现有用户数据或工作台 UI。

## 范围和结果

| 项目 | 实际结果 |
|---|---|
| 环境 | Windows，Node 20.19.6，npm 10.8.2；其他平台未验收，包声明 win32 |
| 构建/回归 | npm run build 通过；npm test 的309项及新增CLI4项均通过，0 skip |
| 独立安装 | npm pack 生成 tarball，在源码目录之外的独立临时前缀安装 --omit=dev，168个依赖约48秒；无TS源码，tsx/typescript/vite不能解析 |
| 首次资源 | 从独立安装的CLI真实联网下载固定 draw.io 31.5.3 与 Chromium151/revision1234，字体使用随包固定文件；独立资源缓存 setup 与 doctor 成功 |
| STDIO | 真实默认SDK发现18工具、读取标准与五型能力；stdout为协议，stderr为空 |
| 五类图 | 流程、泳道、架构、脑图、数据流均创建r1，质量检查通过；返回真实PNG及PNG/SVG/drawio/内容JSON/完整project五制品，校验PNG头、尺寸、文件非空及所在数据根 |
| 修改/幂等 | 流程r1→AI wording r2；同请求create重放仍为旧r1、声明当前r2，不重复创建 |
| 分组/复连 | 组内只出现1份，未分组不重复；MCP关闭再连接，创建时间、修订及同Runtime身份保留 |
| 网页闭环 | 从独立安装返回的动态地址打开原工作台，真实双击节点改为“网页复核资料”，自动保存r3；点击PNG导出实际下载39016字节，截图核对已保存 |
| 复装与再次AI修改 | 正常停止自有QA实例，复装更新的同版本tarball仅changed1包/2秒；MCP重新启动后读到网页r3与修改内容，继续改标题r4，保留节点文字和createdAt，返回39721字节PNG；正常请求自有Runtime关闭 |
| Registry准备 | 官方mcp-publisher v1.8.1（下载SHA256 399ad0d6e00a50812b563a71d8bfbff5160c085e6b13aac6ec083d98d5ff7c45）执行validate返回server.json valid；未publish |

## 必要返工与证据

- 初审纠正studio打开旧根入口，改为 `/#/native`；MCP握手前下载会超过客户端启动预算，改显式setup、缺资源快速报错；安装进度写stderr。
- 首轮沙箱回归出现临时文件rename EPERM并卡住，停止该自有测试树；常规Windows权限重跑309+4通过，未修改生产行为或放宽测试。
- 第一次独立SDK脚本未计入应用自带五个旧只读示例，数量断言失败；保留失败证据，脚本改为记录初始基线，在全新隔离数据根重验通过，不改应用种子行为。
- npm10网页登录启动器异常退出，未取得登录凭据；用户决定GitHub先行后没有继续要求npm登录。

本机忽略目录 `output/npm-release/` 保留：pack.json、session.json、setup.log、tests.log（沙箱失败）、tests-unsandboxed.log（通过）、acceptance/result.json（初始数量假设失败）、acceptance-final/result.json（通过）、post-ui-result.json、after-web.png、最终制品及SHA。原始业务数据、个人凭据和这些测试输出不进入Git或安装包。

## 发布契约

- GitHub下载标签 `mcp-v1.0.0`，应用/package版本1.0.0；原 `v1.0.0` 不移动。
- npm包使用预编译服务、原工作台dist、CLI及必需规则/许可白名单；不包含用户数据、vendor、浏览器、测试或开发依赖。
- ZIP提供tarball、安装/Codex文档、许可证和摘要，首次依赖/资源仍需联网。
- 用户主入口 [安装与使用](../INSTALL_AND_USE.md)，维护流程 [PUBLISHING](../PUBLISHING.md)。
- 本批通过不代表旧数据迁移、D07/D08/G2全路线通过；新安装仍显示旧只读示例，CLI不会自动迁移原用户库。

最终远端提交、标签、Release与制品校验由发布后回读核实，以Git和Release记录为准。

2026-10-18 远端回读：Release `mcp-v1.0.0` 已公开（draft=false），四项assets均uploaded。ZIP SHA256 `e0cc6c882685a269805bb66ce9923b0e641bb571b89cb2911a7a210260b0e5bf`，tarball `26378d319301645bf997d073a33ae4c253563f2025f35c80dd56909592559817`，安装文档 `153743fee2731ef0c7d3e4388436b7fc1b9964ee6f4c45a34f58e94c8489f9a9`，摘要文件 `86b162421c584ad7188de98de0fc7d354920cbcc37186200fea135d6dac88049`，均与本地制品一致。源码主体提交062ee36608338324aa7dddf3729b50618bc52896，源代码补交Registry元数据与固定字节检出规则另见main后续提交；不改已发布制品或标签。

推送后的远端Windows CI先在源码setup的LICENSE校验失败，原因是Git autocrlf改变固定资源字节；新增属性保留固定供应字节，保持原哈希校验。此问题未发生在已验收的npm tarball安装流程。最终CI结果另以Actions实际记录为准。

源码CI第二轮8553877已通过资源准备和构建，测试301/309；其余失败来自托管Windows的TEMP使用RUNNER~1短名而realpath返回runneradmin，以及持锁测试辅助脚本-File启动未就绪。CI改用runner.temp作为TEMP/TMP，不放宽生产路径边界；持锁夹具改固定内联-Command而不更改执行策略或安全断言。原B正常权限定向13/13通过，PM审查差异后推送；新一轮CI作为最终跨机器核验。
