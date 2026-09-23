import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATION_1 = `
  CREATE TABLE IF NOT EXISTS knowledge_graphs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT NOT NULL DEFAULT '',
    position_x REAL NOT NULL,
    position_y REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_graph ON knowledge_nodes(graph_id);
  CREATE TABLE IF NOT EXISTS knowledge_edges (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    target_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL CHECK (relationship = 'PREREQUISITE'),
    created_at TEXT NOT NULL,
    CHECK (source_node_id <> target_node_id),
    UNIQUE (graph_id, source_node_id, target_node_id, relationship)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_knowledge_edges_graph ON knowledge_edges(graph_id);
`;

const MIGRATION_2 = `
  CREATE TABLE IF NOT EXISTS learning_evidence (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('STUDY_STARTED', 'SELF_ASSESSMENT')),
    rating INTEGER,
    note TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL,
    CHECK (
      (kind = 'STUDY_STARTED' AND rating IS NULL)
      OR (kind = 'SELF_ASSESSMENT' AND rating BETWEEN 1 AND 5)
    )
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_learning_evidence_node_time
    ON learning_evidence(node_id, occurred_at DESC);

  CREATE TABLE IF NOT EXISTS learner_node_states (
    node_id TEXT PRIMARY KEY REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    phase TEXT NOT NULL CHECK (phase IN ('NOT_STARTED', 'LEARNING', 'MASTERED')),
    started_at TEXT,
    mastered_at TEXT,
    updated_at TEXT NOT NULL,
    latest_evidence_id TEXT REFERENCES learning_evidence(id) ON DELETE SET NULL
  ) STRICT;
`;

const MIGRATION_3 = `
  CREATE TABLE IF NOT EXISTS assessment_questions (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL CHECK (length(trim(prompt)) > 0),
    explanation TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_assessment_questions_node
    ON assessment_questions(node_id, created_at);

  CREATE TABLE IF NOT EXISTS assessment_options (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES assessment_questions(id) ON DELETE CASCADE,
    text TEXT NOT NULL CHECK (length(trim(text)) > 0),
    is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
    position INTEGER NOT NULL CHECK (position >= 0),
    UNIQUE (question_id, position)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_assessment_options_question
    ON assessment_options(question_id, position);

  CREATE TABLE IF NOT EXISTS assessment_attempts (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind = 'DIAGNOSTIC'),
    status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    started_at TEXT NOT NULL,
    completed_at TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_assessment_attempts_graph_time
    ON assessment_attempts(graph_id, started_at DESC);

  CREATE TABLE IF NOT EXISTS assessment_attempt_questions (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
    question_id TEXT REFERENCES assessment_questions(id) ON DELETE SET NULL,
    node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    node_name_snapshot TEXT NOT NULL,
    prompt_snapshot TEXT NOT NULL,
    explanation_snapshot TEXT NOT NULL DEFAULT '',
    options_snapshot TEXT NOT NULL CHECK (json_valid(options_snapshot)),
    UNIQUE (attempt_id, position)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_attempt_questions_attempt
    ON assessment_attempt_questions(attempt_id, position);

  CREATE TABLE IF NOT EXISTS assessment_responses (
    id TEXT PRIMARY KEY,
    attempt_question_id TEXT NOT NULL UNIQUE REFERENCES assessment_attempt_questions(id) ON DELETE CASCADE,
    selected_option_id TEXT,
    is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
    answered_at TEXT NOT NULL
  ) STRICT;

  ALTER TABLE learning_evidence RENAME TO learning_evidence_m2;
  DROP INDEX IF EXISTS idx_learning_evidence_node_time;
  ALTER TABLE learner_node_states RENAME TO learner_node_states_m2;

  CREATE TABLE learning_evidence (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('STUDY_STARTED', 'SELF_ASSESSMENT', 'DIAGNOSTIC_RESULT')),
    rating INTEGER,
    score_earned INTEGER,
    score_possible INTEGER,
    assessment_attempt_id TEXT REFERENCES assessment_attempts(id) ON DELETE CASCADE,
    note TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL,
    CHECK (
      (kind = 'STUDY_STARTED' AND rating IS NULL AND score_earned IS NULL AND score_possible IS NULL AND assessment_attempt_id IS NULL)
      OR (kind = 'SELF_ASSESSMENT' AND rating BETWEEN 1 AND 5 AND score_earned IS NULL AND score_possible IS NULL AND assessment_attempt_id IS NULL)
      OR (kind = 'DIAGNOSTIC_RESULT' AND rating IS NULL AND score_earned >= 0 AND score_possible >= 1 AND score_earned <= score_possible AND assessment_attempt_id IS NOT NULL)
    )
  ) STRICT;
  INSERT INTO learning_evidence
    (id, node_id, kind, rating, score_earned, score_possible, assessment_attempt_id, note, occurred_at)
  SELECT id, node_id, kind, rating, NULL, NULL, NULL, note, occurred_at
  FROM learning_evidence_m2;
  CREATE INDEX idx_learning_evidence_node_time
    ON learning_evidence(node_id, occurred_at DESC);

  CREATE TABLE learner_node_states (
    node_id TEXT PRIMARY KEY REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    phase TEXT NOT NULL CHECK (phase IN ('NOT_STARTED', 'LEARNING', 'MASTERED')),
    started_at TEXT,
    mastered_at TEXT,
    updated_at TEXT NOT NULL,
    latest_evidence_id TEXT REFERENCES learning_evidence(id) ON DELETE SET NULL
  ) STRICT;
  INSERT INTO learner_node_states
    (node_id, phase, started_at, mastered_at, updated_at, latest_evidence_id)
  SELECT node_id, phase, started_at, mastered_at, updated_at, latest_evidence_id
  FROM learner_node_states_m2;

  DROP TABLE learner_node_states_m2;
  DROP TABLE learning_evidence_m2;
`;

