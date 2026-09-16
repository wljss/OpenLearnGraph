# 数据模型

## M1 知识结构实体

### knowledge_graphs

| 字段 | 类型 | 约束 |
|---|---|---|
| id | TEXT | UUID，主键 |
| name | TEXT | 非空、trim 后不为空 |
| created_at | TEXT | ISO-8601 |
| updated_at | TEXT | ISO-8601 |

### knowledge_nodes

| 字段 | 类型 | 约束 |
|---|---|---|
| id | TEXT | UUID，主键 |
| graph_id | TEXT | 外键，图谱删除时级联 |
| name | TEXT | 非空、trim 后不为空 |
| description | TEXT | 非空，默认空串 |
| position_x / position_y | REAL | React Flow 画布位置 |
| created_at / updated_at | TEXT | ISO-8601 |

### knowledge_edges

| 字段 | 类型 | 约束 |
|---|---|---|
| id | TEXT | UUID，主键 |
| graph_id | TEXT | 图谱外键 |
| source_node_id | TEXT | 先修概念外键，级联删除 |
| target_node_id | TEXT | 后续概念外键，级联删除 |
| relationship | TEXT | M1 仅 `PREREQUISITE` |
| created_at | TEXT | ISO-8601 |

数据库同时约束 source ≠ target，并用复合唯一键阻止同图内重复先修边。Zod 在写入事务前检查重复 ID、重复边、自循环、循环路径和悬空引用。

## M2 学习实体

### learning_evidence

| 字段 | 类型 | 约束 |
|---|---|---|
| id | TEXT | UUID，主键 |
| node_id | TEXT | 概念外键，概念删除时级联 |
| kind | TEXT | `STUDY_STARTED`、`SELF_ASSESSMENT`、`DIAGNOSTIC_RESULT`、`LEARNING_SESSION_COMPLETED` 或 `PRACTICE_RESULT` |
| rating | INTEGER / NULL | 自评为 1–5；开始学习时为空 |
| score_earned / score_possible | INTEGER / NULL | 客观诊断或形成性练习的答对数与题目数 |
| assessment_attempt_id | TEXT / NULL | 客观诊断对应的作答尝试外键 |
| learning_session_id | TEXT / NULL | 完成学习会话对应的会话外键 |
| practice_attempt_id | TEXT / NULL | 完成形成性练习对应的练习外键 |
| note | TEXT | 用户学习备注，最长 2000 字 |
| occurred_at | TEXT | ISO-8601 证据时间 |

Evidence 采用追加记录。新的自评不会覆盖旧证据，而是更新可重建的状态投影。产生客观诊断后，后续自评仍被记录，但不会替代 learner state 中最近一次客观结论。

### learner_node_states

| 字段 | 类型 | 约束 |
|---|---|---|
| node_id | TEXT | 主键，概念外键 |
| phase | TEXT | `NOT_STARTED / LEARNING / MASTERED` |
| started_at | TEXT / NULL | 首次开始学习时间 |
| mastered_at | TEXT / NULL | 当前掌握阶段开始时间 |
| updated_at | TEXT | 最近状态更新时间 |
| latest_evidence_id | TEXT / NULL | 最近证据外键 |

此表是 Evidence 的确定性投影缓存，不是独立事实来源。没有客观诊断时，1–3 分自评投影为 `LEARNING`，4–5 分投影为 `MASTERED`；最近一次客观诊断按 80% 阈值投影为 `LEARNING` 或 `MASTERED`。未掌握的先修概念会令非 `MASTERED` 节点显示为 `LOCKED`。

## M3 诊断实体

### assessment_questions / assessment_options

题目属于知识节点，保存题干、可选解析、`DIAGNOSTIC / PRACTICE / BOTH` 用途及 2–6 个有序选项。数据库存储选项的 `is_correct`，服务边界要求每题必须且只能有一个正确答案，且选项文字不能重复。M5B 迁移前的已有题目默认为 `DIAGNOSTIC`，不会在用户不知情时暴露于即时反馈练习。题目删除会级联删除当前选项。

### assessment_attempts

| 字段 | 类型 | 约束 |
|---|---|---|
| id | TEXT | UUID，主键 |
| graph_id | TEXT | 图谱外键 |
| kind | TEXT | 当前仅 `DIAGNOSTIC` |
| status | TEXT | `IN_PROGRESS / COMPLETED / CANCELLED` |
| started_at / completed_at | TEXT / NULL | 作答开始和结束时间 |

### assessment_attempt_questions / assessment_responses

诊断开始时，系统把概念名、题干、解析和带正确性标记的选项序列化为不可变快照；传给 renderer 的题目会移除正确性标记。作答只引用本次快照中的选项，也允许 `selected_option_id = NULL` 表示“我不知道”。

M3.1 起，每次选择都会把一行 response 作为草稿 upsert，因此 `IN_PROGRESS` 尝试可以跨进程重启恢复；有 response 行且 `selected_option_id = NULL` 表示用户明确选择了“我不知道”，没有 response 行才表示尚未作答。草稿的正确性只在 main/SQLite 内部存在，不通过恢复接口暴露。提交会在单个事务中再次按完整答案 upsert 响应、写入每个概念一条 `DIAGNOSTIC_RESULT` Evidence、更新 learner state 并完成尝试。`CANCELLED` 尝试保留草稿用于历史计数，但永远不生成 Evidence。编辑或删除当前题库不会改写已经开始或完成的诊断。

## M4A 学习决策实体

### tutor_decisions

