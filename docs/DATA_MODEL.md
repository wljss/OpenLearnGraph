# 数据模型

## M1 实体

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

数据库同时约束 source ≠ target，并用复合唯一键阻止同图内重复先修边。Zod 在写入事务前检查重复 ID、重复边、自循环和悬空引用。

## 计划中的独立实体（M2+）

- `learner_node_states(node_id, mastery, confidence, status, last_reviewed_at, ...)`
- `evidence(id, node_id, kind, payload, occurred_at, source_reference, ...)`
- `assessments` / `assessment_attempts`
- `learning_sessions`
- `tutor_decisions(action, target_node_id, strategy, reason, ...)`
- `source_documents` / `source_chunks` / 节点来源关联

`mastery` 和用户状态绝不进入 `knowledge_nodes`。Evidence 保留原始结果和出处，learner model 根据证据更新状态，从而允许解释任一掌握度。
