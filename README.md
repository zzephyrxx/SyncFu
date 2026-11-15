<p align="center">
  <img src="assets/syncfu-icon.svg" alt="SyncFu" width="88" />
</p>

<h1 align="center">SyncFu</h1>

<p align="center">两台电脑，同一份资料。面向 Windows 与 macOS 的局域网文件夹同步工具。</p>

<p align="center">
  简体中文 · <a href="docs/README.en.md">English</a> ·
  <a href="docs/README.md">文档</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a> ·
  <a href="SECURITY.md">安全说明</a>
</p>

<p align="center">
  <a href="https://github.com/zzephyrxx/SyncFu/actions/workflows/ci.yml"><img src="https://github.com/zzephyrxx/SyncFu/actions/workflows/ci.yml/badge.svg" alt="Verify and package" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0" /></a>
</p>

> **开发预览阶段**：SyncFu 目前提供手动同步，不是已完成生产验收的稳定发行版。请先使用专用测试目录，并保留独立备份。浏览器演示、自动化测试和本机构建不能替代实体双机验收。

## 为什么是 SyncFu

SyncFu 把一次同步集中到一张清单：检查文件变化，选择新增、更新或删除，再执行。配对的发起方不决定同步方向；每个任务独立选择规则，用户保留处理冲突和删除的决定权。

- **三种同步规则**：双向、单向更新、单向严格镜像。
- **快速批量选择**：按新增／更新／删除选择全部匹配项，支持跨页批选和本次发送／接收范围。
- **明确处理冲突**：比较版本、采用指定版本、稍后处理、忽略当前版本或永久排除路径。
- **少打断，不省保护**：普通新增／更新在后台预检后直接执行；删除、冲突覆盖、撤销和异常风险再次确认。
- **可恢复的文件操作**：覆盖或删除前备份，记录操作回执，支持受保护撤销和中断后的结果核对。
- **本地优先**：无需云账户；文件在局域网内直接交换，不依赖中继服务器。
- **局域网优先配对**：选择自动发现的设备，输入五位配对码；独立数字格支持整码粘贴，手动 IP 作为备用入口。
- **设备识别**：支持本地备注、Fluent Emoji 头像和可选类型图标；自定义 emoji 保留系统字体回退，仍以稳定设备 ID 识别对端。
- **明确同步方向**：设备与文件夹独立展示，任务使用不同颜色的文件夹图标；新建任务表单清楚区分两端。
- **清晰的桌面界面**：可折叠侧栏、独立使用总览、macOS 单行工具栏；主题在设置中切换，支持简中、繁中、英文、日文和韩文。

### 界面预览

下图使用隔离的演示数据，不包含真实同步目录或配对凭据。

| 任务工作区 | 深色主题 |
| --- | --- |
| ![任务工作区，清楚展示设备和文件夹端点](docs/shadcn-redesign/screenshots/workspace.jpg) | ![深色主题工作区](docs/shadcn-redesign/screenshots/dark.jpg) |

更多界面与验证范围见 [当前桌面 UI 说明](docs/shadcn-redesign/README.md)。

### 当前界面实现

保留现有 Tauri／Rust 应用，按 tauri-ui 的桌面交互约定调整窗口、选择与滚动行为；没有重新运行脚手架覆盖项目。按钮、输入框、复选框、弹窗和菜单使用本地维护的 shadcn/ui 组件及 Radix 交互原语。

| 视觉元素 | 当前实现 |
| --- | --- |
| 设备头像 | 本地 Microsoft Fluent Emoji 3D 素材；自定义 emoji 可回退系统字体 |
| 设备类型、操作与任务文件夹 | Lucide，任务使用不同颜色的平面文件夹 |
| 在线、离线及任务状态 | Phosphor Circle 的不同字重与颜色，并保留状态文字 |
| 文件类型与冲突 | react-file-icon 文件图标；Lucide 红色冲突警示 |

