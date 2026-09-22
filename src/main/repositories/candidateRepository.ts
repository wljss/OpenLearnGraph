import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ApplyCandidateWorkspaceResult,
  CandidateConceptView,
  CandidateRelationshipView,
  CandidateStatus,
  CandidateWorkspaceView,
  CreateCandidateConceptInput,
  CreateCandidateRelationshipInput,
  UpdateCandidateConceptInput,
} from '../../shared/contracts';
import { hasDirectedCycle } from '../../shared/graphRules';
import type { GraphRepository } from './graphRepository';

interface CandidateConceptRow {
  id: string;
  graph_id: string;
  document_id: string | null;
  document_title: string;
  document_source_name: string;
  section_position: number;
  source_locator: string;
  source_start_offset: number;
  source_end_offset: number;
  source_quote: string;
  name: string;
  description: string;
  origin: 'MANUAL' | 'AI';
  source_model: string | null;
  status: CandidateStatus;
  accepted_node_id: string | null;
  duplicate_node_id: string | null;
  duplicate_node_name: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
}

interface CandidateRelationshipRow {
  id: string;
  graph_id: string;
  source_candidate_id: string;
  target_candidate_id: string;
  relationship: 'PREREQUISITE';
  status: CandidateStatus;
  accepted_edge_id: string | null;
  created_at: string;
}

interface SourceRow {
  document_title: string;
  source_name: string;
  locator: string;
  content: string;
}

export interface GeneratedCandidateBatchInput {
  graphId: string;
  documentId: string;
  model: string;
  concepts: Array<{
    sectionPosition: number;
    sourceStartOffset: number;
    sourceEndOffset: number;
    name: string;
    description: string;
  }>;
  relationships: Array<{ sourceIndex: number; targetIndex: number }>;
}

function unicodeCodePoints(value: string): string[] {
  return Array.from(value);
}

const CONCEPT_COLUMNS = `c.id, c.graph_id, c.document_id, c.document_title,
  c.document_source_name, c.section_position, c.source_locator,
  c.source_start_offset, c.source_end_offset, c.source_quote, c.name,
  c.description, c.origin, c.source_model, c.status, c.accepted_node_id, c.created_at, c.updated_at,
  c.reviewed_at,
  (SELECT n.id FROM knowledge_nodes n
   WHERE n.graph_id = c.graph_id AND lower(trim(n.name)) = lower(trim(c.name))
     AND (c.accepted_node_id IS NULL OR n.id <> c.accepted_node_id)
   ORDER BY n.created_at LIMIT 1) AS duplicate_node_id,
  (SELECT n.name FROM knowledge_nodes n
   WHERE n.graph_id = c.graph_id AND lower(trim(n.name)) = lower(trim(c.name))
     AND (c.accepted_node_id IS NULL OR n.id <> c.accepted_node_id)
   ORDER BY n.created_at LIMIT 1) AS duplicate_node_name`;

function toConcept(row: CandidateConceptRow): CandidateConceptView {
  return {
    id: row.id,
    graphId: row.graph_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    documentSourceName: row.document_source_name,
    sectionPosition: Number(row.section_position),
    sourceLocator: row.source_locator,
    sourceStartOffset: Number(row.source_start_offset),
    sourceEndOffset: Number(row.source_end_offset),
    sourceQuote: row.source_quote,
    name: row.name,
    description: row.description,
    origin: row.origin,
    sourceModel: row.source_model,
    status: row.status,
    acceptedNodeId: row.accepted_node_id,
    duplicateNodeId: row.duplicate_node_id,
    duplicateNodeName: row.duplicate_node_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
  };
}

function toRelationship(row: CandidateRelationshipRow): CandidateRelationshipView {
  return {
    id: row.id,
    graphId: row.graph_id,
    sourceCandidateId: row.source_candidate_id,
    targetCandidateId: row.target_candidate_id,
    relationship: row.relationship,
    status: row.status,
    acceptedEdgeId: row.accepted_edge_id,
    createdAt: row.created_at,
  };
}

