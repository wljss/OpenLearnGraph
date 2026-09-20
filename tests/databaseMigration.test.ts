// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/database/database';
import { GraphRepository } from '../src/main/repositories/graphRepository';

describe('database migrations', () => {
  it('upgrades an existing M1 database without losing its graph', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-migration-'));
    const filePath = join(directory, 'graph.sqlite3');
    const graphId = '11111111-1111-4111-8111-111111111111';
    const nodeId = '22222222-2222-4222-8222-222222222222';
    let upgraded: ReturnType<typeof openDatabase> | null = null;
    try {
      const oldDatabase = openDatabase(filePath);
      oldDatabase.prepare(
        'INSERT INTO knowledge_graphs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run(graphId, '旧版图谱', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      oldDatabase.prepare(
        `INSERT INTO knowledge_nodes
         (id, graph_id, name, description, position_x, position_y, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(nodeId, graphId, '旧版概念', '', 10, 20, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      oldDatabase.exec(`
        DROP TABLE ai_generation_runs;
        DROP TABLE candidate_relationships;
        DROP TABLE candidate_concepts;
        DROP TABLE imported_document_sections;
        DROP TABLE imported_documents;
        DROP TABLE learner_node_states;
        DROP TABLE learning_evidence;
        DROP TABLE practice_responses;
        DROP TABLE practice_attempt_questions;
        DROP TABLE practice_attempts;
        DROP TABLE learning_sessions;
        DROP TABLE tutor_decisions;
        ALTER TABLE assessment_questions DROP COLUMN purpose;
        PRAGMA user_version = 1;
      `);
      oldDatabase.close();

      upgraded = openDatabase(filePath);
      const version = upgraded.prepare('PRAGMA user_version').get() as { user_version: number };
      const restored = new GraphRepository(upgraded).load(graphId);
      expect(version.user_version).toBe(9);
      expect(upgraded.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tutor_decisions'",
      ).get()).toBeTruthy();
      expect(upgraded.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'learning_sessions'",
      ).get()).toBeTruthy();
      expect(upgraded.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'practice_attempts'",
      ).get()).toBeTruthy();
      expect(upgraded.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'imported_documents'",
      ).get()).toBeTruthy();
      expect(upgraded.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'candidate_concepts'",
      ).get()).toBeTruthy();
      expect(upgraded.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_generation_runs'",
      ).get()).toBeTruthy();
      expect(upgraded.prepare("SELECT name FROM pragma_table_info('candidate_concepts') WHERE name = 'origin'").get()).toBeTruthy();
      expect(restored?.nodes[0]).toMatchObject({ name: '旧版概念', status: 'AVAILABLE', evidenceCount: 0 });
    } finally {
      upgraded?.close();
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it('upgrades an M2 database while preserving existing learning evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-migration-m2-'));
    const filePath = join(directory, 'graph.sqlite3');
    const graphId = '44444444-4444-4444-8444-444444444444';
    const nodeId = '55555555-5555-4555-8555-555555555555';
    const evidenceId = '66666666-6666-4666-8666-666666666666';
    const occurredAt = '2026-01-02T00:00:00.000Z';
    let upgraded: ReturnType<typeof openDatabase> | null = null;
    try {
      const oldDatabase = openDatabase(filePath);
      oldDatabase.prepare(
        'INSERT INTO knowledge_graphs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run(graphId, 'M2 图谱', occurredAt, occurredAt);
      oldDatabase.prepare(
        `INSERT INTO knowledge_nodes
         (id, graph_id, name, description, position_x, position_y, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(nodeId, graphId, 'M2 概念', '', 10, 20, occurredAt, occurredAt);
      oldDatabase.exec(`
        DROP TABLE ai_generation_runs;
        DROP TABLE candidate_relationships;
        DROP TABLE candidate_concepts;
        DROP TABLE imported_document_sections;
        DROP TABLE imported_documents;
        DROP TABLE learner_node_states;
        DROP TABLE learning_evidence;
        DROP TABLE practice_responses;
        DROP TABLE practice_attempt_questions;
        DROP TABLE practice_attempts;
        DROP TABLE learning_sessions;
        DROP TABLE tutor_decisions;
        DROP TABLE assessment_responses;
        DROP TABLE assessment_attempt_questions;
        DROP TABLE assessment_attempts;
        DROP TABLE assessment_options;
        DROP TABLE assessment_questions;
        CREATE TABLE learning_evidence (
          id TEXT PRIMARY KEY,
          node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('STUDY_STARTED', 'SELF_ASSESSMENT')),
          rating INTEGER,
          note TEXT NOT NULL DEFAULT '',
          occurred_at TEXT NOT NULL,
          CHECK ((kind = 'STUDY_STARTED' AND rating IS NULL) OR (kind = 'SELF_ASSESSMENT' AND rating BETWEEN 1 AND 5))
        ) STRICT;
        CREATE INDEX idx_learning_evidence_node_time ON learning_evidence(node_id, occurred_at DESC);
        CREATE TABLE learner_node_states (
          node_id TEXT PRIMARY KEY REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
          phase TEXT NOT NULL CHECK (phase IN ('NOT_STARTED', 'LEARNING', 'MASTERED')),
          started_at TEXT,
          mastered_at TEXT,
          updated_at TEXT NOT NULL,
          latest_evidence_id TEXT REFERENCES learning_evidence(id) ON DELETE SET NULL
        ) STRICT;
        PRAGMA user_version = 2;
      `);
      oldDatabase.prepare(
        `INSERT INTO learning_evidence (id, node_id, kind, rating, note, occurred_at)
         VALUES (?, ?, 'SELF_ASSESSMENT', 5, ?, ?)`,
      ).run(evidenceId, nodeId, '原有学习记录', occurredAt);
      oldDatabase.prepare(
        `INSERT INTO learner_node_states
         (node_id, phase, started_at, mastered_at, updated_at, latest_evidence_id)
         VALUES (?, 'MASTERED', ?, ?, ?, ?)`,
      ).run(nodeId, occurredAt, occurredAt, occurredAt, evidenceId);
      oldDatabase.close();

      upgraded = openDatabase(filePath);
      const version = upgraded.prepare('PRAGMA user_version').get() as { user_version: number };
      const restored = new GraphRepository(upgraded).load(graphId);
      const evidence = upgraded.prepare(
        `SELECT kind, rating, note, score_earned, score_possible, assessment_attempt_id, learning_session_id, practice_attempt_id
         FROM learning_evidence WHERE id = ?`,
      ).get(evidenceId);
      expect(version.user_version).toBe(9);
      expect(restored?.nodes[0]).toMatchObject({ status: 'MASTERED', evidenceCount: 1, diagnosticQuestionCount: 0 });
      expect(evidence).toMatchObject({
        kind: 'SELF_ASSESSMENT',
        rating: 5,
        note: '原有学习记录',
        score_earned: null,
        score_possible: null,
        assessment_attempt_id: null,
        learning_session_id: null,
        practice_attempt_id: null,
      });
    } finally {
      upgraded?.close();
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