const MIGRATION_4 = `
  CREATE TABLE IF NOT EXISTS tutor_decisions (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
    target_node_id TEXT REFERENCES knowledge_nodes(id) ON DELETE SET NULL,
    target_node_name TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('TEACH', 'ASSESS', 'PRACTICE', 'REVIEW', 'REMEDIATE', 'ADVANCE')),
    reason_code TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
    context_json TEXT NOT NULL CHECK (json_valid(context_json)),
    state_fingerprint TEXT NOT NULL,
    response TEXT NOT NULL CHECK (response IN ('PENDING', 'ACCEPTED', 'DISMISSED')),
    is_stale INTEGER NOT NULL DEFAULT 0 CHECK (is_stale IN (0, 1)),
    source_version INTEGER NOT NULL CHECK (source_version >= 1),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_tutor_decisions_graph_time
    ON tutor_decisions(graph_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tutor_decisions_graph_state
    ON tutor_decisions(graph_id, state_fingerprint, is_stale);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_decisions_current_state
    ON tutor_decisions(graph_id, state_fingerprint) WHERE is_stale = 0;
`;

const MIGRATION_5 = `
  CREATE TABLE IF NOT EXISTS learning_sessions (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
    node_id TEXT REFERENCES knowledge_nodes(id) ON DELETE SET NULL,
    source_decision_id TEXT REFERENCES tutor_decisions(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN ('TEACH', 'ADVANCE')),
    status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    node_name_snapshot TEXT NOT NULL CHECK (length(trim(node_name_snapshot)) > 0),
    description_snapshot TEXT NOT NULL,
    prerequisites_json TEXT NOT NULL CHECK (json_valid(prerequisites_json)),
    notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 5000),
    step_index INTEGER NOT NULL DEFAULT 0 CHECK (step_index BETWEEN 0 AND 2),
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS idx_learning_sessions_graph_time
    ON learning_sessions(graph_id, started_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_sessions_active_graph
    ON learning_sessions(graph_id) WHERE status = 'IN_PROGRESS';

  ALTER TABLE learning_evidence RENAME TO learning_evidence_m4;
  DROP INDEX IF EXISTS idx_learning_evidence_node_time;
  ALTER TABLE learner_node_states RENAME TO learner_node_states_m4;

  CREATE TABLE learning_evidence (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('STUDY_STARTED', 'SELF_ASSESSMENT', 'DIAGNOSTIC_RESULT', 'LEARNING_SESSION_COMPLETED')),
    rating INTEGER,
    score_earned INTEGER,
    score_possible INTEGER,
    assessment_attempt_id TEXT REFERENCES assessment_attempts(id) ON DELETE CASCADE,
    learning_session_id TEXT REFERENCES learning_sessions(id) ON DELETE CASCADE,
    note TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL,
    CHECK (
      (kind = 'STUDY_STARTED' AND rating IS NULL AND score_earned IS NULL AND score_possible IS NULL AND assessment_attempt_id IS NULL AND learning_session_id IS NULL)
      OR (kind = 'SELF_ASSESSMENT' AND rating BETWEEN 1 AND 5 AND score_earned IS NULL AND score_possible IS NULL AND assessment_attempt_id IS NULL AND learning_session_id IS NULL)
      OR (kind = 'DIAGNOSTIC_RESULT' AND rating IS NULL AND score_earned >= 0 AND score_possible >= 1 AND score_earned <= score_possible AND assessment_attempt_id IS NOT NULL AND learning_session_id IS NULL)
      OR (kind = 'LEARNING_SESSION_COMPLETED' AND rating IS NULL AND score_earned IS NULL AND score_possible IS NULL AND assessment_attempt_id IS NULL AND learning_session_id IS NOT NULL)
    )
  ) STRICT;
  INSERT INTO learning_evidence
    (id, node_id, kind, rating, score_earned, score_possible, assessment_attempt_id, learning_session_id, note, occurred_at)
  SELECT id, node_id, kind, rating, score_earned, score_possible, assessment_attempt_id, NULL, note, occurred_at
  FROM learning_evidence_m4;
  CREATE INDEX idx_learning_evidence_node_time
    ON learning_evidence(node_id, occurred_at DESC);

  CREATE TABLE learner_node_states (
    node_id TEXT PRIMARY KEY REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    phase TEXT NOT NULL CHECK (phase IN ('NOT_STARTED', 'LEARNING', 'MASTERED')),
    started_at TEXT,
    mastered_at TEXT,
    updated_at TEXT NOT NULL,
    latest_evidence_id TEXT REFERENCES learning_evidence(id) ON DELETE SET NULL
  ) STRICT;
  INSERT INTO learner_node_states
    (node_id, phase, started_at, mastered_at, updated_at, latest_evidence_id)
  SELECT node_id, phase, started_at, mastered_at, updated_at, latest_evidence_id
  FROM learner_node_states_m4;

  DROP TABLE learner_node_states_m4;
  DROP TABLE learning_evidence_m4;
`;