function candidateIssues(
  concepts: CandidateConceptView[],
  relationships: CandidateRelationshipView[],
  existingNodeCount: number,
  existingEdgeCount: number,
): string[] {
  const issues: string[] = [];
  const pending = concepts.filter((concept) => concept.status === 'PENDING');
  const pendingIds = new Set(pending.map((concept) => concept.id));
  for (const concept of pending) {
    if (concept.duplicateNodeId) issues.push(`“${concept.name}”与图谱中的“${concept.duplicateNodeName}”重名`);
  }
  const names = new Map<string, string>();
  for (const concept of pending) {
    const normalized = concept.name.trim().toLocaleLowerCase();
    if (names.has(normalized)) issues.push(`候选概念“${concept.name}”出现重名`);
    names.set(normalized, concept.id);
  }
  const pendingRelationships = relationships.filter((relationship) => relationship.status === 'PENDING');
  for (const relationship of pendingRelationships) {
    if (!pendingIds.has(relationship.sourceCandidateId) || !pendingIds.has(relationship.targetCandidateId)) {
      issues.push('有先修关系引用了已忽略或已处理的候选概念');
    }
  }
  if (hasDirectedCycle(pendingRelationships.map((relationship) => ({
    sourceNodeId: relationship.sourceCandidateId,
    targetNodeId: relationship.targetCandidateId,
  })))) issues.push('候选先修关系形成了循环');
  if (existingNodeCount + pending.length > 5_000) issues.push('写入后概念数量将超过 5000 个');
  if (existingEdgeCount + pendingRelationships.length > 20_000) issues.push('写入后关系数量将超过 20000 条');
  return [...new Set(issues)];
}

function nextPosition(
  occupied: Array<{ x: number; y: number }>,
  addedIndex: number,
): { x: number; y: number } {
  const columns = 4;
  for (let index = 0; index <= occupied.length + addedIndex + 20; index += 1) {
    const candidate = { x: 90 + (index % columns) * 230, y: 90 + Math.floor(index / columns) * 140 };
    if (!occupied.some((position) => (
      Math.abs(position.x - candidate.x) < 180 && Math.abs(position.y - candidate.y) < 90
    ))) return candidate;
  }
  return { x: 90, y: 90 + Math.ceil((occupied.length + addedIndex) / columns) * 140 };
}

