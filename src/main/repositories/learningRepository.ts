import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  LearningEvidenceView,
  LearningPhase,
  RecordLearningEvidenceInput,
  SelfAssessmentRating,
} from '../../shared/contracts';

interface EvidenceRow {
  id: string;
  node_id: string;
  kind: 'STUDY_STARTED' | 'SELF_ASSESSMENT';
  rating: number | null;
  note: string;
  occurred_at: string;
}

interface StateRow {
  phase: LearningPhase;
  started_at: string | null;
  mastered_at: string | null;
}

function toView(row: EvidenceRow): LearningEvidenceView {
  return {
    id: row.id,
    nodeId: row.node_id,
    kind: row.kind,
    rating: row.rating as SelfAssessmentRating | null,
    note: row.note,
    occurredAt: row.occurred_at,
  };
}

export class LearningRepository {
  constructor(private readonly database: DatabaseSync) {}

  findGraphIdForNode(nodeId: string): string | null {
    const row = this.database.prepare(
      'SELECT graph_id FROM knowledge_nodes WHERE id = ?',
    ).get(nodeId) as { graph_id: string } | undefined;
    return row?.graph_id ?? null;
  }

  listEvidence(nodeId: string): LearningEvidenceView[] {
    const rows = this.database.prepare(
      `SELECT id, node_id, kind, rating, note, occurred_at
       FROM learning_evidence
       WHERE node_id = ?
       ORDER BY occurred_at DESC, rowid DESC`,
    ).all(nodeId) as unknown as EvidenceRow[];
    return rows.map(toView);
  }

  recordEvidence(input: RecordLearningEvidenceInput): LearningEvidenceView {
    const id = randomUUID();
    const now = new Date().toISOString();
    const rating = input.kind === 'SELF_ASSESSMENT' ? input.rating : null;
    const note = input.kind === 'SELF_ASSESSMENT' ? input.note : '';

    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const existingState = this.database.prepare(
        'SELECT phase, started_at, mastered_at FROM learner_node_states WHERE node_id = ?',
      ).get(input.nodeId) as StateRow | undefined;
      const phase: LearningPhase = input.kind === 'SELF_ASSESSMENT'
        ? (input.rating >= 4 ? 'MASTERED' : 'LEARNING')
        : (existingState?.phase === 'MASTERED' ? 'MASTERED' : 'LEARNING');
      const startedAt = existingState?.started_at ?? now;
      const masteredAt = phase === 'MASTERED'
        ? (existingState?.phase === 'MASTERED' ? existingState.mastered_at ?? now : now)
        : null;

      this.database.prepare(
        `INSERT INTO learning_evidence (id, node_id, kind, rating, note, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, input.nodeId, input.kind, rating, note, now);
      this.database.prepare(
        `INSERT INTO learner_node_states
         (node_id, phase, started_at, mastered_at, updated_at, latest_evidence_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET
           phase = excluded.phase,
           started_at = COALESCE(learner_node_states.started_at, excluded.started_at),
           mastered_at = excluded.mastered_at,
           updated_at = excluded.updated_at,
           latest_evidence_id = excluded.latest_evidence_id`,
      ).run(input.nodeId, phase, startedAt, masteredAt, now, id);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }

    return {
      id,
      nodeId: input.nodeId,
      kind: input.kind,
      rating: rating as SelfAssessmentRating | null,
      note,
      occurredAt: now,
    };
  }
}
