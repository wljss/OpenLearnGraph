# OpenLearnGraph 工程规则

## 产品原则

- 知识图谱是学习内容、先修结构和学习状态的中心表达，不是装饰性可视化。
- 本地优先、Windows 桌面优先；用户数据默认保留在设备上。
- 掌握度必须可由 Evidence 解释，禁止直接采信 LLM 返回的掌握度数值。
- 知识结构与用户的 Learner State 分离；不得把掌握度写到 KnowledgeNode。
- 生成图谱在人工确认前始终是 candidate graph。

## 架构边界

- Renderer → typed preload API → explicit IPC → main services → repositories → SQLite。
- Renderer 不得访问 Node、文件系统、SQLite 或 Electron 特权 API。
- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 不得削弱。
- IPC 必须是明确命名的窄接口，并在主进程用共享 Zod schema 验证输入；禁止暴露通用 `send/invoke`。
- LLM 未来只能产出经 schema 验证的 TutorDecision，不得直接修改 SQLite。
- decision、execution、state update 保持分离。

## 当前里程碑

M0–M5A：安全 Electron 基础、可持久化的手工知识图谱、独立的学习状态与证据投影、具有完整生命周期的客观诊断、确定性学习决策，以及可恢复的本地教学/进阶会话。不要提前实现自动出题、开放题评分、生成式学习内容、练习/复习/补救会话、文档抽取、RAG、同步或真实 LLM。

## 命令

```powershell
npm.cmd start
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run package
npm.cmd run make
```

## 依赖约束

- 使用 npm 并提交 `package-lock.json`。
- 不引入 Next.js、FastAPI、Python 后端、PostgreSQL、Docker、Redis、Neo4j、LangChain、LangGraph、多智能体框架或独立向量数据库。
- 新依赖必须有当前需求；优先无系统级构建工具、可被 Electron Forge 稳定打包的方案。
- 禁止提交 API key、令牌或其他秘密。

## 变更规则与完成定义

- 保持 main/preload/renderer/shared 边界清晰，避免无用途的抽象层。
- 数据库/领域行为变化必须添加或更新测试，迁移只向前推进。
- 完成前实际运行 lint、typecheck、tests；涉及桌面构建时还要运行 package。
- 不得通过删除或弱化测试来掩盖故障。
- 当前 Definition of Done：图谱结构可编辑并持久化；循环先修关系被拒绝；学习证据可解释状态且不会被普通图谱保存清除；诊断题、作答草稿、不可变快照、历史评分与证据可恢复且客观结果优先；重启可继续未完成诊断和学习会话；学习会话自动保存、取消不产证据、完成不冒充掌握；下一步建议可解释、可采纳/忽略/恢复、可审计且不会直接篡改学习状态；安全边界成立；检查全绿；README 命令准确。
