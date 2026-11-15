# SyncFu Material：铸瓷 / 流光

2026-11-14，经用户批准后实施。此版取代 Focus 双槽外观，保留原同步引擎与保护；不是只给旧页面换色。

## 实现范围

- 整套桌面独立加载 `design-system/index.css`，不再加载 P0 的 prototype.css 或旧 Focus desktop.css。
- 铸瓷：相反光源的凸起/内凹阴影、实体导航、内凹文件工作面。
- 流光：Solid Glass 分层表面/rim/contact/lift，半透明文件夹、共享选中块及液态轮廓开关。
- 材质和 light/dark/system 是两个独立偏好；旧偏好缺 material 时默认为 liquid，语言/密度/其他设置不丢失。
- EasyUI 文件夹由背壳/标签/叠页/铰链前盖组成，接真实任务打开回调；没有缩略图接口就不伪造用户内容。
- 点阵状态屏改造 Caffeine Day 的分级绘制，只表现阶段/已有计数；不虚构速度，不在闲置/隐藏时保持绘制循环。
- 任务集合、详情、冲突、最终审阅、设备/授权/配对、历史、设置、真实统计和换机检查统一覆盖。
- 保留五语言、新手模式、插图开关、减少动效、目录/共享权限、风险批准和受保护撤销。

## 来源与许可

[精确来源清单](sources.json)记录17个固定版本文件、SHA-256、改造去向和说明；完整许可证在 `assets/material-licenses`，也随发行包收集。

- [Solid Glass](https://github.com/deeplethe/solid-glass)：MIT，材质与工作区/Panel组合。
- [EasyUI](https://github.com/Surajmaurya1/easyui)：MIT，文件夹、共享选中块、按压与液态轮廓。
- [Caffeine Day](https://github.com/charles-postiaux/caffeine-day)：MIT，点阵绘制；没有导入咖啡因模型或URL状态。
- [Neumorphism](https://github.com/adamgiebl/neumorphism)：BSD-3-Clause，凹凸成对阴影参考，不引入生成器。
- [shadcn/ui](https://github.com/shadcn-ui/ui)：MIT，Radix Sheet结构与已有Radix primitives衔接。
- [Transmit 5](https://panic.com/transmit/)：仅布局/工作流参考，不复制专有代码/素材。

21st Glass Folder Cards的安装需要API key；未绕过访问限制。实际文件夹代码来自公开的EasyUI，不冒称已获得21st组件源码。

## 工程边界

Tailwind4仅用于构建按需源码组件，不加载preflight覆盖旧原型。没有引入Base UI、第二份framer-motion、22套字体、整套演示依赖或远程CDN。Rust core相对上版20个清单文件均无变化，协议仍4/schema3。Windows仍默认轻量WebView2 bootstrapper。

流光是跨平台CSS材质与柔性轮廓，不宣称物理级光线折射。无backdrop或减少透明度时，同时替换填充和模糊，不能只停blur。真实原生WKWebView/Windows外观测试仍须与Chromium预览分开记录。

## 验证记录

已跑：67项core正确性测试（3项性能用例默认忽略）、60项前端/契约/资料/材质测试、TypeScript/Vite、Rust格式与Clippy。浏览器行为与截图见 `evidence/`；最终打包数据见交付目录 `ARTIFACTS.json`。

关键交互实测包括材质切换保持已选文件和prepared确认、无额外inspect/execute、普通方向直改/镜像确认、冲突选择、只读预检、真实结果/历史及撤销上下文。旧Focus与旧P0截图不作为此版证据。

发布界面仍需用户评价是否符合审美；构建/截图通过不等于实体双机验收通过。Windows构建体积、原生窗口、真实LAN验证未完成的项目不能标成PASS。
