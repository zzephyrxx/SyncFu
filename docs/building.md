# 构建 SyncFu 0.1.0

所有平台使用相同的产品名 **SyncFu**、版本 **0.1.0** 和应用标识 `org.syncfu.desktop`。在目标操作系统上构建；Windows 源码 ZIP 不含已编译的 Windows 安装器。

## Windows 环境

建议在 Windows 10 22H2／Windows 11 x64 的本地磁盘目录构建，例如 `C:\dev\SyncFu-0.1.0`。

| 依赖 | 要求 |
| --- | --- |
| Node.js 与 npm | [Node.js](https://nodejs.org/) 22.18 或以上；npm 随安装包提供 |
| Rust | [Rust stable](https://www.rust-lang.org/tools/install)，选择 `x86_64-pc-windows-msvc` 工具链 |
| C++ 工具链 | Microsoft C++ Build Tools，勾选“使用 C++ 的桌面开发”，包含 MSVC x64/x86 工具和 Windows SDK |
| WebView2 | Microsoft Edge WebView2 Runtime；系统已有时可复用 |
| 网络 | 首次获取 npm/Cargo 依赖及安装器工具时需要联网 |

C++ Build Tools、WebView2 和 Rust MSVC 的安装要求参见 [Tauri 官方 Windows 前置条件](https://v2.tauri.app/start/prerequisites/#windows)。本项目生成 NSIS `.exe`，不需要为 MSI 单独配置 VBScript。

安装后重新打开终端，检查：

```powershell
node --version
npm --version
rustc --version
cargo --version
rustup show active-toolchain
```

源码包不要求安装 Git，也不包含 `node_modules`、Cargo 缓存、构建输出或本机应用数据。

## Windows：从源码包构建

1. 将 `SyncFu-0.1.0-windows-source.zip` 完整解压到一个新目录，进入包内 `SyncFu-0.1.0`，不要覆盖到旧源码上。
2. 如同时拿到外部校验值，可先检查 ZIP：

```powershell
Get-FileHash .\SyncFu-0.1.0-windows-source.zip -Algorithm SHA256
```

3. 在解压后的源码根目录校验包内文件：

```powershell
node scripts/build.mjs windows --verify-only
```

4. 双击根目录的 **Build-Windows.cmd**，或执行：

```powershell
node scripts/build.mjs windows
```

构建脚本依次检查源码与版本、安装锁定依赖、运行测试与契约检查、编译桌面应用并生成 NSIS 安装器。任一步失败即停止，不使用旧安装包替代本次结果。默认安装器复用已有 WebView2，缺失时联网下载。

最终安装包：

```text
releases/0.1.0/SyncFu-0.1.0-windows-x64-setup.exe
```

Tauri 原始安装器保留在 `target/x86_64-pc-windows-msvc/release/bundle/nsis/`。

目标电脑无法联网安装 WebView2 时，可在**联网构建机**上生成包含离线运行时的较大安装器：

```powershell
node scripts/build.mjs windows --offline-runtime
```

`--offline-runtime` 只改变 WebView2 分发方式，不让首次源码编译变成离线构建。

## macOS

安装 Node.js 22.18+、Rust stable 和 Xcode Command Line Tools。在源码根目录执行：

```bash
node scripts/build.mjs macos
```

使用当前 Mac 架构，输出到 `releases/0.1.0/`：

- Apple Silicon：`SyncFu-0.1.0-macos-arm64.zip`
- Intel：`SyncFu-0.1.0-macos-x64.zip`

原始应用位于 `target/<Rust 目标>/release/bundle/macos/SyncFu.app`；Apple Silicon 的目标为 `aarch64-apple-darwin`，Intel 为 `x86_64-apple-darwin`。构建使用 macOS 原生标题栏配置。脚本的本地 ad-hoc 签名用于校验包完整性，不是 Developer ID 签名或 Apple 公证。

## 生成 Windows 源码包

在开发仓库根目录执行：

```bash
node scripts/package-source.mjs
```

输出 `releases/0.1.0/SyncFu-0.1.0-windows-source.zip`，包内顶层目录为 `SyncFu-0.1.0/`。源码、锁文件、构建脚本、测试、当前文档、素材和许可均在包内；`.git`、依赖缓存、应用状态、历史文档和本机产物不进入包。

包内 `source-manifest.json` 记录文件 SHA-256，解压后可通过 `--verify-only` 核对。校验只能证明文件与清单一致，不能替代来源认证。普通开发 checkout 没有该清单时，构建工具仍检查版本一致性；固定源码包中的文件不应直接编辑后继续使用原清单。

## 排查构建问题

- 找不到 `node`、`npm` 或 `cargo`：安装对应依赖，并重新打开终端。
- MSVC／链接器／SDK 错误：检查 C++ 桌面开发组件和 MSVC Rust 工具链。
- 代理、镜像或下载失败：检查本机网络和 Cargo/npm 配置；脚本不会修改全局代理或关闭 TLS 验证。
- 源码指纹不匹配：重新完整解压同一个包；开发改动应在 Git checkout 中进行并重新打包。

构建成功只说明安装器／应用已产生。安装后的设备发现、系统权限、配对与实际文件同步，请按 [双机测试指南](testing/README.md) 分别核对。
