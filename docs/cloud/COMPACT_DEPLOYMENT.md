# 精简部署包：复用已验基线

用户于2026-10-24明确要求在全量传输失败后更换部署方式。本方案仍由Actions发布，复用既有受限上传、Java与应用晋级、数据库审核、备份和回退。现已两次实际生产发布成功，当前 `run-40090921255-1`；完整回执、后台缓存修复和业务验收边界见[生产验收](../validation/u30-production-acceptance.md)。下文首轮源/基线为协议实例，不是后续发布的固定输入。

## 固定边界

- 业务目标仍是成功通过source、真实Java/MySQL/Redis和平台门槛的main候选`40071395983` / `33f026e2174dec99016ded87dba96620803cb744`，目标releaseId=`run-40071395983-1`。
- 基线为当前生产`run-39994902799-1`。Actions验证两原始run各必需job成功，允许整个run仅因旧production传输失败；原始run即便后来经精简通道成功发布，也不会被伪改成绿色。基线还必须与固定HTTPS readiness的现版本吻合，服务器再独立检查root当前manifest。二者均须同仓库main来源，不信调用者提交的manifest。
- 先在Actions内下载旧、新原始平台制品并核官方来源与摘要；构建精简包，不重编业务。新完整`candidate.json`的原字节不改。
- 服务器只接受root已验证的当前基线；精简包不包含用户数据库、env、SSH权限或服务配置。
- 传输仍用既有`flymind-upload`字节通道。包必须足够小；先测实际字节，不凭估算宣称几MB。
- 用户终端一次安装审核后的静态materializer及两个promote调用点。不执行候选ops，不新增root shell/任意命令。此后应用更新均走Actions。

## archive协议

精简tar.gz顶层包含：

1. `candidate.json`：目标冻结完整manifest，保留prepared/source/release/ABI/files原字节。
2. `overlay.json`：以下固定协议。
3. 变化的普通文件：原相对路径；未变化的普通文件不传输。
4. 可选`_overlay/patches/<target-sha>.bin`：仅用于按字节重建大JAR的literal流。

`overlay.json`结构：

```json
{
  "schemaVersion": 1,
  "format": "flymind-overlay",
  "baseReleaseId": "run-39994902799-1",
  "baseSourceCommit": "40 hex",
  "baseCandidateSHA256": "64 hex",
  "targetCandidateSHA256": "64 hex",
  "patches": [{
    "path": "control-plane/system-admin.jar",
    "baseSHA256": "64 hex",
    "literalPath": "_overlay/patches/<target-sha>.bin",
    "literalSHA256": "64 hex",
    "operations": [{"from": "base", "offset": 0, "bytes": 123}, {"from": "literal", "offset": 0, "bytes": 20}]
  }]
}
```

所有长度/偏移为非负安全整数；单文件/累计字节、操作数、tar成员数和元数据均有预算，拒未知字段、重复路径、特殊文件、重定向路径、越界copy、少/多payload。只有JAR支持patch；不引入脚本执行或通用解释器。

## JAR精确字节复用

构建端使用ZIP索引定位旧、新JAR各成员的压缩数据区；相同压缩数据以旧文件offset/length引用，新本地头、时间戳、变化数据、data descriptor、中央目录及尾部放literal流。构建端重放后必须与原目标JAR逐字节SHA一致，否则回退传送整个变化JAR。服务器不解析ZIP、不重新压缩、不执行JAR，仅按有界COPY/literal流重建到未激活候选，最后核完整目标SHA。

## root materializer接口

共享静态模块`deploy/cloud/materialize-candidate.mjs`：

```js
await materializeCandidate({archive, destination, environment, python, run, requireRootOwned:true})
```

`run(command,args)`沿用调用者固定无shell执行器；archive已由调用者复制到root私有目录并核transport SHA。仅promote.mjs与control-plane-promote.mjs的直接解包处调用，服务停止/Java迁移必须继续位于完整校验之后。

- full包保留原安全解包行为。
- overlay包在独立root暂存目录按data_filter/数量/展开预算解开；不直接覆盖当前版本。
- 从固定root私有`/etc/flymind/<environment>/deployment.json`读取currentLink/releaseRoot，检查受信祖先、root保护、真实路径及当前基线manifest摘要和身份；测试通过显式`baselineRoot`和`requireRootOwned:false`注入私有fixture，生产调用禁止提供该覆盖。
- 新目录只构造目标完整manifest所列文件。未变文件仅在旧/新path、type、bytes、SHA均一致时从已验基线复制，不共享可写hardlink。变化文件来自payload或有界JAR patch。symlink只允许目标内相对链接，最后建立，防止写入通过链接改动基线。
- 不复制多余基线文件；拒payload多余项；copy/patch出错不得产生prepared回执或停止服务。
- 构造后继续原`verifyCandidate(...,{requireRootOwned:true})`全树检查。Java原11项SQL白名单、备份/readiness/会话与应用回退逻辑均保留。

## 验收门槛

1. 私有fixture验证full/overlay、变化/删除/新建/链接、精确JAR重建、错基线/篡改/越界/特殊文件/额外payload拒绝，基线不变。
2. Linux上使用实际旧、新冻结平台包构建并materialize，完整verifyCandidate通过，输出原包/精简包字节及真实差集。
3. 服务器静态工具安装经固定源commit/新旧SHA审核，保备份、root权限和实际部署账号可读。
4. Actions上传精简包→原Java与应用晋级→目标release readiness→9项实际线上验收；未满足前不得宣布完成。

## 实际体积核查

PM已下载并核对旧、新Linux原始tar的SHA，流式读取原manifest及JAR。目标原包389,872,360字节；实际变化214项，除JAR外4,370,108字节。目标JAR128,173,347字节中，127,854,716字节压缩区可直接复用，仅318,631字节literal、927项操作；重放完整JAR SHA与目标原字节一致。

Actions [40085197513](https://github.com/beidaomitu233/FlyMind/actions/runs/40085197513) 已成功完成真实 Linux 原始包构建与重放：精简 tar **2,066,654字节**，为原包0.53%；9309个目标文件通过完整验证，原manifest字节不变，基线再次验证通过。证据在该run的 `compact-verification` 制品（`source-proof.json`、`build-report.json`、`roundtrip-report.json`）。这是非特权Linux还原验收；服务器静态工具安装、实际晋级与线上业务验收仍未完成。

旧全量自动生产开关 `CLOUD_AUTO_PRODUCTION=false`；精简生产使用 `CLOUD_COMPACT_ENABLED=true` 和显式dispatch的 `deploy=true`。Push只运行格式/安全回归，不对已经部署后失效的首轮固定基线重新做来源核对；dispatch必须重新通过来源、真实原始包和完整重放全部门槛。当前不会每次push自动发布。

首轮生产 `40089368684` 上传2,066,654字节，181秒，Java及应用晋级均成功。缓存修复的完整候选 `40090921255` 经第二次精简发布 `40092008345` 上线：基线 `run-40071395983-1`，包1,669,712字节、94秒上传，完整目标manifest SHA `168cddd253291319662d7fb88a93e208d9740cd243cafa42153f44e51c64e67d`；最终公网ready且pendingWrites=0。第二次不需要重装服务器静态工具。
