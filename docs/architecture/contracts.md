# P1 契约、安全边界与验收

> 这是保留的 P1 阶段历史契约记录；下文的版本与测试数字不代表当前实现。SyncFu 0.1.0 当前使用对等协议 **5**、状态 schema **3**，概览见[当前文档](../README.md)，回归要求见[双机测试指南](../testing/README.md)。不要将本文历史版本 2 与当前客户端混用。

## 状态与范围

P1 已实现后端策略与执行安全基础。P0 第二版保持隔离演示；**P2 的新界面接线/冲突决策、P3 的自动调度尚未实现**。不能把原型的自动开关当成真正的后台同步。

本次是在用户确认“其他模型修改后已回滚”后，重新比对源码快照并复验的当前版本；没有整包恢复其他模型的 P2 文件。原有文件无缺失，P1 相关新增文件、契约和测试已在此基础上重新补齐。

## 权威来源与生成

- Rust Serde DTO：`core/src/policy.rs`、`core/src/risk.rs`。
- 对等节点帧协议：`core/src/node.rs::PROTOCOL = 2`。
- SQLite 策略 schema：`SCHEMA_VERSION = 2`。
- 生成的前端类型：`src/generated/policy.ts`。
- 真实 Rust 序列化夹具：`src/generated/policy-fixtures.ts`。
- Typed desktop facade：`src/policy-api.ts`，**原型不导入它**。

生成工具是可选 `bindings` feature，普通应用运行不需要 ts-rs。

```bash
cargo run --locked -p syncfu-core --features bindings --example export_policy_contract
```

```bash
cargo run --locked -p syncfu-core --features bindings --example export_policy_contract -- --check
```

`--check` 只比较、不重写文件；生成器仅接受已知项目内输出路径。ts-rs 会提示无法表达 `deny_unknown_fields`：这是 TypeScript 描述的限制，Rust Serde 的实际未知字段拒绝仍保留，未为了消除提示去放宽服务端。

## 桌面命令

Tauri invoke 参数使用 camelCase；序列化 DTO 字段遵循生成类型中的 snake_case。设备、任务、grant、proposal、摘要均为字符串，不转换成数字。policy revision 为 u32，生成后的 JS number 可精确表示。

| 命令 | 请求 | 返回 |
|---|---|---|
| `task_policy` | task | PolicyView（current/pending/receipt、本机暂停） |
| `propose_task_policy` | task, expectedRevision, next | PolicyState |
| `answer_task_policy` | task, proposal, accept | PolicyState |
| `reconcile_task_policy` | task | PolicyState |
| `pause_task` | task, paused | void |
| `pause_all` | paused | void |
| `preview_execution` | plan, digest, selected | ExecutionPreview（双端风险、选择摘要） |
| `execute_plan` | plan, digest, selected, approveRisk? | Batch；approveRisk 默认 false |

命令错误沿用现有字符串错误边界。协商状态/风险返回结构化 DTO，P2 不应靠解析错误文案判断状态。空 pending/last_receipt 明确序列化为 null。调用成功不必然表示提案已生效：必须检查 pending 是否清除、双方 current 是否一致。

## 策略语义

| 方向 | 允许的变更 |
|---|---|
| `bidirectional` | 沿用共同基线识别双端变化；普通冲突仍等待 P2 明确取舍 |
| `one_way_update` | 固定 source → receiver 的新增/更新；保留接收端额外文件，不传播删除 |
| `one_way_mirror` | 固定 source → receiver，包括接收端额外项删除；受风险门槛约束 |

source 使用稳定设备 ID，不是本机索引或配对发起端。结构冲突、排除子树及跨平台路径限制继续生效。被排除内容的父目录也不得被镜像清理误删。

- `unclassified`：旧任务与旧创建 API 的保守状态，只能 manual/bidirectional；不是隐式 personal。
- `personal`：双方首次确认后，两端均可管理。
- `shared`：只有 owner 可改规则或批准高风险；其他端仍可按已批准方向执行/拉取，且始终能本地暂停。
- `on_change` 是持久化的配置意图；P1 返回 `automatic_supported=false` 并拒绝 automatic-origin 工作，不启动调度器。
- `prefer_device` 仅建立规则契约，不在 P1 擅自把双向冲突自动覆盖。单向规则不允许优先接收端反写。

## 协商与冲突恢复

