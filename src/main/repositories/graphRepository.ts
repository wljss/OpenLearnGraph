import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { GraphSummary, KnowledgeEdgeView, KnowledgeGraphDocument, KnowledgeNodeView, LearningPhase, SaveGraphInput } from '../../shared/contracts';
import { projectGraphLearning } from '../../shared/learningProjection';

interface GraphRow { id: string; name: string; created_at: string; updated_at: string }
interface NodeRow { id: string; graph_id: string; name: string; description: string; position_x: number; position_y: number }
interface EdgeRow { id: string; graph_id: string; source_node_id: string; target_node_id: string; relationship: 'PREREQUISITE' }
interface LearningStateRow {
  node_id: string;
  phase: LearningPhase;
  evidence_count: number;
  last_evidence_at: string | null;
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
              COUNT(e.id) AS evidence_count,
              MAX(e.occurred_at) AS last_evidence_at
       FROM knowledge_nodes n
       LEFT JOIN learner_node_states s ON s.node_id = n.id
       LEFT JOIN learning_evidence e ON e.node_id = n.id
       WHERE n.graph_id = ?
       GROUP BY n.id, s.phase`,
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
      for (const existingNode of existingNodes) {
        if (!inputNodeIds.has(existingNode.id)) deleteNode.run(existingNode.id, input.id);
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
