# SyncFu 0.1.0 双机测试

使用同一份 0.1.0 源码分别构建 Windows 和 macOS，两端均打开 **SyncFu**。应用标识统一为 `org.syncfu.desktop`，协议为 **4**、状态 schema 为 **3**。构建方法见 [构建指南](../building.md)。

本指南定义测试过程和预期，不表示实体双机测试已经通过。普通 SyncFu 配对、任务和设置可能保留；此次测试仅新增专用测试目录和任务，不清空已有应用数据。

## 准备

1. 两台电脑接入可互通的 IPv4 局域网，退出旧 SyncFu 进程。仅关闭窗口可能仍留在托盘／菜单栏；两端默认使用 TCP `47657`。
2. 确认两端是同一份源码包或同一 Git 提交。源码包可在各自平台运行 `node scripts/build.mjs windows --verify-only` 或 `node scripts/build.mjs macos --verify-only` 核对。
3. 在源码根目录创建新的测试资料目录，命令拒绝覆盖已存在的目录：

```bash
# 在 Mac 执行
node scripts/test-data.mjs init --side mac --root test-data/mac

# 在 Windows 执行
node scripts/test-data.mjs init --side windows --root test-data/windows
```

两端初始报告均应为 `pass: true`。测试工具只操作显式指定的测试根目录；不将整个源码、桌面、文档或日常资料目录授权给测试任务。

## 连接与授权

1. Windows 进入「设备 → 连接设备 → 等待连接」。Mac 发起连接，选择扫描到的 Windows，并输入它显示的五位配对码。自动发现不可用时才使用 IP 备用入口。
2. Windows 确认请求，等到两端均显示连接就绪。
3. 两端分别授权各自测试根目录中的 `01-bidirectional`，建立“这是我自己的设备／双向”任务，并在对端确认首次关系。
4. 核对两端设备、目录、规则一致且没有待确认的策略，再开始文件操作。

## 测试项目

| 项目 | 操作 | 预期 |
| --- | --- | --- |
| 双向普通变化 | 暂不处理 `conflict.txt`，同步默认新增／更新 | 普通文件互补、中文路径正确；冲突保持各自版本 |
| 冲突选择 | 比较 `conflict.txt`，选择 Mac 版本并同步 | 两端文件与 Mac 原版相同，并有操作历史／备份 |
| 单向更新 | 关联 `02-one-way-update`，Mac 为源端 | `master.txt` 更新、`new/deep.txt` 到达；Windows 独有文件保留且不反传 |
| 镜像预检 | 关联 `03-mirror`，Mac 为源端 | Windows 的 103 个额外文件触发删除保护；批准前无写入 |
| 镜像执行 | 核对并批准该次清单 | Windows 仅剩 `keep.txt`；内部 `.syncfu-stage` 除外 |
| 撤销镜像 | 从历史预览并撤销刚才的批次 | 103 个文件的原始字节及目录恢复，保护后续编辑 |
| 共享与暂停 | `04-shared` 使用 Mac 管理的单向共享 | Windows 不能更改方向或越权批准；本机暂停阻断远端写入 |
| 后续编辑／中断 | 另行准备并记录步骤 | 陈旧批准不能覆盖后续编辑；中断需核对，不假报全部成功 |

镜像计划可能包含 104 项操作：103 个文件和 1 个必要目录。应以最终预检清单为准。

## 内容校验

每项操作后在两端分别执行，替换根目录和阶段：

```bash
node scripts/test-data.mjs check --root test-data/mac --stage bidirectional-unresolved
node scripts/test-data.mjs check --root test-data/windows --stage bidirectional-unresolved
```

| 阶段 | 检查内容 |
| --- | --- |
| `initial` | 四个目录的初始资料 |
| `bidirectional-unresolved` | 普通项同步、冲突各自保留 |
| `bidirectional-resolved-mac` | 冲突采用 Mac 原版 |
| `one-way-updated` | 接收端独有文件仍保留 |
| `mirror-cleared` | 镜像清理完成 |
| `mirror-restored` | 撤销后原字节恢复 |
| `shared-synced` | 共享文件到达接收端 |

保留中间状态可将 `check` 换为 `snapshot`，不传 `--stage`。报告写入测试根下的 `reports/`，只含相对路径、大小、指纹和差异，不包含文件正文或凭据。工具忽略 `.syncfu-stage` 和系统元文件；不要手动清理应用内部暂存目录。

## 记录结果

分别记录操作系统、源码清单／提交、两端状态、操作步骤及内容校验结果。配对码、私钥和系统凭据不进入报告，截图中的私人路径可打码。

- 对话框成功但内容指纹不符，记为失败。
- 一端完成而另一端未核对，记为部分完成。
- 未实际运行的项目记为未测试。
- 出错时保留目录、历史与报告，记录错误和最后一步；不要通过清空应用数据掩盖问题。

0.1.0 不执行自动写入调度。浏览器夹具、回环测试、源码校验和成功构建都不能代替这里的实体双机结果。
