# 文档索引

## 使用与安全

- [项目首页（中文）](../README.md) / [English overview](README.en.md)
- [双机验收与专用测试资料](acceptance/README.md)
- [Mac 验收包须知](acceptance/MAC-README-FIRST.md)
- [安全边界与漏洞报告](../SECURITY.md)
- [参与贡献与检查命令](../CONTRIBUTING.md)

## 当前实现

- [桌面界面重构与验证记录（2026-11-15）](ui-refresh/README.md)：当前正式界面的主入口，涵盖单层 macOS 工具栏、可折叠侧栏、使用总览、局域网优先配对、设备备注与任务端点。
- 当前界面截图：[任务工作台](ui-refresh/screenshots/workspace.jpg)、[深色与折叠侧栏](ui-refresh/screenshots/dark-collapsed.jpg)、[连接设备](ui-refresh/screenshots/pairing.jpg)、[新建任务](ui-refresh/screenshots/new-task.jpg)、[离线状态](ui-refresh/screenshots/offline.jpg)。截图使用测试设备与目录，不是实体双机同步记录。
- [项目变更记录](../CHANGELOG.md)：未发布功能与已知限制。

本轮记录包含 **81 项前端测试通过**、浏览器交互检查及原生 macOS WKWebView 的工具栏／侧栏视觉验证。当前打包验证为 Apple Silicon / arm64；Windows 原生窗口与实体双机 LAN 同步尚未在本轮验证。具体范围以界面重构记录为准。

## 实现基础、来源与契约

- [BoardUI 工作台基础与当时的验证范围](boardui-redesign/README.md)
- [BoardUI 组件来源与许可](boardui-redesign/sources.json)
- [EasyUI 等素材来源与许可](material-redesign/sources.json)
- [原 Logo 与原生图标指纹](boardui-redesign/logo-checkpoint.json)
- [P1 策略与权限契约](p1-contracts.md)
- [P2 桌面接线说明](p2/README.md)

验证记录具有各自的时间和源码范围。历史记录中的通过结果不自动适用于后来的提交；当前提交应以 CI 和相应验收记录为准。

## 历史设计与测量

以下文件保留迭代背景，**不代表当前正式界面，也不是当前版本的验收承诺**：

- [升级路线与原始约束](upgrade-plan.md)
- [P0 原型](prototype/README.md)、[第二版原型](prototype/v2/README.md)
- [Focus 设计方向](design-streamline/DIRECTION.md)
- [已被替代的 Material 视觉方案](material-redesign/README.md)
- [BoardUI 阶段视觉／交互证据](boardui-redesign/evidence/report.json)
- [局部性能测量](performance-streamline/README.md)

性能日志中的构建机绝对路径已在公开前脱敏；测量数值未改动。桌面原生效果、操作系统权限和实体 LAN 结果不能由浏览器夹具或回环测量代替。
