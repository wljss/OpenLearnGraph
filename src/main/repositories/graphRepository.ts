import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { EvidenceKind, GraphSummary, KnowledgeEdgeView, KnowledgeGraphDocument, KnowledgeNodeView, LearningPhase, SaveGraphInput } from '../../shared/contracts';
import { projectGraphLearning } from '../../shared/learningProjection';

interface GraphRow { id: string; name: string; created_at: string; updated_at: string }
interface NodeRow { id: string; graph_id: string; name: string; description: string; position_x: number; position_y: number }
interface EdgeRow { id: string; graph_id: string; source_node_id: string; target_node_id: string; relationship: 'PREREQUISITE' }
interface LearningStateRow {
  node_id: string;
  phase: LearningPhase;
  evidence_count: number;
  last_evidence_at: string | null;
  latest_evidence_kind: EvidenceKind | null;
  most_recent_evidence_kind: EvidenceKind | null;
  latest_score_earned: number | null;
  latest_score_possible: number | null;
  diagnostic_question_count: number;
  practice_question_count: number;
}

function toSummary(row: GraphRow): GraphSummary {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
}

export class GraphRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): GraphSummary[] {
    const rows = this.database.prepare(
      'SELECT id, name, created_at, updated_at FROM knowledge_graphs ORDER BY updated_at DESC',
    ).all() as unknown as GraphRow[];
    return rows.map(toSummary);
  }

  create(name: string): KnowledgeGraphDocument {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(
      'INSERT INTO knowledge_graphs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(id, name, now, now);
    return this.load(id) as KnowledgeGraphDocument;
  }

  load(graphId: string): KnowledgeGraphDocument | null {
    const graph = this.database.prepare(
      'SELECT id, name, created_at, updated_at FROM knowledge_graphs WHERE id = ?',
    ).get(graphId) as unknown as GraphRow | undefined;
    if (!graph) return null;
    const nodeRows = this.database.prepare(
      'SELECT id, graph_id, name, description, position_x, position_y FROM knowledge_nodes WHERE graph_id = ? ORDER BY created_at',
    ).all(graphId) as unknown as NodeRow[];
    const edgeRows = this.database.prepare(
      'SELECT id, graph_id, source_node_id, target_node_id, relationship FROM knowledge_edges WHERE graph_id = ? ORDER BY created_at',
    ).all(graphId) as unknown as EdgeRow[];
    const learningRows = this.database.prepare(
      `SELECT n.id AS node_id,
              COALESCE(s.phase, 'NOT_STARTED') AS phase,
              (SELECT COUNT(*) FROM learning_evidence e WHERE e.node_id = n.id) AS evidence_count,
              (SELECT MAX(e.occurred_at) FROM learning_evidence e WHERE e.node_id = n.id) AS last_evidence_at,
              latest.kind AS latest_evidence_kind,
              (SELECT e.kind FROM learning_evidence e
               WHERE e.node_id = n.id ORDER BY e.occurred_at DESC, e.rowid DESC LIMIT 1) AS most_recent_evidence_kind,
              latest.score_earned AS latest_score_earned,
              latest.score_possible AS latest_score_possible,
              (SELECT COUNT(*) FROM assessment_questions q
               WHERE q.node_id = n.id AND q.purpose IN ('DIAGNOSTIC', 'BOTH')) AS diagnostic_question_count,
              (SELECT COUNT(*) FROM assessment_questions q
               WHERE q.node_id = n.id AND q.purpose IN ('PRACTICE', 'BOTH')) AS practice_question_count
       FROM knowledge_nodes n
       LEFT JOIN learner_node_states s ON s.node_id = n.id
       LEFT JOIN learning_evidence latest ON latest.id = s.latest_evidence_id
       WHERE n.graph_id = ?`,
    ).all(graphId) as unknown as LearningStateRow[];
    const learningByNodeId = new Map(learningRows.map((row) => [row.node_id, row]));
    const nodes: KnowledgeNodeView[] = nodeRows.map((row) => ({
      id: row.id, graphId: row.graph_id, name: row.name, description: row.description,
      position: { x: row.position_x, y: row.position_y },
      status: 'AVAILABLE',
      learningPhase: learningByNodeId.get(row.id)?.phase ?? 'NOT_STARTED',
      statusReason: '',
      evidenceCount: Number(learningByNodeId.get(row.id)?.evidence_count ?? 0),
      lastEvidenceAt: learningByNodeId.get(row.id)?.last_evidence_at ?? null,
      latestEvidenceKind: learningByNodeId.get(row.id)?.latest_evidence_kind ?? null,
      mostRecentEvidenceKind: learningByNodeId.get(row.id)?.most_recent_evidence_kind ?? null,
      latestEvidenceScoreEarned: learningByNodeId.get(row.id)?.latest_score_earned ?? null,
      latestEvidenceScorePossible: learningByNodeId.get(row.id)?.latest_score_possible ?? null,
      diagnosticQuestionCount: Number(learningByNodeId.get(row.id)?.diagnostic_question_count ?? 0),
      practiceQuestionCount: Number(learningByNodeId.get(row.id)?.practice_question_count ?? 0),
    }));
    const edges: KnowledgeEdgeView[] = edgeRows.map((row) => ({
      id: row.id, graphId: row.graph_id, sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id, relationship: row.relationship,
    }));
    return projectGraphLearning({ ...toSummary(graph), nodes, edges });
  }

  save(input: SaveGraphInput): KnowledgeGraphDocument {
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const update = this.database.prepare(
        'UPDATE knowledge_graphs SET name = ?, updated_at = ? WHERE id = ?',
      ).run(input.name, now, input.id);
      if (Number(update.changes) !== 1) throw new Error('要保存的知识图谱不存在');
      this.database.prepare('DELETE FROM knowledge_edges WHERE graph_id = ?').run(input.id);
      const existingNodes = this.database.prepare(
        'SELECT id FROM knowledge_nodes WHERE graph_id = ?',
      ).all(input.id) as unknown as Array<{ id: string }>;
      const inputNodeIds = new Set(input.nodes.map((node) => node.id));
      const deleteNode = this.database.prepare('DELETE FROM knowledge_nodes WHERE id = ? AND graph_id = ?');
      const findActiveSession = this.database.prepare(
        `SELECT node_name_snapshot
         FROM learning_sessions
         WHERE node_id = ? AND graph_id = ? AND status = 'IN_PROGRESS'
         LIMIT 1`,
      );
      const findActiveDiagnostic = this.database.prepare(
        `SELECT a.id
         FROM assessment_attempts a
         JOIN assessment_attempt_questions q ON q.attempt_id = a.id
         WHERE q.node_id = ? AND a.graph_id = ? AND a.status = 'IN_PROGRESS'
         LIMIT 1`,
      );
      const findActivePractice = this.database.prepare(
        `SELECT node_name_snapshot
         FROM practice_attempts
         WHERE node_id = ? AND graph_id = ? AND status = 'IN_PROGRESS'
         LIMIT 1`,
      );
      for (const existingNode of existingNodes) {
        if (inputNodeIds.has(existingNode.id)) continue;
        const activeSession = findActiveSession.get(existingNode.id, input.id) as { node_name_snapshot: string } | undefined;
        if (activeSession) {
          throw new Error(`“${activeSession.node_name_snapshot}”有未完成的学习会话，请先继续或放弃会话再删除`);
        }
        if (findActiveDiagnostic.get(existingNode.id, input.id)) {
          throw new Error('该概念正在未完成的诊断中，请先继续或放弃诊断再删除');
        }
        const activePractice = findActivePractice.get(existingNode.id, input.id) as { node_name_snapshot: string } | undefined;
        if (activePractice) {
          throw new Error(`“${activePractice.node_name_snapshot}”有未完成的练习，请先继续或放弃练习再删除`);
        }
        deleteNode.run(existingNode.id, input.id);
      }
      const insertNode = this.database.prepare(
        `INSERT INTO knowledge_nodes
         (id, graph_id, name, description, position_x, position_y, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           position_x = excluded.position_x,
           position_y = excluded.position_y,
           updated_at = excluded.updated_at
         WHERE knowledge_nodes.graph_id = excluded.graph_id`,
      );
      for (const node of input.nodes) {
        const write = insertNode.run(node.id, input.id, node.name, node.description, node.position.x, node.position.y, now, now);
        if (Number(write.changes) !== 1) throw new Error('概念 ID 已被其他知识图谱使用');
      }
      const insertEdge = this.database.prepare(
        `INSERT INTO knowledge_edges
         (id, graph_id, source_node_id, target_node_id, relationship, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const edge of input.edges) {
        insertEdge.run(edge.id, input.id, edge.sourceNodeId, edge.targetNodeId, edge.relationship, now);
      }
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    return this.load(input.id) as KnowledgeGraphDocument;
  }
}