const MIGRATION_6 = `
  ALTER TABLE assessment_questions
    ADD COLUMN purpose TEXT NOT NULL DEFAULT 'DIAGNOSTIC'
    CHECK (purpose IN ('DIAGNOSTIC', 'PRACTICE', 'BOTH'));

  CREATE TABLE practice_attempts (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
    node_id TEXT REFERENCES knowledge_nodes(id) ON DELETE SET NULL,
    source_decision_id TEXT REFERENCES tutor_decisions(id) ON DELETE SET NULL,
    node_name_snapshot TEXT NOT NULL CHECK (length(trim(node_name_snapshot)) > 0),
    mode TEXT NOT NULL CHECK (mode IN ('PRACTICE', 'REMEDIATE', 'REVIEW')),
    status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  ) STRICT;
  CREATE INDEX idx_practice_attempts_graph_time
    ON practice_attempts(graph_id, started_at DESC);
  CREATE UNIQUE INDEX idx_practice_attempts_active_graph
    ON practice_attempts(graph_id) WHERE status = 'IN_PROGRESS';

  CREATE TABLE practice_attempt_questions (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES practice_attempts(id) ON DELETE CASCADE,
    question_id TEXT REFERENCES assessment_questions(id) ON DELETE SET NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    prompt_snapshot TEXT NOT NULL,
    explanation_snapshot TEXT NOT NULL DEFAULT '',
    options_snapshot TEXT NOT NULL CHECK (json_valid(options_snapshot)),
    UNIQUE (attempt_id, position)
  ) STRICT;
  CREATE INDEX idx_practice_questions_attempt
    ON practice_attempt_questions(attempt_id, position);

  CREATE TABLE practice_responses (
    id TEXT PRIMARY KEY,
    attempt_question_id TEXT NOT NULL UNIQUE REFERENCES practice_attempt_questions(id) ON DELETE CASCADE,
    selected_option_id TEXT,
    is_correct INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
    answered_at TEXT NOT NULL
  ) STRICT;

  ALTER TABLE learning_evidence RENAME TO learning_evidence_m5;
  DROP INDEX IF EXISTS idx_learning_evidence_node_time;
  ALTER TABLE learner_node_states RENAME TO learner_node_states_m5;

  CREATE TABLE learning_evidence (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('STUDY_STARTED', 'SELF_ASSESSMENT', 'DIAGNOSTIC_RESULT', 'LEARNING_SESSION_COMPLETED', 'PRACTICE_RESULT')),
    rating INTEGER,
    score_earned INTEGER,
    score_possible INTEGER,
    assessment_attempt_id TEXT REFERENCES assessment_attempts(id) ON DELETE CASCADE,
    learning_session_id TEXT REFERENCES learning_sessions(id) ON DELETE CASCADE,
    practice_attempt_id TEXT REFERENCES practice_attempts(id) ON DELETE CASCADE,
    note TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL,
    CHECK (
      (kind = 'STUDY_STARTED' AND rating IS NULL AND score_earned IS NULL AND score_possible IS NULL AND assessment_attempt_id IS NULL AND learning_session_id IS NULL AND practice_attempt_id IS NULL)
      OR (kind = 'SELF_ASSESSMENT' AND rating BETWEEN 1 AND 5 AND score_earned IS NULL AND score_possible IS NULL AND assessment_attempt_id IS NULL AND learning_session_id IS NULL AND practice_attempt_id IS NULL)
      OR (kind = 'DIAGNOSTIC_RESULT' AND rating IS NULL AND score_earned >= 0 AND score_possible >= 1 AND score_earned <= score_possible AND assessment_attempt_id IS NOT NULL AND learning_session_id IS NULL AND practice_attempt_id IS NULL)
      OR (kind = 'LEARNING_SESSION_COMPLETED' AND rating IS NULL AND score_earned IS NULL AND score_possible IS NULL AND assessment_attempt_id IS NULL AND learning_session_id IS NOT NULL AND practice_attempt_id IS NULL)
      OR (kind = 'PRACTICE_RESULT' AND rating IS NULL AND score_earned >= 0 AND score_possible >= 1 AND score_earned <= score_possible AND assessment_attempt_id IS NULL AND learning_session_id IS NULL AND practice_attempt_id IS NOT NULL)
    )
  ) STRICT;
  INSERT INTO learning_evidence
    (id, node_id, kind, rating, score_earned, score_possible, assessment_attempt_id,
     learning_session_id, practice_attempt_id, note, occurred_at)
  SELECT id, node_id, kind, rating, score_earned, score_possible, assessment_attempt_id,
         learning_session_id, NULL, note, occurred_at
  FROM learning_evidence_m5;
  CREATE INDEX idx_learning_evidence_node_time
    ON learning_evidence(node_id, occurred_at DESC);

  CREATE TABLE learner_node_states (
    node_id TEXT PRIMARY KEY REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    phase TEXT NOT NULL CHECK (phase IN ('NOT_STARTED', 'LEARNING', 'MASTERED')),
    started_at TEXT,
    mastered_at TEXT,
    updated_at TEXT NOT NULL,
    latest_evidence_id TEXT REFERENCES learning_evidence(id) ON DELETE SET NULL
  ) STRICT;
  INSERT INTO learner_node_states
    (node_id, phase, started_at, mastered_at, updated_at, latest_evidence_id)
  SELECT node_id, phase, started_at, mastered_at, updated_at, latest_evidence_id
  FROM learner_node_states_m5;

  DROP TABLE learner_node_states_m5;
  DROP TABLE learning_evidence_m5;
`;

