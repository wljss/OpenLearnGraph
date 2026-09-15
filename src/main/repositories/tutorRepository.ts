import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  TUTOR_ACTIONS,
  TUTOR_DECISION_RESPONSES,
  TUTOR_REASON_CODES,
  type TutorDecisionContext,
  type TutorDecisionResponse,
  type TutorDecisionView,
} from '../../shared/contracts';
import type { TutorPlan } from '../../shared/tutorPlanner';

interface TutorDecisionRow {
  id: string;
  graph_id: string;
  target_node_id: string | null;
  target_node_name: string;
  action: TutorDecisionView['action'];
  reason_code: TutorDecisionView['reasonCode'];
  reason: string;
  evidence_json: string;
  context_json: string;
  response: TutorDecisionResponse;
  is_stale: number;
  source_version: number;
  created_at: string;
  updated_at: string;
  state_fingerprint: string;
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('学习建议中的依据数据已损坏');
  }
  return parsed;
}

function parseContext(value: string): TutorDecisionContext {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('学习建议中的上下文数据已损坏');
  }
  const attemptId = (parsed as { attemptId?: unknown }).attemptId;
  if (attemptId !== undefined && typeof attemptId !== 'string') {
    throw new Error('学习建议中的诊断上下文已损坏');
  }
  return attemptId === undefined ? {} : { attemptId };
}

function toView(row: TutorDecisionRow): TutorDecisionView {
  if (!TUTOR_ACTIONS.includes(row.action)
    || !TUTOR_REASON_CODES.includes(row.reason_code)
    || !TUTOR_DECISION_RESPONSES.includes(row.response)) {
    throw new Error('学习建议中包含无法识别的状态');
  }
  return {
    id: row.id,
    graphId: row.graph_id,
    targetNodeId: row.target_node_id,
    targetNodeName: row.target_node_name,
    action: row.action,
    reasonCode: row.reason_code,
    reason: row.reason,
    evidence: parseStringArray(row.evidence_json),
    context: parseContext(row.context_json),
    response: row.response,
    isStale: Boolean(row.is_stale),
    sourceVersion: Number(row.source_version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `id, graph_id, target_node_id, target_node_name, action,
  reason_code, reason, evidence_json, context_json, response, is_stale,
  source_version, created_at, updated_at, state_fingerprint`;

export class TutorRepository {
  constructor(private readonly database: DatabaseSync) {}

  markOtherStatesStale(graphId: string, stateFingerprint: string): void {
    const now = new Date().toISOString();
    this.database.prepare(
      `UPDATE tutor_decisions
       SET is_stale = 1, updated_at = ?
       WHERE graph_id = ? AND is_stale = 0 AND state_fingerprint <> ?`,
    ).run(now, graphId, stateFingerprint);
  }

  findCurrentByFingerprint(graphId: string, stateFingerprint: string): TutorDecisionView | null {
    const row = this.database.prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM tutor_decisions
       WHERE graph_id = ? AND state_fingerprint = ? AND is_stale = 0
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
    ).get(graphId, stateFingerprint) as TutorDecisionRow | undefined;
    return row ? toView(row) : null;
  }

  create(graphId: string, stateFingerprint: string, plan: TutorPlan): TutorDecisionView {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO tutor_decisions
       (id, graph_id, target_node_id, target_node_name, action, reason_code,
        reason, evidence_json, context_json, state_fingerprint, response,
        is_stale, source_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, 1, ?, ?)`,
    ).run(
      id,
      graphId,
      plan.targetNodeId,
      plan.targetNodeName,
      plan.action,
      plan.reasonCode,
      plan.reason,
      JSON.stringify(plan.evidence),
      JSON.stringify(plan.context),
      stateFingerprint,
      now,
      now,
    );
    return this.find(id) as TutorDecisionView;
  }

  find(decisionId: string): TutorDecisionView | null {
    const row = this.database.prepare(
      `SELECT ${SELECT_COLUMNS} FROM tutor_decisions WHERE id = ?`,
    ).get(decisionId) as TutorDecisionRow | undefined;
    return row ? toView(row) : null;
  }

  getStateFingerprint(decisionId: string): string | null {
    const row = this.database.prepare(
      'SELECT state_fingerprint FROM tutor_decisions WHERE id = ?',
    ).get(decisionId) as { state_fingerprint: string } | undefined;
    return row?.state_fingerprint ?? null;
  }

  list(graphId: string, limit = 50): TutorDecisionView[] {
    const rows = this.database.prepare(
      `SELECT ${SELECT_COLUMNS}
       FROM tutor_decisions
       WHERE graph_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
    ).all(graphId, limit) as unknown as TutorDecisionRow[];
    return rows.map(toView);
  }

  respond(decisionId: string, response: TutorDecisionResponse): TutorDecisionView {
    const now = new Date().toISOString();
    const update = this.database.prepare(
      `UPDATE tutor_decisions SET response = ?, updated_at = ?
       WHERE id = ? AND is_stale = 0`,
    ).run(response, now, decisionId);
    if (Number(update.changes) !== 1) throw new Error('这条学习建议已失效，请查看最新建议');
    return this.find(decisionId) as TutorDecisionView;
  }

  markStale(decisionId: string): void {
    this.database.prepare(
      'UPDATE tutor_decisions SET is_stale = 1, updated_at = ? WHERE id = ?',
    ).run(new Date().toISOString(), decisionId);
  }
}
