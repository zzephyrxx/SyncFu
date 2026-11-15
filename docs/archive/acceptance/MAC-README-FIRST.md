# SyncFu Acceptance — Mac

这是独立验收版，不是正常版更新安装器。

- 应用：`SyncFu Acceptance.app`
- 标识：`org.syncfu.acceptance.p2`
- 版本：`0.2.0-board.1`
- 协议：4（两端均须升级）；schema 3。沿用旧 P2 专用验收身份，可能保留旧验收任务，不能与正常版数据混淆。
- 架构：Apple Silicon + Intel
- 签名：本地 ad-hoc 完整性签名；没有 Developer ID/Apple 公证

## 先做这些

1. 从托盘/菜单栏退出旧 SyncFu，不能只关窗口。
2. 打开本包里的 **SyncFu Acceptance.app**。系统若阻止打开，先反馈具体提示，不要关闭系统安全功能。
3. 新实例不应出现你正常版的旧设备、任务或历史；若出现，立刻停止，不授权、不同步。
4. 设置 → 安全与备份：备份路径应包含 `org.syncfu.acceptance.p2`，不应是 `org.syncfu.desktop`。
5. 第一轮先只核验启动，不要自行继续删除/镜像操作。

本包的 `test-data/mac` 是预生成测试资料，只有 `01-bidirectional`、`02-one-way-update`、`03-mirror`、`04-shared` 四个专用目录。后续授权时只选具体用例目录，**不要授权整个桌面、文档或源码项目**。

可在本包根目录终端校验初始资料：

```bash
node tools/acceptance-data.mjs check --root test-data/mac --stage initial
```

报告保存在 `test-data/mac/reports`；仅含相对路径、大小和 SHA-256，不含正文/密钥。

完整逐轮步骤见 `ACCEPTANCE.md`。配对码只在两台设备之间输入，不要发到聊天里。结果截图中的用户名/IP 可以打码。

**当前包已通过构建与完整性检查，不代表应用启动、系统授权或实体双机同步已验收。**