策略采用递增版本、持久化提案与提交/拒绝 receipt。首次信任分类/信任变化需对端明确答复；已有 personal 的普通规则变化，以及同一 shared owner 的规则变化可依据既有授权自动应答。

提交后仍保留 pending，直到确认双方 current 已提交。断线或 ACK 丢失可通过 `reconcile_task_policy` 幂等补交；不能凭对端声称的“本端已同意”补造丢失的本地同意。已接受但中断的提案不能离线随意撤销。

同时修改同一版本时，只在尚未提交的预留阶段按 `(proposer ID, proposal ID)` 取得一致的预留顺序；已提交版本绝不覆盖。这不是“最后写入胜出”，并避免双方各持一个提案永久卡死。信任变化仍需新提案的明确本地同意。

重复 Link 不重写路径/标签/策略；同一个 grant 不能通过另一个 remote ID 建立影子任务绕过单向权限。

## 写入授权与删除批准

- Plan 绑定策略 stamp 与两端内容证明；Work 绑定完整 planned 清单、明确选择、基线、内容证明及规范化设备目标。
- 两端分别预检，Begin 再验。检查后目录/基线/策略改变，旧预览失效。双向任务中目标端也偏离共同基线时，不能把冲突伪装成普通更新；P2 需通过明确取舍路径处理。
- 真实 Seal/Apply 核对已存储批准记录及不可变摘要，不能拿“同一批次 ID”搭配修改后的路径或载荷。
- 大量删除在选择/拆分前看完整清单，再叠加每任务本端累计窗口；按实际 before/after 判断删除，不相信 action 标签。
- 默认 100 项，或至少 10 项且达到起始文件数 20%；源突然为空另触发保护。
- 10 分钟累计、固定基数与 batch 预留跨重启保存；失败尝试可能保守占预算，不能被连续 9 项批次或重放清零。
- 明确批准仅由 manager 发起，双方本地保存绑定 batch/内容/策略、5 分钟有效的 permit，随 Begin 原子消费；接收者不能仅把 body.owner 填成管理者来取得批准。
- 批准不是删除后的整批事务回滚。现有单项原子应用、备份、部分完成核对继续承担恢复职责。

## 本机暂停

本机 task/all 暂停是独立安全否决，不在远端策略里。没有远程“替对方解除暂停”的命令。

Begin 准入与本机暂停使用同一小临界区；暂停不等待整批写入的大 gate。已进入的单项安全结束后停止后续项。停止标记持久化，重启或解除暂停不重新授权旧批次，需先核对并重新检查。已有完成项可准确记录为 partial，而非全部成功。

## 迁移与回退

- 首次迁移旧 records 前用 `VACUUM INTO` 创建包含已提交 WAL 的一致性快照，位置为状态目录下 `migrations/before-policy-<uuid>.sqlite3`。
- 旧 Task/历史/备份原样保留，策略以独立记录初始化为 unclassified/manual/bidirectional。未知更高 schema、损坏策略均失败关闭，不静默换成宽松默认。
- 旧 active Work 缺 authorization 可以只读核对并保护性恢复已经移走的原件；不可继续新版写入。未完成批次期间禁止改策略。
- 两端必须使用同一协议 2 构建。旧协议 1 明确拒绝；本轮未发布安装包。
- 无新版写入时，可在完全停止应用后按记录恢复迁移快照与旧程序；**有新写入后不能只恢复旧数据库**，那不会回滚实际文件，需核对或受保护撤销。
- 旧程序不理解新策略，不得直接复用升级后的状态库。没有自动执行回退，也没有在用户实际状态目录演练迁移。

## 本轮证据与未验证项

- 内核常规测试：52 项通过，默认跳过 1 项性能样本；该性能样本又单独运行通过。
- 10,001 文件 debug 回环样本：首次扫描约 1.35s，无变化约 1.46s，1% 变化检查约 1.47s，所选同步约 7.26s，总用例约 13.29s。仅为本机样本，不是跨设备吞吐量或相对旧版加速证明。
- 严格 Clippy、Rustfmt、生成契约 `--check`、macOS 桌面 `cargo check` 通过。
- 前端/契约测试 31 项通过，TypeScript/Vite 构建通过。
- CI 已增加契约漂移和回归检查；未推送，不能声称远端 CI 已通过。
- **未验证**：真实 Windows 构建/双机、实际应用数据库升级、真实 WebView invoke 流程及安装包。编译和回环测试不替代这些。
- P0 仍是独立演示；下一阶段 P2 才把新界面安全接到这些命令。
