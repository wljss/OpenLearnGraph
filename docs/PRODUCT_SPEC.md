# 产品规格

## 愿景

OpenLearnGraph 将任何学习目标转化为持续演化的知识地图，由未来的 Tutor Agent 根据知识结构、学习者状态、证据与历史决定下一步学习行动。

核心循环：学习目标 → 知识图谱 → 学习者状态 → TutorDecision → 教学/评估/练习/复习 → Evidence → 状态更新 → 重规划。

## 当前范围：M0 + M1

- Windows 本地 Electron 应用；React Flow 是主工作区。
- 创建、命名和加载多个知识图谱。
- 创建、选择、编辑、拖动、删除概念节点。
- 创建和删除有向 `PREREQUISITE` 关系。
- 保存图名、节点、边与节点位置到 SQLite，重启后恢复。
- 拒绝空白名称、自循环边、重复边与悬空边。

## 明确不在当前范围

真实 learner mastery、Evidence、Assessment、Tutor Agent、AI provider、文档导入、候选图谱生成、RAG、账号、云同步、遥测和自动更新均不在 M1。界面只展示新节点真实的初始结构状态 `AVAILABLE`，不伪造掌握度。

## 后续 Tutor Agent 约束

动作空间固定为 `TEACH | ASSESS | PRACTICE | REVIEW | REMEDIATE | ADVANCE`。策略/LLM 只产出 `TutorDecision`；经运行时验证后，由应用服务执行并产生 Evidence，再由 learner model 更新状态。
