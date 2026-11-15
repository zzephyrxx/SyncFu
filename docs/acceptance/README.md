# SyncFu BoardUI 核心工作台双机验收

## 这轮只用验收版

- 应用名：**SyncFu Acceptance**
- 应用标识：`org.syncfu.acceptance.p2`
- 验收包版本：`0.2.0-board.1`
- 对等协议：**4**；状态 schema：**3**。两端均须使用此次新版，不能与旧 protocol 3 验收包混用。
- 沿用旧 P2 验收应用标识，因此可能看到以前的专用验收配对/任务；这不是正常版数据库。不要同时运行两个验收版本。
- 正常版标识仍为 `org.syncfu.desktop`。验收版使用自己的状态、配对身份和备份目录，不迁移正常版数据库。
- 两端仍使用 TCP 47657，所以启动前必须从托盘/菜单栏**退出**旧 SyncFu；仅关闭窗口不等于退出。
- Mac 包仅有本地 ad-hoc 完整性签名，没有 Developer ID 签名/公证；Windows 本地构建也不承诺已签名。遇到系统安全提示请先反馈，不要关闭系统安全功能。

本指南是**验收准备**，不是双机已通过的声明。执行者应分别记录两端状态与校验结果，再判断对应步骤是否通过。

`results.json` 保留 2026-11-14 的历史构建记录；其中的构建 ID 不会随文档整理自动改写。`source-manifest.json` 标识当前准备的源码快照，两者范围不同，不能把历史构建通过当成当前源码或云端 CI 已通过。仓库不包含本地验收安装包；需要时从同一源码快照分别构建两端。

## Windows：构建同一版本

将源码 ZIP 完整解压到本机普通磁盘的新目录，避免网络盘、链接目录及把旧项目文件覆盖进去。

需要 Node.js 22.18+、Rust stable、Visual Studio C++/Windows SDK 和 Tauri 平台依赖。首次构建需要网络获取锁定依赖和 NSIS。默认轻量安装包不携带完整 WebView2 离线运行时；目标电脑已安装时直接使用，缺失时才联网安装。

如目标电脑完全离线，显式构建较大的离线运行时安装包：

```bash
node scripts/build-acceptance.mjs windows --offline-runtime
```

之前出现的 `mirrors.ustc.edu.cn` / `127.0.0.1` 代理连接失败属于构建机网络配置问题。脚本会停下并提示，不会更改全局代理、关闭 TLS 或用旧产物替代。

推荐双击源码根目录的 **Build-Windows-Acceptance.cmd**。也可在该目录终端执行：

```bash
node scripts/build-acceptance.mjs windows
```

脚本先校验源码指纹，然后安装锁定依赖、运行内核/契约/资料工具测试，再生成独立验收安装包。任一步失败会停止，**不要改用旧安装包继续测试**。

安装包目录：`target/x86_64-pc-windows-msvc/release/bundle/nsis/`。

安装并打开 **SyncFu Acceptance**。不要从旧快捷方式打开正常版。构建成功只是 build PASS，不是双机验收 PASS。

生成 Windows 测试资料（仅第一次；目录必须不存在）：

```bash
node scripts/acceptance-data.mjs init --side windows --root acceptance-data/windows
```

工具拒绝覆盖已有目录。输出的 initial 报告必须为 `pass: true`，否则先停止。

## Mac：使用本轮验收包

解压 `SyncFu-BoardUI-Acceptance-macOS-universal.zip`。其中包含通用架构应用、测试资料和校验工具：

- `SyncFu Acceptance.app`
- `test-data/mac/`：已经生成的专用样例
- `tools/acceptance-data.mjs`：只创建新样例或只读校验，不提供删除/重置命令

从包内打开验收应用；若要移到 Applications，请只移动应用，不在授权后移动测试资料目录。

可在包的根目录核验初始资料：

```bash
node tools/acceptance-data.mjs check --root test-data/mac --stage initial
```

## 第 0 轮：启动与隔离

先完成这些，然后回传结果：

1. 两台设备连到同一局域网，退出旧 SyncFu。
2. 两端打开 **SyncFu Acceptance**，确认没有“版本不匹配”或端口占用错误。
3. 新验收实例应没有正常版的旧配对和任务。若看到了日常任务/历史，立刻停下，不授权、不同步。
4. 打开设置 → 安全与备份，查看备份路径。路径应包含 `org.syncfu.acceptance.p2`，不应是正常版 `org.syncfu.desktop`。
5. 两端 initial 数据检查均通过。

