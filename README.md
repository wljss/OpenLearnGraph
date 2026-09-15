# OpenLearnGraph

OpenLearnGraph 是一个本地优先、以知识图谱为核心的 Windows 桌面学习应用。当前版本完成 M0（工程与架构基础）、M1（手工知识图谱）和 M2（学习状态与证据）：可构建学习路径、记录学习与自评证据，并根据先修关系投影出可解释的学习状态。

## 环境要求

- Windows 10/11
- Node.js 24+
- npm 11+

无需 Python、Conda、PostgreSQL、Docker 或 Visual Studio Build Tools。SQLite 使用 Electron/Node 自带的 `node:sqlite`。

## 开发

PowerShell 的执行策略可能阻止 `npm.ps1`；此时使用：

```powershell
npm.cmd install
npm.cmd start
```

在 cmd.exe、Git Bash 或未限制脚本的 PowerShell 中可将 `npm.cmd` 换成 `npm`。

若所在网络无法连接 Electron 默认二进制下载端点，可仅对本次安装指定镜像：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm.cmd install
```

## 质量检查

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run check
```

## 打包

```powershell
npm.cmd run package
npm.cmd run make
```

`package` 生成可直接运行的应用目录；`make` 在 `out/make/zip` 下生成 Windows ZIP 分发包。M1 尚不承诺安装程序；带签名的 `OpenLearnGraph-Setup.exe` 属于 M10 发布工作。当前构建未代码签名，Windows SmartScreen 可能提示未知发布者。

## 使用

1. 在左侧输入名称并创建图谱。
2. 点击“添加概念”；新概念会自动选中并聚焦名称输入框，可直接输入名称和描述。
3. 拖动节点改变布局；从一个节点右侧连接点拖到另一个节点左侧连接点，表示“前者是后者的先修概念”。
4. 选中边后点击画布上方的删除操作，或按 Delete；选中节点可在右侧删除。
5. 点击“保存更改”或按 `Ctrl+S`。重启应用后会从 SQLite 恢复图谱。
6. 有未保存更改时，切换/新建图谱、删除概念和退出应用都会给出明确提示或确认。
7. 选中已保存的概念后，可以点击“开始学习”，或用 1–5 分记录一次带备注的自评。
8. 4–5 分自评会产生“已掌握”状态；未掌握先修概念的节点会保持锁定，掌握后自动解锁。
9. 每次学习操作都会立即写入本机证据时间线；状态旁会说明其形成原因。

## 数据位置与安全

数据库存放于 Electron 的 `userData` 目录（Windows 通常位于 `%APPDATA%/OpenLearnGraph/openlearngraph.sqlite3`），不写入源码目录。渲染器启用上下文隔离、禁用 Node 集成并启用 sandbox；只有 preload 明确暴露的图谱、学习证据操作与未保存状态通知可以跨 IPC 调用，主进程使用 Zod 验证所有输入。

学习状态不写入知识节点。原始证据保存在 `learning_evidence`，独立投影缓存在 `learner_node_states`；图谱保存使用保留节点身份的更新策略，因此编辑节点名称或位置不会清空学习历史。

更多设计说明见 [架构](docs/ARCHITECTURE.md)、[数据模型](docs/DATA_MODEL.md)、[产品规格](docs/PRODUCT_SPEC.md)和[路线图](docs/ROADMAP.md)。
