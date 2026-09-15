import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  EvidenceKind,
  LearningEvidenceView,
  LearningPhase,
  RecordLearningEvidenceInput,
  SelfAssessmentRating,
} from '../../shared/contracts';

interface EvidenceRow {
  id: string;
  node_id: string;
  kind: EvidenceKind;
  rating: number | null;
  note: string;
  occurred_at: string;
  score_earned: number | null;
  score_possible: number | null;
  assessment_attempt_id: string | null;
}

interface StateRow {
  phase: LearningPhase;
  started_at: string | null;
  mastered_at: string | null;
  latest_evidence_id: string | null;
  latest_evidence_kind: 'STUDY_STARTED' | 'SELF_ASSESSMENT' | 'DIAGNOSTIC_RESULT' | null;
}

function toView(row: EvidenceRow): LearningEvidenceView {
  return {
    id: row.id,
    nodeId: row.node_id,
    kind: row.kind,
    rating: row.rating as SelfAssessmentRating | null,
    note: row.note,
    occurredAt: row.occurred_at,
    scoreEarned: row.score_earned,
    scorePossible: row.score_possible,
    assessmentAttemptId: row.assessment_attempt_id,
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
      `SELECT id, node_id, kind, rating, note, occurred_at,
              score_earned, score_possible, assessment_attempt_id
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
        `SELECT s.phase, s.started_at, s.mastered_at, s.latest_evidence_id,
                e.kind AS latest_evidence_kind
         FROM learner_node_states s
         LEFT JOIN learning_evidence e ON e.id = s.latest_evidence_id
         WHERE s.node_id = ?`,
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
      if (existingState?.latest_evidence_kind !== 'DIAGNOSTIC_RESULT') {
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
      }
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
      scoreEarned: null,
      scorePossible: null,
      assessmentAttemptId: null,
    };
  }
}
