# 文档索引

## 使用与安全

- [项目首页（中文）](../README.md) / [English overview](README.en.md)
- [双机验收与专用测试资料](acceptance/README.md)
- [Mac 验收包须知](acceptance/MAC-README-FIRST.md)
- [安全边界与漏洞报告](../SECURITY.md)
- [参与贡献与检查命令](../CONTRIBUTING.md)

## 当前实现

- [tauri-ui／shadcn 桌面重构说明](shadcn-redesign/README.md)：当前界面实现入口，说明保留现有 Tauri 应用、适配桌面约定，以及本地 shadcn/Radix 控件的使用范围。
- 当前界面截图：[任务工作台](shadcn-redesign/screenshots/workspace.jpg)、[深色主题](shadcn-redesign/screenshots/dark.jpg)。截图使用测试设备与目录，不是实体双机同步记录。
- 当前图标分工：Fluent Emoji 设备头像、Lucide 类型与操作／彩色任务文件夹、Phosphor 状态圆点、react-file-icon 文件类型；冲突使用明确的红色警示。
- [项目变更记录](../CHANGELOG.md)：未发布功能与已知限制。

本轮验证范围以当前界面说明和对应提交的 CI 为准。旧版测试数量与原生构建记录不会自动继承为本轮结果；Windows 原生窗口与实体双机 LAN 同步仍需单独验收。

## 实现基础、来源与契约

- [shadcn 本地组件许可证](../assets/shadcn-licenses/shadcn-MIT.txt)
- [Fluent Emoji 头像来源、内容哈希与许可](../assets/fluent-emoji/README.md)
- [Lucide 许可](../assets/boardui-licenses/Lucide-ISC.txt) / [Phosphor 许可](../assets/streamline/LICENSE-Phosphor.txt)
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
- [BoardUI 工作台基础与当时的验证范围](boardui-redesign/README.md)
- [BoardUI 组件来源与许可](boardui-redesign/sources.json)、[EasyUI 等历史素材来源](material-redesign/sources.json)
- [BoardUI 阶段视觉／交互证据](boardui-redesign/evidence/report.json)
- [上一轮桌面 UI 重构与原生预览记录](ui-refresh/README.md)
- [局部性能测量](performance-streamline/README.md)

性能日志中的构建机绝对路径已在公开前脱敏；测量数值未改动。桌面原生效果、操作系统权限和实体 LAN 结果不能由浏览器夹具或回环测量代替。