回传 Windows 构建末尾结果、两端首页截图、备份路径中的应用标识部分和 initial 报告。**不要发送配对码、私钥或系统凭据；用户名/IP 可打码。**

## 第 1 轮：连接和目录授权（等第 0 轮确认后）

1. Windows 进入设备 → 连接设备 → 等待连接。
2. Mac 发起连接，选择 Windows 或输入它显示的局域网地址，并输入 Windows 屏幕上的五位码。
3. Windows 允许配对，等待两端真正显示连接就绪。不要把“已点击允许”当作已完成身份核验。
4. 两端分别只授权 `test-data/mac/01-bidirectional` 与 `acceptance-data/windows/01-bidirectional`。
5. 新建任务时选“这是我自己的设备、双向”，创建并发送确认；在对端确认第一次关系。日后方向可直接在任务交换台切换。
6. 两端任务规则一致、没有 pending 后，先停在这里回传。

不要把整个源码目录、桌面、文档目录或日常资料根目录授权给这次验收。

## 后续轮次与精确预期

这些是后续验收路线，不要一次性全部执行。每一轮确认后再进入下一轮。

| 轮次 | 操作 | 必须满足 |
|---|---|---|
| 2A 双向普通变化 | 保留 conflict.txt 不处理，点击同步默认新增/更新项 | 普通项经后台预检直接执行，不额外弹确认；两端独有文件互补，中文路径正常，冲突各自保留 |
| 2B 冲突 | 比较 conflict.txt，明确使用 Mac 版，再确认同步 | 两端 conflict.txt 与 Mac 原版相同；有备份/历史 |
| 3 单向更新 | 关联 02-one-way-update，Mac 为源端，Windows 拉取 | master.txt 被覆盖，new/deep.txt 到达；Windows receiver-only.txt 保留且不反传到 Mac |
| 4A 镜像保护 | 关联 03-mirror，Mac 为源端；检查 Windows 额外内容 | 103 个普通文件删除触发保护；未批准不写入，父目录依赖可见 |
| 4B 镜像执行 | 管理端核对并仅批准这次清单 | Windows 仅剩 keep.txt（内部 .syncfu-stage 除外）；可能是 104 项操作：103 文件 + 1 目录 |
| 4C 撤销 | 从历史预览并撤销刚才的镜像批次 | 103 个文件原字节恢复，目录恢复；不是删除后再生成相似文件 |
| 5 权限/暂停 | 04-shared 设为 Mac 管理的单向共享 | Windows 不能改方向/批准越权；可按规则拉取和本机暂停；暂停阻断远端写入 |
| 6 后续编辑/中断 | 专项准备后再执行 | 旧预览不能覆盖后续编辑；中断需核对，不假报全部成功 |

各轮校验命令中的 `--stage` 可选：

- `initial`：校验四个目录的初始资料
- `bidirectional-unresolved`：双向普通项完成、冲突仍保持各自版本
- `bidirectional-resolved-mac`：冲突已明确采用 Mac 原版
- `one-way-updated`：单向更新后接收端独有文件仍保留
- `mirror-cleared`：镜像后清理完成
- `mirror-restored`：镜像批次已撤销且原字节恢复
- `shared-synced`：共享文件已到达接收端

Windows 在源码根目录：

```bash
node scripts/acceptance-data.mjs check --root acceptance-data/windows --stage bidirectional-unresolved
```

Mac 在验收 ZIP 解压根目录：

```bash
node tools/acceptance-data.mjs check --root test-data/mac --stage bidirectional-unresolved
```

需要保留中间状态时，用 `snapshot` 代替 `check`，无需 stage。报告写入验收根下 `reports/`，仅含相对路径、大小、指纹与差异，不包含文件正文或密钥。`.syncfu-stage` 和系统元文件被忽略，**不要手动删除 .syncfu-stage**。

## 判定规则

- 代码编译通过 ≠ 应用启动通过 ≠ 配对通过 ≠ 文件同步通过。
- 对话框显示成功，但文件指纹不符合预期，仍然 FAIL。
- 一端完成、另一端离线/未核对，记 PARTIAL，不记 PASS。
- 没有实际操作或证据的项目记 NOT RUN。
- 当前不启用自动同步；P3 尚未实现。验收开机启动也保持关闭。
- 出错先保留两个测试目录、历史与报告，回传错误和最后一步操作，不反复覆盖重试、不清应用数据、不借“重新配对”掩盖问题。
