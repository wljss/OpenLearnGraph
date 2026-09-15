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
| kind | TEXT | `STUDY_STARTED` 或 `SELF_ASSESSMENT` |
| rating | INTEGER / NULL | 自评为 1–5；开始学习时为空 |
| note | TEXT | 用户学习备注，最长 2000 字 |
| occurred_at | TEXT | ISO-8601 证据时间 |

Evidence 采用追加记录。新的自评不会覆盖旧证据，而是更新可重建的状态投影。

### learner_node_states

| 字段 | 类型 | 约束 |
|---|---|---|
| node_id | TEXT | 主键，概念外键 |
| phase | TEXT | `NOT_STARTED / LEARNING / MASTERED` |
| started_at | TEXT / NULL | 首次开始学习时间 |
| mastered_at | TEXT / NULL | 当前掌握阶段开始时间 |
| updated_at | TEXT | 最近状态更新时间 |
| latest_evidence_id | TEXT / NULL | 最近证据外键 |

此表是 Evidence 的确定性投影缓存，不是独立事实来源。1–3 分自评投影为 `LEARNING`，4–5 分投影为 `MASTERED`；未掌握的先修概念会令非 `MASTERED` 节点显示为 `LOCKED`。

## 计划中的独立实体（M3+）

- `assessments` / `assessment_attempts`
- `learning_sessions`
- `tutor_decisions(action, target_node_id, strategy, reason, ...)`
- `source_documents` / `source_chunks` / 节点来源关联

`mastery` 和用户状态绝不进入 `knowledge_nodes`。Evidence 保留原始结果和出处，learner model 根据证据更新状态，从而允许解释任一掌握度。
