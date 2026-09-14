import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { GraphSummary, KnowledgeEdgeView, KnowledgeGraphDocument, KnowledgeNodeView, SaveGraphInput } from '../../shared/contracts';

interface GraphRow { id: string; name: string; created_at: string; updated_at: string }
interface NodeRow { id: string; graph_id: string; name: string; description: string; position_x: number; position_y: number }
interface EdgeRow { id: string; graph_id: string; source_node_id: string; target_node_id: string; relationship: 'PREREQUISITE' }

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
    const nodes: KnowledgeNodeView[] = nodeRows.map((row) => ({
      id: row.id, graphId: row.graph_id, name: row.name, description: row.description,
      position: { x: row.position_x, y: row.position_y },
      status: 'AVAILABLE',
    }));
    const edges: KnowledgeEdgeView[] = edgeRows.map((row) => ({
      id: row.id, graphId: row.graph_id, sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id, relationship: row.relationship,
    }));
    return { ...toSummary(graph), nodes, edges };
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
      this.database.prepare('DELETE FROM knowledge_nodes WHERE graph_id = ?').run(input.id);
      const insertNode = this.database.prepare(
        `INSERT INTO knowledge_nodes
         (id, graph_id, name, description, position_x, position_y, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const node of input.nodes) {
        insertNode.run(node.id, input.id, node.name, node.description, node.position.x, node.position.y, now, now);
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
