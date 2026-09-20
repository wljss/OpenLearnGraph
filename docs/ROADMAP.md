# 路线图

- **M0 — Foundation（完成）**：Electron Forge、React/Vite/TypeScript、Tailwind、React Flow、SQLite、安全 IPC、测试与文档。
- **M1 — Manual Knowledge Graph（完成）**：图谱/节点/先修边 CRUD、位置、详情面板、本地持久化。
- **M2 — Learner State + Evidence（完成）**：独立学习者状态、证据记录与可解释状态投影；不引入 LLM。
- **M3 — Diagnostic Assessment（完成）**：手工单选题库、不可变作答快照、图谱诊断、逐题回顾与客观证据生成。
- **M3.1 — Diagnostic Lifecycle（完成）**：答案自动保存、中断恢复、诊断历史、范围选择与薄弱概念重测。
- **M4A — Explainable Tutor Decision Engine（完成）**：确定性本地策略、受约束动作空间、依据展示、响应与失效历史、决策/执行/状态更新分离。
- **M4B — Tutor policy extension**：在相同契约下扩展策略评估与可选 provider；任何非确定性输出必须通过 schema 与安全回退。
- **M5A — Resumable local learning session（完成）**：基于已保存概念描述的教学/进阶会话、自动保存、跨重启恢复、历史与独立完成证据。
- **M5B — Formative practice loop（完成）**：题目用途隔离、即时反馈、练习/回顾/补强、跨重启恢复、形成性证据与重新诊断闭环。
- **M6A — Reliable local document import（完成）**：PDF/EPUB/Markdown/TXT 的本地确定性提取、元数据与章节/页码保留、导入前预览、编码识别、重复检测及扫描 PDF 提示；已导入正文可按需完整阅读、搜索与定位。
- **M6B — Extended document extraction**：DOCX、本地 OCR，以及更完整的表格与复杂版面保留。
- **M7A — Source-grounded candidate graph review（完成）**：从本地资料原文创建候选概念，保留可导航出处，编辑/忽略/恢复候选项，审核先修关系，并在重名和循环检查后原子写入正式图谱；不调用 AI。
- **M7B — AI-assisted candidate generation**：以可配置的云端 provider（优先 DeepSeek）从用户明确授权的资料范围提出结构化候选；发送前预览、schema 验证、失败回退和人工审核边界保持不变。
- **M8 — Source-grounded learning / RAG**：来源支撑的检索与教学。
- **M9 — Review scheduling**：复习调度与遗忘模型。
- **M10 — Windows release**：安装体验、签名、无障碍、性能、发布流程与开源完善。