const MIGRATION_7 = `
  CREATE TABLE imported_documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    author TEXT NOT NULL DEFAULT '',
    publisher TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    identifier TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL CHECK (format IN ('PDF', 'EPUB', 'TEXT', 'MARKDOWN')),
    source_name TEXT NOT NULL CHECK (length(trim(source_name)) > 0),
    source_path TEXT NOT NULL CHECK (length(trim(source_path)) > 0),
    source_size INTEGER NOT NULL CHECK (source_size > 0),
    source_modified_at TEXT NOT NULL,
    sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
    encoding TEXT,
    page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
    section_count INTEGER NOT NULL CHECK (section_count > 0),
    char_count INTEGER NOT NULL CHECK (char_count > 0),
    warnings_json TEXT NOT NULL CHECK (json_valid(warnings_json)),
    imported_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX idx_imported_documents_time
    ON imported_documents(imported_at DESC);

  CREATE TABLE imported_document_sections (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES imported_documents(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    heading TEXT NOT NULL,
    locator TEXT NOT NULL,
    content TEXT NOT NULL CHECK (length(content) > 0),
    char_count INTEGER NOT NULL CHECK (char_count > 0),
    UNIQUE (document_id, position)
  ) STRICT;
  CREATE INDEX idx_imported_document_sections_document
    ON imported_document_sections(document_id, position);
`;

