# Contributing to SyncFu

感谢你参与 SyncFu。请让每个改动聚焦一个问题，并保持文件同步的安全边界。一般问题可使用 Issue 模板；涉及漏洞时先阅读 [SECURITY.md](SECURITY.md)。

## 开始之前

- 先检查已有 Issue，较大的行为或界面变更请先说明问题、目标和兼容性影响。
- 使用独立分支和专用测试目录。不要把日常资料作为覆盖、删除或镜像测试对象。
- 不提交配对码、设备私钥、系统凭据、应用数据库、备份内容或本机工具配置。
- 保留原 SyncFu 品牌素材；UI 改造不应顺带替换 Logo。

## 开发环境

需要 Node.js **22.18+**、Rust stable 及 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
npm ci
```

```bash
npm run tauri dev
```

仅检查界面可运行 `npm run dev` 并打开 `http://localhost:1420/?desktop-test`。该开发夹具不接入真实文件系统；不要把它的结果描述为实体双机通过。

## 提交前检查

前端测试先生成生产包，再验证业务、契约和生产隔离规则：

```bash
npm test
```

```bash
cargo test --locked -p syncfu-core
```

```bash
cargo fmt --all --check
```

```bash
cargo clippy --locked -p syncfu-core --all-targets -- -D warnings
```

```bash
cargo run --locked -p syncfu-core --features bindings --example export_policy_contract -- --check
```

如果有意修改契约，请使用生成器更新 TypeScript 输出，再检查差异、补测试并评估协议兼容性；不要手工修改生成文件来掩盖漂移。

```bash
cargo run --locked -p syncfu-core --features bindings --example export_policy_contract
```

性能用例默认不跑；需要单独记录机器、构建模式、数据规模和测量条件。回环数字不是跨平台 LAN 吞吐承诺。

## 不可省略的安全边界

- 目录授权、对等身份、任务规则、管理权限和写前校验由内核权威检查，不能只依赖禁用按钮。
- 用户的一次执行必须绑定确切计划、内容指纹和所选项目；陈旧批准不得复用。
- 不为速度移除 SHA-256、no-follow／授权根约束、覆盖前备份或删除风险门禁。
- 暂停是本机否决权。恢复暂停、切换主题或重新连接不能自动恢复写入。
- 默认不勾选删除或未解决冲突。必要目录扩展、所选冲突覆盖和撤销仍需最终审阅。
- 当前自动检查只读。自动写入调度属于单独的设计和安全评审范围。

## 界面与测试约定

正式入口是 `src/desktop/`，使用 `src/desktop/boardui/` 的组件和 token。仅保留纯色浅／深主题，操作图标走 Morphicons，原 Logo 不经图标适配器处理。

行为修复应补回归用例。界面变更应检查亮暗、常用语言、窄窗口、长文件名、键盘操作、空／错误／部分结果状态；截图使用夹具并去除私人信息。记录未测试的平台，不以浏览器截图代替原生 WebView 验证。

## 验收快照

`docs/acceptance/source-manifest.json` 用于匹配两端验收源码，不是发布者签名。源码变更后，只有在准备新的验收快照并完成相应检查时才运行：

```bash
node scripts/freeze-acceptance.mjs
```

```bash
node scripts/build-acceptance.mjs windows --verify-only
```

新建快照不会让旧结果自动适用于新代码。保留结果的日期、实际验证范围和历史构建 ID，不把未运行的检查改为通过。

## Pull Request

请说明解决的问题、改动范围、验证命令和未测试部分。涉及用户界面时附脱敏截图；涉及同步、权限、删除或恢复时列出故障／中断场景。

尽量保持提交小而清晰，不混入无关格式化、依赖大升级或生成产物。采用 `feat:`、`fix:`、`docs:`、`test:` 等明确的提交前缀即可。讨论应围绕行为和证据，保持尊重。

提交贡献意味着你有权提交相应内容，并同意项目 [Apache-2.0](LICENSE) 许可；第三方来源必须保留各自许可与归属。
