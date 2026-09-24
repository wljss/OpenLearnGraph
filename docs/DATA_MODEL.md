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

图谱学习进度是读取时从节点状态与决定性 Evidence 类型派生的展示摘要，不新增可写入的“进度”事实。`masteredCount` 只统计投影为 `MASTERED` 的概念；其中 `DIAGNOSTIC_RESULT` 与 `SELF_ASSESSMENT` 分别计入客观确认和主观掌握。诊断题达到 2 道只计入独立的 `diagnosticReadyCount`，不计入掌握进度。图谱列表返回同一份派生摘要，因此侧栏与当前图谱不会使用不同口径。

### onboarding_state

单行表保存 `NOT_STARTED / IN_PROGRESS / COMPLETED / DISMISSED` 引导状态、可选的示例图谱外键及开始/完成/更新时间。六项上手任务不另存“完成标记”，而是在读取时分别检查图谱、概念、关系以及三类真实 Evidence 是否存在；因此任务清单可恢复，但不会成为学习事实或修改 learner state。全新空库初始化为 `NOT_STARTED`，从旧版本迁移且已经存在图谱时初始化为 `DISMISSED`。

示例图谱 ID 只保存在该单行表中。创建示例时，图谱、3 个节点、2 条先修关系和 6 道预置 `BOTH` 题在一个事务中写入；重复创建会返回同一示例。专用删除操作只接受此已记录 ID，删除图谱时由外键级联清理其题目、会话和 Evidence，并将 `sample_graph_id` 置空。

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

文件选择、读取和提取只发生在 main。一次多选会逐份生成相互独立的短期随机 token 和失败结果，renderer 既不提供也不接收本机路径；用户逐本确认或跳过，放弃批次时释放全部未使用 token。确认时服务会再次核对原文件大小和修改时间，再在单个事务中写入资料与全部章节。扫描 PDF 等无法得到可靠文本的资料只返回受阻预览和可执行提示，不写入数据库，也不影响同批其他资料。

## M7A 候选图谱实体

### candidate_concepts

| 字段 | 类型 | 约束 |
|---|---|---|
| id / graph_id | TEXT | UUID 主键 / 目标图谱外键 |
| document_id | TEXT / NULL | 原资料外键；资料删除后置空，出处快照仍保留 |
| document_title / document_source_name | TEXT | 创建候选时的资料标题和文件名快照 |
| section_position / source_locator | INTEGER / TEXT | 章节顺序与页码、EPUB 资源或文本行号 |
| source_start_offset / source_end_offset | INTEGER | 完整章节正文中的精确字符区间 |
| source_quote | TEXT | 1–2000 字的不可变原文依据快照 |
| name / description | TEXT | 人工可编辑的候选概念内容 |
| origin / source_model | TEXT / TEXT / NULL | `MANUAL / AI` 来源；AI 候选记录实际使用的模型 |
| status | TEXT | `PENDING / ACCEPTED / IGNORED` |
| accepted_node_id | TEXT / NULL | 确认写入后关联的正式概念；正式概念删除后置空 |
| created_at / updated_at / reviewed_at | TEXT / NULL | 候选与审核时间线；用户点击保留、修改、排除或最终写入时记录审核时间 |

### candidate_relationships

候选关系只允许连接同一图谱内两个 `PENDING` 候选概念，方向固定为 `PREREQUISITE`。记录同样具有 `PENDING / ACCEPTED / IGNORED` 状态和可选 `accepted_edge_id`。忽略概念时，与其相连的待审核关系一并忽略；循环关系在创建和最终写入时都会被拒绝。

M7C 起，关系额外保存 `reason`、`origin / source_model`，以及独立的资料 ID、资料标题/文件名快照、章节位置、字符区间、定位文本和 `evidence_quote`。AI 关系必须同时具有非空原因和本地重建的原文快照；手工关系允许没有 AI 依据。升级前已经存在的 AI 关系会保留，但缺少这些字段时形成写入阻断，防止旧建议被误认为经过新规则核对。

最终确认在 `BEGIN IMMEDIATE` 事务中创建正式节点与关系、更新候选状态和图谱更新时间。写入前重新检查正式图谱重名、候选重名、悬空关系、循环及数量上限。候选记录不是学习 Evidence，不影响 learner state。

## M7B AI 生成审计实体

### ai_generation_runs

每次用户确认后的云端生成均先创建一条审计记录。记录包含用户明确选择的目标图谱、资料、provider、模型、完整连续章节范围、总发送字符数、状态、所有批次汇总 token 用量、最终候选概念/关系数量、可读错误以及开始/结束时间；不保存 API Key、提示词、正文或模型原始响应。状态为 `IN_PROGRESS / SUCCEEDED / FAILED / CANCELLED`，任一批失败时本次运行整体失败且候选区不留下部分结果。

DeepSeek 设置不进入 SQLite。模型选择与 Windows `safeStorage` 生成的 API Key 密文保存在 Electron `userData` 下的 `ai-settings.json`；main 只向 renderer 返回“是否已配置”和模型，不返回密钥或密文。

`mastery` 和用户状态绝不进入 `knowledge_nodes`。Evidence 保留原始结果和出处，learner model 根据证据更新状态，从而允许解释任一掌握度。
