# 架构

## 运行时边界

```text
React renderer
  → window.openLearnGraph（preload 中的窄类型 API）
  → 明确命名的 graph / learning / session / assessment / tutor / lifecycle IPC
  → GraphService / LearningService / SessionService / AssessmentService / TutorService（Zod 边界验证）
  → GraphRepository / LearningRepository / SessionRepository / AssessmentRepository / TutorRepository
  → SQLite（Electron userData）
```

主进程负责窗口、数据库与特权能力；preload 只桥接明确的图谱、学习证据、学习会话、诊断、学习建议与生命周期操作；renderer 是不可信 UI。BrowserWindow 启用 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`，拒绝任意新窗口和页面导航，并在 HTML 设置 CSP。

## SQLite 决策（ADR-001）

选择 Electron 所带 Node 运行时的官方 `node:sqlite` `DatabaseSync`，而非 `better-sqlite3`。

原因：当前开发环境 Node 24 已实际验证该模块；它使用真正的 SQLite，API 小且同步调用适合仅在主进程执行的 M1 数据量；没有第三方原生扩展，因此不需要 node-gyp、Python、MSVC、预编译二进制或 Electron ABI rebuild，Windows 打包更可靠。代价是应用要求所选 Electron 版本内置 `node:sqlite`；升级 Electron 时，打包和启动烟雾检查必须覆盖此项。

## 持久化策略（ADR-002）

图谱仍以完整文档作为保存输入，并在单个 `BEGIN IMMEDIATE` 事务中写入；但 M2 起节点使用保留 ID 的 upsert，只删除用户真正移除的节点，避免普通结构编辑触发学习证据的级联删除。边按当前文档替换，规模上限由 IPC schema 限定。

## 状态边界（ADR-003）

知识节点只持久化知识结构。M2 将原始学习事件追加到 `learning_evidence`，并在同一事务中更新独立的 `learner_node_states` 投影缓存。读取图谱时，应用结合学习阶段和先修关系确定节点状态：已掌握优先；否则未完成先修会锁定节点；其余节点根据证据显示为学习中或可学习。每个状态都返回可读原因。

没有客观诊断时，`MASTERED` 可由最近一次 4–5 分自评证据产生，并在界面明确标注为自评结论。M3 起，诊断为每个参与概念产生一条带答对数和题目数的 `DIAGNOSTIC_RESULT`；达到 80% 投影为 `MASTERED`，否则投影为 `LEARNING`。最近一次客观诊断优先于之后的自评，重新诊断才会替换客观结论。掌握度始终不写入 `knowledge_nodes`。

## 诊断一致性（ADR-005）

诊断开始时在单个事务中创建 attempt，并复制题目、概念名、解析和选项为快照。renderer 只收到没有正确性标记的选项；评分在 main repository 内依据快照完成。每次选择通过窄 IPC 校验后 upsert 为草稿响应，以支持崩溃/重启恢复；恢复接口只返回所选选项，不返回 `is_correct`。提交在另一个事务中原子 upsert 全部响应、客观 Evidence、learner state 和完成状态。这样题库在诊断期间被修改或删除也不会改变本次评分依据，重复提交和跨题选项会被拒绝。

同一图谱存在 `IN_PROGRESS` 尝试时不能开始另一场诊断，必须先继续或取消，避免并行尝试产生含糊的客观状态。诊断范围由经过 Zod 校验且属于当前图谱、题量合格的节点 ID 集合显式指定；历史列表最多返回最近 100 条，已完成结果始终从不可变快照和响应重建。

## 学习决策边界（ADR-006）

M4A 的 `TutorService` 读取 GraphRepository 投影后的知识与学习状态，并结合题库覆盖和活动诊断生成固定动作空间内的建议。纯函数策略按“继续未完成诊断 → 补强失败诊断 → 评估/练习学习中概念 → 学习已解锁概念 → 回顾已掌握图谱”的顺序决策，且不会把锁定概念作为学习目标。

建议按图谱语义状态生成 SHA-256 指纹。相同状态复用已有决策；状态变化时旧决策只标记失效，保留原始理由、依据和用户响应。renderer 必须先通过受校验的 IPC 记录用户响应，再导航到概念或诊断中心。决策本身和采纳行为均不能写 Evidence 或 learner state，因而维持 `decision → user-confirmed execution → Evidence → projection` 的单向边界。

## 学习会话一致性（ADR-007）

M5A 的 `SessionService` 只允许为已解锁、未掌握且具有已保存描述的概念开始 `TEACH / ADVANCE` 会话。开始时复制概念名称、描述和先修状态，避免之后编辑图谱改写学习历史。每次笔记或步骤变化经防抖后写入本机，关闭会话时立即补存；Tutor 在状态指纹中包含活动会话，并优先建议恢复它。

每个图谱只能有一个活动学习会话，并与活动诊断互斥。完成会话原子写入完成证据和投影，但只把没有客观诊断的未开始概念推进到 `LEARNING`；绝不覆盖诊断结论或降低 `MASTERED`。取消只结束活动状态，不生成证据。这样区分了“执行过学习行为”和“已经掌握”的语义。

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