| 字段 | 类型 | 约束 |
|---|---|---|
| id / graph_id | TEXT | UUID 主键 / 图谱外键 |
| target_node_id | TEXT / NULL | 目标概念；概念删除后置空，名称快照仍保留 |
| target_node_name | TEXT | 决策当时的目标名称快照 |
| action | TEXT | 固定为六种 Tutor 动作之一 |
| reason_code / reason | TEXT | 稳定机器原因码与可读解释 |
| evidence_json / context_json | TEXT | 经验证的事实依据与受限执行上下文 |
| state_fingerprint | TEXT | 生成决策时的语义状态指纹 |
| response | TEXT | `PENDING / ACCEPTED / DISMISSED` |
| is_stale | INTEGER | 状态变化后标记失效，不删除旧记录 |
| source_version | INTEGER | 确定性策略版本 |
| created_at / updated_at | TEXT | ISO-8601 |

`tutor_decisions` 是建议与用户响应的审计记录，不是 Evidence。采纳或忽略只修改 `response`；图谱语义状态或活动诊断变化会使旧记录变为 `is_stale = 1`。节点坐标不进入状态指纹，避免仅调整画布布局时制造无意义的新建议。

## M5A 学习会话实体

### learning_sessions

| 字段 | 类型 | 约束 |
|---|---|---|
| id / graph_id | TEXT | UUID 主键 / 图谱外键 |
| node_id | TEXT / NULL | 目标概念；删除概念后置空 |
| source_decision_id | TEXT / NULL | 可选的来源建议外键 |
| action | TEXT | `TEACH / ADVANCE` |
| status | TEXT | `IN_PROGRESS / COMPLETED / CANCELLED` |
| node_name_snapshot / description_snapshot | TEXT | 会话开始时的概念内容快照 |
| prerequisite_snapshot_json | TEXT | 经验证的先修概念与状态快照 |
| notes / step_index | TEXT / INTEGER | 自动保存的学习笔记与三步进度 |
| started_at / updated_at / completed_at | TEXT / NULL | 会话生命周期时间 |

每个图谱最多有一个 `IN_PROGRESS` 学习会话，且活动诊断和活动学习会话互斥。完成操作在单个事务中写入 `LEARNING_SESSION_COMPLETED` Evidence、更新允许更新的 learner state 并结束会话。会话完成只表示完成了学习行为，不构成掌握结论；已有诊断状态和 `MASTERED` 状态不会被降级。取消会话不生成 Evidence。

## M5B 形成性练习实体

### practice_attempts

| 字段 | 类型 | 约束 |
|---|---|---|
| id / graph_id | TEXT | UUID 主键 / 图谱外键 |
| node_id | TEXT / NULL | 单次练习的目标概念；删除概念后置空 |
| source_decision_id | TEXT / NULL | 可选来源 TutorDecision |
| node_name_snapshot | TEXT | 开始时的概念名称 |
| mode | TEXT | `PRACTICE / REMEDIATE / REVIEW` |
| status | TEXT | `IN_PROGRESS / COMPLETED / CANCELLED` |
| started_at / updated_at / completed_at | TEXT / NULL | 生命周期时间 |

### practice_attempt_questions / practice_responses

练习开始时只选择用途为 `PRACTICE` 或 `BOTH` 的题目，并复制题干、解析和带正确性标记的选项。renderer 在作答前只收到无正确性字段的选项；每次作答由 main 根据快照评分并原子写入，随后仅返回该题的正确答案和解析。已经写入的答案不可修改，同请求重试保持幂等。

每个图谱最多有一个活动练习，并与活动教学和诊断互斥。全部题目作答后，完成事务写入一条 `PRACTICE_RESULT` Evidence 和正确率。形成性练习只可把未开始状态推进至 `LEARNING`，不会建立或降低 `MASTERED`，也不会覆盖 learner state 中最近一次客观诊断指针；原始 Evidence 时间线仍会展示练习结果。取消只保留作答历史，不产生 Evidence。

## M6A 本地资料实体

### imported_documents

| 字段 | 类型 | 约束 |
|---|---|---|
| id | TEXT | UUID，主键 |
| title / author / publisher | TEXT | 确认导入前可编辑的书目信息 |
| language / identifier | TEXT | 可选语言与 ISBN/其他标识 |
| format | TEXT | `PDF / EPUB / TEXT / MARKDOWN` |
| source_name / source_path | TEXT | 原文件名与仅在主进程使用的本机路径 |
| source_size / source_modified_at | INTEGER / TEXT | 预览与确认之间的文件一致性检查 |
| sha256 | TEXT | 内容散列，唯一约束用于重复检测 |
| encoding | TEXT / NULL | 文本资料检测到的编码 |
| page_count / section_count / character_count | INTEGER | 可检索的提取规模信息 |
| warnings_json | TEXT | 经验证的结构化提取警告 |
| imported_at | TEXT | ISO-8601 导入时间 |

### imported_document_sections

| 字段 | 类型 | 约束 |
|---|---|---|
| id / document_id | TEXT | UUID 主键 / 资料外键，删除资料时级联 |
| order_index | INTEGER | 文档内稳定顺序，与资料构成唯一键 |
| heading | TEXT | 章节标题、页标题或回退标题 |
| locator | TEXT | `第 N 页`、EPUB 资源位置或文本章节位置 |
| content | TEXT | 完整提取文本 |
| character_count | INTEGER | 本节字符数 |

文件选择、读取和提取只发生在 main。导入预览以短期随机 token 暂存在内存中，renderer 既不提供也不接收本机路径；确认时服务会再次核对原文件大小和修改时间，再在单个事务中写入资料与全部章节。扫描 PDF 等无法得到可靠文本的资料只返回受阻预览和可执行提示，不写入数据库。

## 计划中的独立实体（M7+）

- 候选图谱、资料片段与知识节点来源关联

`mastery` 和用户状态绝不进入 `knowledge_nodes`。Evidence 保留原始结果和出处，learner model 根据证据更新状态，从而允许解释任一掌握度。
