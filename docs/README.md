# SyncFu 0.1.0 文档

当前项目使用统一的 SyncFu 名称、`0.1.0` 版本与 `org.syncfu.desktop` 应用标识。构建产物集中到 `releases/0.1.0/`。

## 开始使用

- [项目首页（中文）](../README.md) / [English overview](README.en.md)
- [Windows 源码包与跨平台构建](building.md)
- [双机测试与专用测试资料](testing/README.md)
- [安全边界与漏洞报告](../SECURITY.md)
- [开发约定与检查命令](../CONTRIBUTING.md)
- [0.1.0 变更记录](../CHANGELOG.md)

## 实现与来源

- [当前桌面 UI](ui/README.md)：shadcn/Radix 控件、设备头像、文件类型图标及验证范围。
- [任务工作区截图](ui/screenshots/workspace.jpg) / [深色主题截图](ui/screenshots/dark.jpg)，均为测试数据。
- [UI 来源账本](ui/sources.json)
- [Fluent Emoji 来源和许可](../assets/fluent-emoji/README.md)
- [原 Logo 与原生图标指纹](../assets/logo-checkpoint.json)
- [同步策略与权限契约](architecture/contracts.md)
- [第三方许可归属](../NOTICE)，本地许可集中在 `assets/licenses/`。

历史设计、旧阶段计划和当时的验证记录集中在仓库的 `docs/archive/`，不参与当前构建，也不进入 Windows 源码包。它们保留原始版本信息，不能当作 0.1.0 当前提交的验收结果。
