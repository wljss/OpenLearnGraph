# 架构

## 运行时边界

```text
React renderer
  → window.openLearnGraph（preload 中的窄类型 API）
  → 4 个明确的 IPC handler
  → GraphService（Zod 边界验证）
  → GraphRepository
  → SQLite（Electron userData）
```

主进程负责窗口、数据库与特权能力；preload 只桥接 `graphs.list/create/load/save`；renderer 是不可信 UI。BrowserWindow 启用 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`，拒绝任意新窗口和页面导航，并在 HTML 设置 CSP。

## SQLite 决策（ADR-001）

选择 Electron 所带 Node 运行时的官方 `node:sqlite` `DatabaseSync`，而非 `better-sqlite3`。

原因：当前开发环境 Node 24 已实际验证该模块；它使用真正的 SQLite，API 小且同步调用适合仅在主进程执行的 M1 数据量；没有第三方原生扩展，因此不需要 node-gyp、Python、MSVC、预编译二进制或 Electron ABI rebuild，Windows 打包更可靠。代价是应用要求所选 Electron 版本内置 `node:sqlite`；升级 Electron 时，打包和启动烟雾检查必须覆盖此项。

## 持久化策略（ADR-002）

M1 保存整个图谱文档，并在单个 `BEGIN IMMEDIATE` 事务中替换其节点与边。该方式简单、原子且容易验证；规模上限由 IPC schema 限定。需要细粒度历史或超大图谱时再改为增量命令，不提前引入事件溯源。

## 状态边界（ADR-003）

M1 的节点只持久化知识结构。UI 的 `AVAILABLE` 是新概念的结构性默认展示，不是 mastery，也不写入 `knowledge_nodes`。M2 将新增独立的 `learner_node_states` 与 `evidence` 表，并把状态投影到图谱读取模型。

## Windows 分发（ADR-004）

M1 使用 Forge 的 ZIP maker，并实际验证可生成和运行 Windows x64 包。曾验证 Squirrel maker，但其旧 NuGet 工具在 Electron 44 的 `dxcompiler.dll` 上失败；为了不保留一个已知会失败的发布命令，当前配置不包含 Squirrel。安装器选择、Squirrel 启动事件、图标、代码签名和 SmartScreen 信誉作为 M10 的完整发布工作一起处理。

## 代码结构

```text
src/main/database        migration 与连接
src/main/repositories    SQL 和行映射
src/main/services        应用服务与输入验证
src/main/ipc             明确 IPC 注册
src/preload              contextBridge
src/renderer             React UI
src/shared               跨进程 schema、类型和 channel 常量
tests                    契约、持久化和 renderer smoke tests
```
