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
- LLM 只能产出经 schema 验证且经本地出处核对的候选内容，不得直接修改正式图谱或学习状态。
- decision、execution、state update 保持分离。

## 当前里程碑

M0–M7B：安全 Electron 基础、可持久化的手工知识图谱、独立证据投影、客观诊断、确定性学习决策、可恢复的本地教学会话、具有即时反馈的练习/回顾/补强闭环、PDF/EPUB/Markdown/TXT 的本地提取/预览/持久化、带原文出处的候选图谱审核，以及经用户确认发送范围的 DeepSeek 候选生成。不要提前实现自动出题、开放题评分、能力参数选题、生成式学习内容、间隔调度、DOCX/OCR、RAG或同步。

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
- 当前 Definition of Done：图谱结构可编辑并持久化；循环先修关系被拒绝；学习证据可解释状态且不会被普通保存清除；题目用途隔离；诊断不提前泄露答案且客观结果优先；教学、练习和诊断均可跨重启恢复且互斥；取消不产证据，教学和形成性练习不冒充掌握；补强完成后回到重新诊断；下一步建议可解释、可采纳/忽略/恢复、可审计；资料在本机可靠提取并经预览后才保存，重复/编码/扫描件等异常有明确反馈；候选概念和关系保留原文快照与位置、重名/循环受阻并经人工确认后原子写入正式图谱；DeepSeek 密钥受 Windows 加密保护、发送前明示范围并征得同意、返回结构与原文引用经本地核对、生成可取消且可审计；安全边界成立；检查全绿；README 命令准确。