export class CandidateRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly graphRepository: GraphRepository,
  ) {}

  graphExists(graphId: string): boolean {
    return Boolean(this.database.prepare('SELECT 1 FROM knowledge_graphs WHERE id = ?').get(graphId));
  }

  workspace(graphId: string, documentId?: string): CandidateWorkspaceView {
    const concepts = this.database.prepare(
      `SELECT ${CONCEPT_COLUMNS}
       FROM candidate_concepts c
       WHERE c.graph_id = ? AND (? IS NULL OR c.document_id = ?)
       ORDER BY CASE c.status WHEN 'PENDING' THEN 0 WHEN 'IGNORED' THEN 1 ELSE 2 END,
                c.created_at DESC, c.rowid DESC`,
    ).all(graphId, documentId ?? null, documentId ?? null) as unknown as CandidateConceptRow[];
    const conceptViews = concepts.map(toConcept);
    const visibleIds = new Set(conceptViews.map((concept) => concept.id));
    const relationships = (this.database.prepare(
      `SELECT id, graph_id, source_candidate_id, target_candidate_id, relationship,
              status, accepted_edge_id, created_at
       FROM candidate_relationships
       WHERE graph_id = ?
       ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'IGNORED' THEN 1 ELSE 2 END,
                created_at DESC, rowid DESC`,
    ).all(graphId) as unknown as CandidateRelationshipRow[])
      .map(toRelationship)
      .filter((relationship) => visibleIds.has(relationship.sourceCandidateId)
        && visibleIds.has(relationship.targetCandidateId));
    const counts = this.database.prepare(
      `SELECT
        (SELECT COUNT(*) FROM knowledge_nodes WHERE graph_id = ?) AS node_count,
        (SELECT COUNT(*) FROM knowledge_edges WHERE graph_id = ?) AS edge_count`,
    ).get(graphId, graphId) as { node_count: number; edge_count: number };
    return {
      concepts: conceptViews,
      relationships,
      pendingConceptCount: conceptViews.filter((concept) => concept.status === 'PENDING').length,
      pendingRelationshipCount: relationships.filter((relationship) => relationship.status === 'PENDING').length,
      blockingIssues: candidateIssues(conceptViews, relationships, Number(counts.node_count), Number(counts.edge_count)),
    };
  }

  createConcept(input: CreateCandidateConceptInput): CandidateWorkspaceView {
    const source = this.database.prepare(
      `SELECT d.title AS document_title, d.source_name, s.locator, s.content
       FROM imported_documents d
       JOIN imported_document_sections s ON s.document_id = d.id
       WHERE d.id = ? AND s.position = ?`,
    ).get(input.documentId, input.sectionPosition) as SourceRow | undefined;
    if (!source) throw new Error('原文章节不存在，可能已被删除');
    if (!this.graphExists(input.graphId)) throw new Error('目标知识图谱不存在');
    const sourceCharacters = unicodeCodePoints(source.content);
    if (input.sourceEndOffset > sourceCharacters.length) throw new Error('所选原文位置已失效，请重新选择');
    const sourceQuote = sourceCharacters.slice(input.sourceStartOffset, input.sourceEndOffset).join('');
    if (!sourceQuote.trim()) throw new Error('请选择包含文字的原文依据');
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO candidate_concepts
       (id, graph_id, document_id, document_title, document_source_name,
        section_position, source_locator, source_start_offset, source_end_offset,
        source_quote, name, description, status, accepted_node_id,
        created_at, updated_at, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, NULL)`,
    ).run(
      randomUUID(), input.graphId, input.documentId, source.document_title, source.source_name,
      input.sectionPosition, source.locator, input.sourceStartOffset, input.sourceEndOffset,
      sourceQuote, input.name, input.description, now, now,
    );
    return this.workspace(input.graphId);
  }

  createGeneratedBatch(input: GeneratedCandidateBatchInput): CandidateWorkspaceView {
    if (!this.graphExists(input.graphId)) throw new Error('目标知识图谱不存在');
    if (!input.concepts.length) throw new Error('AI 没有返回可用的候选概念');
    if (hasDirectedCycle(input.relationships.map((relationship) => ({
      sourceNodeId: String(relationship.sourceIndex),
      targetNodeId: String(relationship.targetIndex),
    })))) throw new Error('AI 返回的候选关系存在循环');

    const sources = new Map<number, SourceRow>();
    for (const concept of input.concepts) {
      if (sources.has(concept.sectionPosition)) continue;
      const source = this.database.prepare(
        `SELECT d.title AS document_title, d.source_name, s.locator, s.content
         FROM imported_documents d
         JOIN imported_document_sections s ON s.document_id = d.id
         WHERE d.id = ? AND s.position = ?`,
      ).get(input.documentId, concept.sectionPosition) as SourceRow | undefined;
      if (!source) throw new Error('AI 候选项引用的原文章节已失效');
      sources.set(concept.sectionPosition, source);
    }

    const now = new Date().toISOString();
    const candidateIds: string[] = [];
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const insertConcept = this.database.prepare(
        `INSERT INTO candidate_concepts
         (id, graph_id, document_id, document_title, document_source_name,
          section_position, source_locator, source_start_offset, source_end_offset,
          source_quote, name, description, origin, source_model, status, accepted_node_id,
          created_at, updated_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AI', ?, 'PENDING', NULL, ?, ?, NULL)`,
      );
      for (const concept of input.concepts) {
        const source = sources.get(concept.sectionPosition) as SourceRow;
        const characters = unicodeCodePoints(source.content);
        if (concept.sourceEndOffset > characters.length) throw new Error('AI 候选项的原文位置已失效');
        const sourceQuote = characters.slice(concept.sourceStartOffset, concept.sourceEndOffset).join('');
        if (!sourceQuote.trim() || unicodeCodePoints(sourceQuote).length > 2_000) {
          throw new Error('AI 候选项的原文依据无效');
        }
        const id = randomUUID();
        candidateIds.push(id);
        insertConcept.run(
          id, input.graphId, input.documentId, source.document_title, source.source_name,
          concept.sectionPosition, source.locator, concept.sourceStartOffset, concept.sourceEndOffset,
          sourceQuote, concept.name, concept.description, input.model, now, now,
        );
      }
      const seenRelationships = new Set<string>();
      const insertRelationship = this.database.prepare(
        `INSERT INTO candidate_relationships
         (id, graph_id, source_candidate_id, target_candidate_id, relationship,
          status, accepted_edge_id, created_at, updated_at, reviewed_at)
         VALUES (?, ?, ?, ?, 'PREREQUISITE', 'PENDING', NULL, ?, ?, NULL)`,
      );
      for (const relationship of input.relationships) {
        const sourceId = candidateIds[relationship.sourceIndex];
        const targetId = candidateIds[relationship.targetIndex];
        if (!sourceId || !targetId || sourceId === targetId) throw new Error('AI 候选关系引用了无效概念');
        const pair = `${sourceId}:${targetId}`;
        if (seenRelationships.has(pair)) throw new Error('AI 返回了重复的候选关系');
        seenRelationships.add(pair);
        insertRelationship.run(randomUUID(), input.graphId, sourceId, targetId, now, now);
      }
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    return this.workspace(input.graphId);
  }

  updateConcept(input: UpdateCandidateConceptInput): CandidateWorkspaceView {
    const now = new Date().toISOString();
    const row = this.database.prepare(
      `UPDATE candidate_concepts SET name = ?, description = ?, updated_at = ?, reviewed_at = ?
       WHERE id = ? AND status = 'PENDING'
       RETURNING graph_id`,
    ).get(input.name, input.description, now, now, input.candidateId) as { graph_id: string } | undefined;
    if (!row) throw new Error('只有待审核的候选概念可以编辑');
    return this.workspace(row.graph_id);
  }

  reviewConcept(candidateId: string, status: 'PENDING' | 'IGNORED'): CandidateWorkspaceView {
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const row = this.database.prepare(
        `UPDATE candidate_concepts
         SET status = ?, updated_at = ?, reviewed_at = ?
         WHERE id = ? AND status <> 'ACCEPTED'
         RETURNING graph_id`,
      ).get(status, now, now, candidateId) as { graph_id: string } | undefined;
      if (!row) throw new Error('已写入图谱的候选概念不能更改审核状态');
      if (status === 'IGNORED') {
        this.database.prepare(
          `UPDATE candidate_relationships
           SET status = 'IGNORED', updated_at = ?, reviewed_at = ?
           WHERE status = 'PENDING' AND (source_candidate_id = ? OR target_candidate_id = ?)`,
        ).run(now, now, candidateId, candidateId);
      }
      this.database.exec('COMMIT;');
      return this.workspace(row.graph_id);
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  createRelationship(input: CreateCandidateRelationshipInput): CandidateWorkspaceView {
    const endpoints = this.database.prepare(
      `SELECT id, graph_id, status FROM candidate_concepts WHERE id IN (?, ?)`,
    ).all(input.sourceCandidateId, input.targetCandidateId) as unknown as Array<{
      id: string; graph_id: string; status: CandidateStatus;
    }>;
    if (endpoints.length !== 2 || endpoints.some((item) => item.graph_id !== input.graphId)) {
      throw new Error('候选关系的概念不属于当前图谱');
    }
    if (endpoints.some((item) => item.status !== 'PENDING')) throw new Error('只能连接待审核的候选概念');
    const current = this.workspace(input.graphId).relationships.filter((item) => item.status === 'PENDING');
    if (hasDirectedCycle([
      ...current.map((item) => ({ sourceNodeId: item.sourceCandidateId, targetNodeId: item.targetCandidateId })),
      { sourceNodeId: input.sourceCandidateId, targetNodeId: input.targetCandidateId },
    ])) throw new Error('这条先修关系会形成循环');
    const now = new Date().toISOString();
    const existing = this.database.prepare(
      `SELECT id, status FROM candidate_relationships
       WHERE graph_id = ? AND source_candidate_id = ? AND target_candidate_id = ?
         AND relationship = 'PREREQUISITE'`,
    ).get(input.graphId, input.sourceCandidateId, input.targetCandidateId) as {
      id: string; status: CandidateStatus;
    } | undefined;
    if (existing) {
      if (existing.status !== 'IGNORED') throw new Error('这条候选先修关系已经存在');
      this.database.prepare(
        `UPDATE candidate_relationships
         SET status = 'PENDING', updated_at = ?, reviewed_at = NULL
         WHERE id = ?`,
      ).run(now, existing.id);
      return this.workspace(input.graphId);
    }
    try {
      this.database.prepare(
        `INSERT INTO candidate_relationships
         (id, graph_id, source_candidate_id, target_candidate_id, relationship,
          status, accepted_edge_id, created_at, updated_at, reviewed_at)
         VALUES (?, ?, ?, ?, 'PREREQUISITE', 'PENDING', NULL, ?, ?, NULL)`,
      ).run(randomUUID(), input.graphId, input.sourceCandidateId, input.targetCandidateId, now, now);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) {
        throw new Error('这条候选先修关系已经存在', { cause: error });
      }
      throw error;
    }
    return this.workspace(input.graphId);
  }

  deleteRelationship(relationshipId: string): CandidateWorkspaceView {
    const row = this.database.prepare(
      `DELETE FROM candidate_relationships
       WHERE id = ? AND status <> 'ACCEPTED'
       RETURNING graph_id`,
    ).get(relationshipId) as { graph_id: string } | undefined;
    if (!row) throw new Error('已写入图谱的候选关系不能删除');
    return this.workspace(row.graph_id);
  }

  apply(graphId: string): ApplyCandidateWorkspaceResult {
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      if (!this.graphExists(graphId)) throw new Error('目标知识图谱不存在');
      const workspace = this.workspace(graphId);
      if (!workspace.pendingConceptCount) throw new Error('没有待写入的候选概念');
      if (workspace.blockingIssues[0]) throw new Error(`候选图谱暂时不能写入：${workspace.blockingIssues[0]}`);
      const pending = workspace.concepts.filter((concept) => concept.status === 'PENDING');
      const pendingIds = new Set(pending.map((concept) => concept.id));
      const relationships = workspace.relationships.filter((relationship) => (
        relationship.status === 'PENDING'
        && pendingIds.has(relationship.sourceCandidateId)
        && pendingIds.has(relationship.targetCandidateId)
      ));
      const now = new Date().toISOString();
      const existingPositions = (this.database.prepare(
        'SELECT position_x AS x, position_y AS y FROM knowledge_nodes WHERE graph_id = ?',
      ).all(graphId) as unknown as Array<{ x: number; y: number }>).map((item) => ({
        x: Number(item.x), y: Number(item.y),
      }));
      const nodeIds = new Map<string, string>();
      const insertNode = this.database.prepare(
        `INSERT INTO knowledge_nodes
         (id, graph_id, name, description, position_x, position_y, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      pending.forEach((concept, index) => {
        const nodeId = randomUUID();
        const position = nextPosition(existingPositions, index);
        existingPositions.push(position);
        insertNode.run(nodeId, graphId, concept.name, concept.description, position.x, position.y, now, now);
        nodeIds.set(concept.id, nodeId);
        this.database.prepare(
          `UPDATE candidate_concepts
           SET status = 'ACCEPTED', accepted_node_id = ?, updated_at = ?, reviewed_at = ?
           WHERE id = ?`,
        ).run(nodeId, now, now, concept.id);
      });
      const insertEdge = this.database.prepare(
        `INSERT INTO knowledge_edges
         (id, graph_id, source_node_id, target_node_id, relationship, created_at)
         VALUES (?, ?, ?, ?, 'PREREQUISITE', ?)`,
      );
      for (const relationship of relationships) {
        const edgeId = randomUUID();
        insertEdge.run(
          edgeId, graphId,
          nodeIds.get(relationship.sourceCandidateId) as string,
          nodeIds.get(relationship.targetCandidateId) as string,
          now,
        );
        this.database.prepare(
          `UPDATE candidate_relationships
           SET status = 'ACCEPTED', accepted_edge_id = ?, updated_at = ?, reviewed_at = ?
           WHERE id = ?`,
        ).run(edgeId, now, now, relationship.id);
      }
      this.database.prepare('UPDATE knowledge_graphs SET updated_at = ? WHERE id = ?').run(now, graphId);
      this.database.exec('COMMIT;');
      return {
        graph: this.graphRepository.load(graphId) as ApplyCandidateWorkspaceResult['graph'],
        acceptedConceptCount: pending.length,
        acceptedRelationshipCount: relationships.length,
      };
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }
}
