# 可选的 compact 内存配置（1.5 GiB / 1 GiB 主机）

默认配置不变：浏览器与 SVG 工作进程准入要求至少 512 MiB，SVG 子进程 V8 堆上限 256 MiB、RSS 上限 384 MiB，浏览器运行中可用内存低于 128 MiB 时取消。未知 `FLYMIND_MEMORY_PROFILE` 值使用默认配置。compile 等非 SVG 工作的原有 384 MiB 准入、256 MiB RSS 和 256 MiB 堆上限不变；重活子进程运行中仍保留 128 MiB 保护，既有队列、取消、关闭与浏览器 sandbox 不变。

两个显式紧凑配置都启用已校验的 WOFF2 字体分片供应（供原编辑器页面与原生 PNG 导出共同使用；字符集取原 XML 及已解码内容的超集，始终包含完整 core，所选文件合计超过 2 MiB 时回退完整 OTF；仅接受已审的基础形状、静态简单 HTML 和固定无文本技术图标；公式、动态占位、复杂文字或样式、未知图形和图片等回退完整 OTF）：

- `compact-1_5g`（当前生产主机 1.5 GiB 预算的选择）：仅切换紧凑字体供应，浏览器与 SVG 准入、堆/RSS 与压力余量保持上述默认值。
- `compact-1g`（仅 1 GiB 主机）：浏览器与 SVG 准入 384 MiB，SVG 子进程 V8 堆上限 160 MiB、RSS 上限 256 MiB；浏览器运行中可用内存低于 64 MiB 时取消。

服务环境按 1.5 GiB 预算配套：应用 `NODE_OPTIONS=--max-old-space-size=256`、网关 `--max-old-space-size=128`、`MALLOC_ARENA_MAX=2`；Java 控制面 heap 256 MiB（metaspace 128、code 32、direct 16 MiB、SerialGC）。

运行压力余量与进程预算的调整是预算适配，不会降低实际内存占用，也不是操作系统内存限额；必须由管理员配合已验证覆盖服务及所有后代的 `flymind.slice` 硬边界和不重叠的发布维护流程使用。1.5 GiB 主机使用 `MemoryHigh=1472M`/`MemoryMax=1536M`；1 GiB 主机使用 `MemoryHigh=1000M`/`MemoryMax=1024M`（软阈值高于硬上限减 128 MiB，避免与浏览器压力线重合）。`MemorySwapMax=0` 禁止该组使用 swap。内核和应用的采样及内存口径不同，且突发分配可能越过阈值，因此不保证应用取消先于内核节流或 OOM。安装配置或启动进程本身不能证明该边界有效，也不能保证任意图形在此配置下成功。堆/RSS 较小可能令复杂 SVG 工作失败；余量较低可能增加 cgroup OOM 风险。配置前后应在等价的受限环境验证真实浏览器 sandbox、字体、PNG/SVG 与编辑保存，并记录 cgroup 峰值及 OOM 事件；失败应保持明确错误和原任务重试语义，不改用其他渲染路径冒充成功。Linux 平台候选须通过六类标准样本的原生 PNG 完整 OTF 与选片逐像素对照。
