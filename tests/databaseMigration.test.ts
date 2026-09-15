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
      oldDatabase.exec('DROP TABLE learner_node_states; DROP TABLE learning_evidence; PRAGMA user_version = 1;');
      oldDatabase.close();

      const upgraded = openDatabase(filePath);
      const version = upgraded.prepare('PRAGMA user_version').get() as { user_version: number };
      const restored = new GraphRepository(upgraded).load(graphId);
      expect(version.user_version).toBe(2);
      expect(restored?.nodes[0]).toMatchObject({ name: '旧版概念', status: 'AVAILABLE', evidenceCount: 0 });
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
