import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  NODE_STATUSES,
  type LearningEvidenceView,
  type LearningPhase,
  type LearningSessionAction,
  type LearningSessionPrerequisiteView,
  type LearningSessionView,
  type NodeStatus,
  type SaveLearningSessionDraftInput,
} from '../../shared/contracts';

interface SessionRow {
  id: string;
  graph_id: string;
  node_id: string | null;
  source_decision_id: string | null;
  action: LearningSessionAction;
  status: LearningSessionView['status'];
  node_name_snapshot: string;
  description_snapshot: string;
  prerequisites_json: string;
  notes: string;
  step_index: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface StateRow {
  phase: LearningPhase;
  started_at: string | null;
  mastered_at: string | null;
  latest_evidence_kind: string | null;
}

export interface NewLearningSessionData {
  graphId: string;
  nodeId: string;
  nodeName: string;
  description: string;
  prerequisites: LearningSessionPrerequisiteView[];
  action: LearningSessionAction;
  sourceDecisionId?: string;
}

function parsePrerequisites(value: string): LearningSessionPrerequisiteView[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const candidate = item as { nodeId?: unknown; nodeName?: unknown; status?: unknown };
    return typeof candidate.nodeId === 'string'
      && typeof candidate.nodeName === 'string'
      && typeof candidate.status === 'string'
      && NODE_STATUSES.includes(candidate.status as NodeStatus);
  })) throw new Error('学习会话中的先修概念快照已损坏');
  return parsed as LearningSessionPrerequisiteView[];
}

function toView(row: SessionRow): LearningSessionView {
  return {
    id: row.id,
    graphId: row.graph_id,
    nodeId: row.node_id,
    nodeName: row.node_name_snapshot,
    description: row.description_snapshot,
    prerequisites: parsePrerequisites(row.prerequisites_json),
    action: row.action,
    status: row.status,
    notes: row.notes,
    stepIndex: Number(row.step_index),
    sourceDecisionId: row.source_decision_id,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

const SELECT_COLUMNS = `id, graph_id, node_id, source_decision_id, action, status,
  node_name_snapshot, description_snapshot, prerequisites_json, notes,
  step_index, started_at, updated_at, completed_at`;

export class SessionRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(graphId: string, limit = 50): LearningSessionView[] {
    const rows = this.database.prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM learning_sessions
       WHERE graph_id = ?
       ORDER BY started_at DESC, rowid DESC
       LIMIT ?`,
    ).all(graphId, limit) as unknown as SessionRow[];
    return rows.map(toView);
  }

  find(sessionId: string): LearningSessionView | null {
    const row = this.database.prepare(
      `SELECT ${SELECT_COLUMNS} FROM learning_sessions WHERE id = ?`,
    ).get(sessionId) as SessionRow | undefined;
    return row ? toView(row) : null;
  }

  findActive(graphId: string): LearningSessionView | null {
    const row = this.database.prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM learning_sessions
       WHERE graph_id = ? AND status = 'IN_PROGRESS'
       LIMIT 1`,
    ).get(graphId) as SessionRow | undefined;
    return row ? toView(row) : null;
  }

  create(data: NewLearningSessionData): LearningSessionView {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO learning_sessions
       (id, graph_id, node_id, source_decision_id, action, status,
        node_name_snapshot, description_snapshot, prerequisites_json, notes,
        step_index, started_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?, '', 0, ?, ?, NULL)`,
    ).run(
      id,
      data.graphId,
      data.nodeId,
      data.sourceDecisionId ?? null,
      data.action,
      data.nodeName,
      data.description,
      JSON.stringify(data.prerequisites),
      now,
      now,
    );
    return this.find(id) as LearningSessionView;
  }

  saveDraft(input: SaveLearningSessionDraftInput): LearningSessionView {
    const update = this.database.prepare(
      `UPDATE learning_sessions
       SET notes = ?, step_index = ?, updated_at = ?
       WHERE id = ? AND status = 'IN_PROGRESS'`,
    ).run(input.notes, input.stepIndex, new Date().toISOString(), input.sessionId);
    if (Number(update.changes) !== 1) throw new Error('这次学习会话已经结束，无法继续保存');
    return this.find(input.sessionId) as LearningSessionView;
  }

  cancel(sessionId: string): LearningSessionView {
    const now = new Date().toISOString();
    const update = this.database.prepare(
      `UPDATE learning_sessions
       SET status = 'CANCELLED', updated_at = ?, completed_at = ?
       WHERE id = ? AND status = 'IN_PROGRESS'`,
    ).run(now, now, sessionId);
    if (Number(update.changes) !== 1) throw new Error('这次学习会话已经结束，无法放弃');
    return this.find(sessionId) as LearningSessionView;
  }

  complete(sessionId: string, notes: string): {
    session: LearningSessionView;
    evidence: LearningEvidenceView;
  } {
    const session = this.find(sessionId);
    if (!session || session.status !== 'IN_PROGRESS' || !session.nodeId) {
      throw new Error('这次学习会话已无法完成');
    }
    const evidenceId = randomUUID();
    const now = new Date().toISOString();

    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const state = this.database.prepare(
        `SELECT s.phase, s.started_at, s.mastered_at, e.kind AS latest_evidence_kind
         FROM learner_node_states s
         LEFT JOIN learning_evidence e ON e.id = s.latest_evidence_id
         WHERE s.node_id = ?`,
      ).get(session.nodeId) as StateRow | undefined;

      this.database.prepare(
        `INSERT INTO learning_evidence
         (id, node_id, kind, rating, score_earned, score_possible,
          assessment_attempt_id, learning_session_id, note, occurred_at)
         VALUES (?, ?, 'LEARNING_SESSION_COMPLETED', NULL, NULL, NULL, NULL, ?, ?, ?)`,
      ).run(evidenceId, session.nodeId, session.id, notes, now);

      const preservesMastery = state?.phase === 'MASTERED';
      const preservesDiagnostic = state?.latest_evidence_kind === 'DIAGNOSTIC_RESULT';
      if (!preservesMastery && !preservesDiagnostic) {
        this.database.prepare(
          `INSERT INTO learner_node_states
           (node_id, phase, started_at, mastered_at, updated_at, latest_evidence_id)
           VALUES (?, 'LEARNING', ?, NULL, ?, ?)
           ON CONFLICT(node_id) DO UPDATE SET
             phase = 'LEARNING',
             started_at = COALESCE(learner_node_states.started_at, excluded.started_at),
             mastered_at = NULL,
             updated_at = excluded.updated_at,
             latest_evidence_id = excluded.latest_evidence_id`,
        ).run(session.nodeId, state?.started_at ?? now, now, evidenceId);
      }

      const update = this.database.prepare(
        `UPDATE learning_sessions
         SET status = 'COMPLETED', notes = ?, step_index = 2,
             updated_at = ?, completed_at = ?
         WHERE id = ? AND status = 'IN_PROGRESS'`,
      ).run(notes, now, now, sessionId);
      if (Number(update.changes) !== 1) throw new Error('学习会话状态已发生变化，请勿重复完成');
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }

    return {
      session: this.find(sessionId) as LearningSessionView,
      evidence: {
        id: evidenceId,
        nodeId: session.nodeId,
        kind: 'LEARNING_SESSION_COMPLETED',
        rating: null,
        note: notes,
        occurredAt: now,
        scoreEarned: null,
        scorePossible: null,
        assessmentAttemptId: null,
        learningSessionId: session.id,
        practiceAttemptId: null,
      },
    };
  }
}
