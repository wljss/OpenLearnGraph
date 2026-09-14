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
}

export function openDatabase(filePath: string): DatabaseSync {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  migrateDatabase(database);
  return database;
}