BoardUI、Morphicons 和 EasyUI 的旧版设计及来源文件保留为历史记录，不再描述当前运行界面的组件选型。

## 平台与项目状态

| 项目 | 当前状态 |
| --- | --- |
| Windows | 目标为 Windows 10 22H2／Windows 11 x64，需要 WebView2 |
| macOS | 目标为 macOS 13+，支持 Apple Silicon 与 Intel 通用构建 |
| Linux／移动端 | 暂不支持 |
| 自动同步 | 尚未实现自动写入调度；打开任务后的自动检查只读 |
| 网络 | 同一可互通的 IPv4 局域网，默认 TCP `47657`；无公网中继或 NAT 穿透 |
| 协议 | 对等协议 **4**，状态 schema **3**；不能与 protocol 3 客户端混用 |
| 发布 | 当前以源码为主；CI 成功运行后可在 Actions 中下载对应平台构建产物 |

构建产物不等于已签名／公证的稳定发行版。Windows 默认不捆绑完整 WebView2 离线运行时：已有运行时则复用，缺失时联网下载。构建依赖、首次安装 WebView2 和手动打开发布页可能需要互联网。

## 快速开始

### 运行桌面应用

先安装：

- [Node.js](https://nodejs.org/) **22.18+** 与 npm。
- [Rust stable](https://www.rust-lang.org/tools/install)。
- [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)：Windows 的 C++ 构建工具／SDK，或 macOS 的 Xcode Command Line Tools。

克隆本仓库，进入项目目录，然后执行：

```bash
git clone https://github.com/zzephyrxx/SyncFu.git
cd SyncFu
npm ci
```

```bash
npm run tauri dev
```

### 仅预览界面

```bash
npm run dev
```

打开 `http://localhost:1420/?desktop-test`。此入口仅在开发模式可用，不连接真实设备，也不读写同步目录。浏览器首页不是完整桌面运行环境。

## 第一次同步

1. **连接设备**：两台电脑接入同一局域网。进入「设备 → 连接设备」，一端等待连接，另一端选择扫描到的设备并输入它的五位**配对码**；等待端确认请求。找不到设备时，再展开手动 IP 入口。
2. **授权目录**：两端分别授权一个专用测试目录。不要直接授权整个用户目录、桌面或系统目录。
3. **建立任务**：关联两个授权目录，确认个人／共享关系及同步规则。首次关系分类需要对端确认。
4. **选择变化**：检查清单。非冲突新增／更新默认选中；删除和未解决冲突不默认选中。类型卡只改变选择，不立即执行。
5. **执行与核对**：点击「同步」。需要确认的危险操作会列出最终清单；如果断线或部分完成，到历史中核对结果，不要直接假定两端一致。

「本次范围」只决定这一次发送或接收哪些项，不改变任务的长期同步规则。关闭窗口后应用仍可能在托盘／菜单栏运行；退出旧版本时请使用退出菜单。

详细步骤见 [双机验收指南](docs/acceptance/README.md)。

## 构建安装产物

请在目标操作系统上构建；以下命令生成普通应用配置，不是独立验收配置。

### macOS 通用应用

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

```bash
npm run tauri -- build --target universal-apple-darwin --bundles app
```

输出：`target/universal-apple-darwin/release/bundle/macos/`。

### Windows 安装包

```bash
npm run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis
```

输出：`target/x86_64-pc-windows-msvc/release/bundle/nsis/`。

完全离线安装时，可显式选择较大的 WebView2 离线运行时包：

```bash
npm run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis --config src-tauri/tauri.offline.json
```

独立验收版使用 `org.syncfu.acceptance.p2`，与普通版 `org.syncfu.desktop` 区分。其构建入口、源码指纹和安全说明见 [验收文档](docs/acceptance/README.md)。旧 P2 专用验收任务可能保留，不要同时运行两个验收版本。

## 验证与安全边界

本轮 tauri-ui／shadcn 界面已通过 `npm test` 的 **83 项测试**，并成功构建 **macOS arm64 应用**。浏览器验证覆盖 1120 × 780 与 680 × 560 窗口、浅色／深色主题；详细行为检查和截图见 [当前 UI 说明](docs/shadcn-redesign/README.md)。

- 本轮截图和浏览器检查均使用 `desktop-test` 夹具，覆盖设备自定义与侧栏折叠持久化、配对码输入、文件选择、菜单及对话框行为，不连接真实对端。
- macOS 应用构建成功不代表系统权限或原生交互已完成验收；旧版 macOS 预览记录见 [上一轮 UI 重构记录](docs/ui-refresh/README.md)。
- **本轮 Windows 原生窗口与实体双机 LAN 同步尚未完成验收。**
- 本地构建或 ad-hoc 验签不等于 Developer ID 签名、Apple 公证或生产验收。

SyncFu 使用 PAKE 配对、双向 TLS、SHA-256 内容核验、授权根约束、写前检查和删除风险门禁，但尚未经过独立安全审计。同步不能代替独立备份；撤销只针对该次同步产生的修改，并保护后续编辑，不是整个目录的时间旅行恢复。

当前主要面向内置磁盘上的普通文件与文件夹、约一万个文件规模的个人资料。活动数据库、应用资料库、NAS、移动盘和完整系统元数据保真不在当前验收范围。详见 [安全说明](SECURITY.md) 与 [当前界面说明](docs/shadcn-redesign/README.md)。

## 常见问题

- **发现不到对端**：检查 Wi-Fi 客户端隔离、双方 IPv4 互通和本机防火墙；可手动输入对端地址。
- **网络权限未开放**：使用「设置 → 权限检查」，只为可信的专用局域网放行。不要关闭防火墙或证书验证来绕过问题。
- **构建失败并出现代理／镜像地址**：检查构建机网络和 Cargo 配置。不要关闭 TLS 校验，也不要拿旧安装包冒充本次构建结果。
- **出现部分完成或待核对状态**：停止编辑相关文件，保持两端在线，在历史中核对；不要随意删除同步目录中的 `.syncfu-stage`。
- **系统拦截未签名应用**：保留具体提示并确认来源，不要关闭 Gatekeeper 或 SmartScreen。

## 项目结构

```text
core/                 Rust 同步、策略、备份与恢复内核
src/desktop/          当前桌面业务界面
src/components/ui/    本地维护的 shadcn/Radix 组件
src/desktop/boardui/   现有业务兼容入口，委托当前组件实现
src-tauri/            Tauri 桌面入口和平台权限集成
scripts/              测试、契约生成与验收工具
docs/                 当前文档及明确标记的历史设计记录
assets/               原始品牌素材与第三方许可
```

开发约定与检查命令见 [CONTRIBUTING.md](CONTRIBUTING.md)。欢迎提交可复现的 Bug 和聚焦核心同步流程的改进建议；提交问题前请删除配对码、密钥、正文和私人路径。

## 许可与致谢

项目自有代码采用 [Apache-2.0](LICENSE)，另见 [NOTICE](NOTICE)。

当前界面采用 tauri-ui 的桌面约定、本地维护的 shadcn/ui／Radix 控件、Microsoft Fluent Emoji、Lucide、Phosphor、react-file-icon 和 Inter。详见 [当前实现说明](docs/shadcn-redesign/README.md)、[shadcn 许可证](assets/shadcn-licenses/shadcn-MIT.txt) 与 [Fluent 头像来源和内容哈希](assets/fluent-emoji/sources.json)。

BoardUI、Morphicons、EasyUI 等旧版实现的许可证和来源记录仍保留，供历史代码追溯；React Bits 仅做过评估，未复制其组件源码。构建时会收集依赖 notices 并随应用分发，各第三方组件仍遵循各自许可。

SyncFu 是独立项目，不隶属于 Syncthing 或上述素材／组件项目。
