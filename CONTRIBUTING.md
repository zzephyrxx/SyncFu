# Contributing to SyncFu 0.1.0

请让改动聚焦一个问题，并保持文件同步的安全边界。一般问题使用 Issue 模板；涉及漏洞时先阅读 [SECURITY.md](SECURITY.md)。

## 开发环境

需要 Node.js **22.18+**、Rust stable 及 [Tauri 平台依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
npm ci
npm run tauri dev
```

界面夹具：运行 `npm run dev` 并打开 `http://localhost:1420/?desktop-test`。它不接入真实同步目录，不能代替实体双机测试。

完整构建与 Windows 源码包流程见 [构建指南](docs/building.md)。统一版本源为 `package.json`；Rust 包、锁文件根包和 Tauri 配置必须保持一致，构建工具会检查。

## 提交前检查

```bash
npm test
cargo fmt --all --check
cargo test --locked -p syncfu-core
cargo clippy --locked -p syncfu-core --all-targets -- -D warnings
cargo run --locked -p syncfu-core --features bindings --example export_policy_contract -- --check
```

有意修改协议契约时，使用生成器更新 TypeScript 输出，并评估兼容性：

```bash
cargo run --locked -p syncfu-core --features bindings --example export_policy_contract
```

不要手工修改生成文件来掩盖漂移。性能用例应单独记录机器、数据规模与测量条件；回环测量不是跨平台 LAN 吞吐承诺。

## 界面约定

正式界面位于 `src/desktop/`，共享控件位于 `src/components/ui/`，业务组件适配层位于 `src/desktop/ui/`。采用 shadcn/Radix，操作与设备类型图标使用 Lucide，设备头像使用 Fluent Emoji，状态圆点使用 Phosphor，文件类型使用 react-file-icon。保留原 SyncFu Logo 和第三方来源记录。

界面变更检查浅深主题、常用语言、窄窗口、长文件名、键盘、空状态和错误状态。截图使用测试数据，说明未测试的平台。仅为有意义的行为回归补测试，避免只验证实现细节。

## 数据与操作边界

- 使用专用测试目录；不要用日常资料测试覆盖、删除或镜像。
- 目录授权、对等身份、任务规则、管理权限和写前校验由内核检查。
- 一次执行必须绑定确切计划、内容指纹和选择，陈旧批准不可复用。
- 保留 SHA-256、授权根约束、覆盖前备份、删除风险门禁和后续编辑保护。
- 暂停是本机否决权；恢复暂停、切换主题或重连不应自动写入。
- 默认不选删除和未解决冲突；必要目录扩展、冲突覆盖和撤销仍需审阅。
- 不提交配对码、私钥、系统凭据、应用数据库、备份内容或本机代理／工具设置。

## 源码包与目录

```bash
node scripts/package-source.mjs
```

该命令从明确的源码目录清单生成 `releases/0.1.0/SyncFu-0.1.0-windows-source.zip`，附带包内源码 SHA-256 清单。解压后可运行 `node scripts/build.mjs windows --verify-only` 检查完整性；这不是编译测试或发布者签名。

源码包是固定快照。开发请使用 Git checkout；修改源码包中的文件会使其校验失败，应从修改后的开发仓库重新打包。

`releases/`、`target/`、`dist/` 和 `node_modules/` 均为本机构建输出，不提交。历史文档只保留在 `docs/archive/`，新增说明放入现有构建、测试或 UI 文档，不再创建按迭代名称区分的发布目录。

## Pull Request

说明问题、最终行为、验证命令与未测试部分。涉及界面时附脱敏截图；涉及同步、删除或恢复时说明故障与中断场景。采用 `feat:`、`fix:`、`docs:`、`test:` 等明确提交前缀。

提交贡献意味着你有权提交相应内容，并同意项目 [Apache-2.0](LICENSE) 许可；第三方来源必须保留许可与归属。