const MIGRATION_8 = `
  CREATE TABLE candidate_concepts (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES imported_documents(id) ON DELETE SET NULL,
    document_title TEXT NOT NULL CHECK (length(trim(document_title)) > 0),
    document_source_name TEXT NOT NULL CHECK (length(trim(document_source_name)) > 0),
    section_position INTEGER NOT NULL CHECK (section_position >= 0),
    source_locator TEXT NOT NULL,
    source_start_offset INTEGER NOT NULL CHECK (source_start_offset >= 0),
    source_end_offset INTEGER NOT NULL CHECK (source_end_offset > source_start_offset),
    source_quote TEXT NOT NULL CHECK (length(source_quote) BETWEEN 1 AND 2000),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'IGNORED')),
    accepted_node_id TEXT REFERENCES knowledge_nodes(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    reviewed_at TEXT
  ) STRICT;
  CREATE INDEX idx_candidate_concepts_graph_status
    ON candidate_concepts(graph_id, status, created_at);
  CREATE INDEX idx_candidate_concepts_document
    ON candidate_concepts(document_id, section_position);

  CREATE TABLE candidate_relationships (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
    source_candidate_id TEXT NOT NULL REFERENCES candidate_concepts(id) ON DELETE CASCADE,
    target_candidate_id TEXT NOT NULL REFERENCES candidate_concepts(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL CHECK (relationship = 'PREREQUISITE'),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'IGNORED')),
    accepted_edge_id TEXT REFERENCES knowledge_edges(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    reviewed_at TEXT,
    CHECK (source_candidate_id <> target_candidate_id),
    UNIQUE (graph_id, source_candidate_id, target_candidate_id, relationship)
  ) STRICT;
  CREATE INDEX idx_candidate_relationships_graph_status
    ON candidate_relationships(graph_id, status, created_at);
`;

const MIGRATION_9 = `
  CREATE TABLE ai_generation_runs (
    id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL REFERENCES knowledge_graphs(id) ON DELETE CASCADE,
    document_id TEXT REFERENCES imported_documents(id) ON DELETE SET NULL,
    document_title TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider = 'DEEPSEEK'),
    model TEXT NOT NULL,
    section_positions_json TEXT NOT NULL CHECK (json_valid(section_positions_json)),
    source_char_count INTEGER NOT NULL CHECK (source_char_count > 0),
    status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    prompt_tokens INTEGER CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
    completion_tokens INTEGER CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
    concept_count INTEGER CHECK (concept_count IS NULL OR concept_count >= 0),
    relationship_count INTEGER CHECK (relationship_count IS NULL OR relationship_count >= 0),
    error_message TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  ) STRICT;
  CREATE INDEX idx_ai_generation_runs_graph_time
    ON ai_generation_runs(graph_id, created_at DESC);

  ALTER TABLE candidate_concepts
    ADD COLUMN origin TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (origin IN ('MANUAL', 'AI'));
  ALTER TABLE candidate_concepts
    ADD COLUMN source_model TEXT;
`;

const MIGRATION_10 = `
  CREATE TABLE IF NOT EXISTS onboarding_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED')),
    sample_graph_id TEXT REFERENCES knowledge_graphs(id) ON DELETE SET NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  ) STRICT;
  INSERT OR IGNORE INTO onboarding_state
    (id, status, sample_graph_id, started_at, completed_at, updated_at)
  SELECT 1,
         CASE WHEN EXISTS (SELECT 1 FROM knowledge_graphs) THEN 'DISMISSED' ELSE 'NOT_STARTED' END,
         NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
`;

export function migrateDatabase(database: DatabaseSync): void {
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA journal_mode = WAL;');
  const version = database.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version.user_version < 1) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(MIGRATION_1);
      database.exec('PRAGMA user_version = 1;');
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
  if (version.user_version < 2) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(MIGRATION_2);
      database.exec('PRAGMA user_version = 2;');
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
  if (version.user_version < 3) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(MIGRATION_3);
      database.exec('PRAGMA user_version = 3;');
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
  if (version.user_version < 4) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(MIGRATION_4);
      database.exec('PRAGMA user_version = 4;');
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
  if (version.user_version < 5) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(MIGRATION_5);
      database.exec('PRAGMA user_version = 5;');
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
  if (version.user_version < 6) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(MIGRATION_6);
      database.exec('PRAGMA user_version = 6;');
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
  if (version.user_version < 7) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(MIGRATION_7);
      database.exec('PRAGMA user_version = 7;');
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
  if (version.user_version < 8) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(MIGRATION_8);
      database.exec('PRAGMA user_version = 8;');
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
  if (version.user_version < 9) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(MIGRATION_9);
      database.exec('PRAGMA user_version = 9;');
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
  if (version.user_version < 10) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(MIGRATION_10);
      database.exec('PRAGMA user_version = 10;');
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
}

export function openDatabase(filePath: string): DatabaseSync {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  migrateDatabase(database);
  return database;
}
