// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/database/database';
import { GraphRepository } from '../src/main/repositories/graphRepository';
import { GraphService } from '../src/main/services/graphService';

let database: DatabaseSync;
let service: GraphService;
beforeEach(() => { database = openDatabase(':memory:'); service = new GraphService(new GraphRepository(database)); });
afterEach(() => database.close());
describe('graph persistence', () => {
  it('returns a readable validation error for a blank concept name', () => {
    const graph = service.create({ name: '错误提示测试' });
    expect(() => service.save({
      id: graph.id,
      name: graph.name,
      nodes: [{
        id: '88888888-8888-4888-8888-888888888888',
        name: '   ',
        description: '',
        position: { x: 0, y: 0 },
      }],
      edges: [],
    })).toThrow('第 1 个概念：概念名称不能为空');
  });

  it('creates, saves and restores a graph including positions and edges', () => {
    const graph = service.create({ name: '  深度学习  ' });
    const sourceId = '11111111-1111-4111-8111-111111111111';
    const targetId = '22222222-2222-4222-8222-222222222222';
    service.save({ id: graph.id, name: graph.name, nodes: [
      { id: sourceId, name: '线性代数', description: '基础', position: { x: 12.5, y: -8 } },
      { id: targetId, name: '神经网络', description: '', position: { x: 410, y: 88 } },
    ], edges: [{ id: '33333333-3333-4333-8333-333333333333', sourceNodeId: sourceId, targetNodeId: targetId, relationship: 'PREREQUISITE' }] });
    const restored = service.load(graph.id);
    expect(restored?.name).toBe('深度学习');
    expect(restored?.nodes).toHaveLength(2);
    expect(restored?.nodes[0].position).toEqual({ x: 12.5, y: -8 });
    expect(restored?.nodes[0].status).toBe('AVAILABLE');
    expect(restored?.edges[0]).toMatchObject({ sourceNodeId: sourceId, targetNodeId: targetId });
  });
  it('removes connected edges when a node is removed from the saved document', () => {
    const graph = service.create({ name: '测试图谱' });
    const sourceId = '11111111-1111-4111-8111-111111111111'; const targetId = '22222222-2222-4222-8222-222222222222';
    service.save({ id: graph.id, name: graph.name, nodes: [
      { id: sourceId, name: 'A', description: '', position: { x: 0, y: 0 } },
      { id: targetId, name: 'B', description: '', position: { x: 1, y: 1 } },
    ], edges: [{ id: '33333333-3333-4333-8333-333333333333', sourceNodeId: sourceId, targetNodeId: targetId, relationship: 'PREREQUISITE' }] });
    const saved = service.save({ id: graph.id, name: graph.name, nodes: [{ id: sourceId, name: 'A', description: '', position: { x: 0, y: 0 } }], edges: [] });
    expect(saved.nodes).toHaveLength(1); expect(saved.edges).toHaveLength(0);
  });

  it('restores persisted data after the database is closed and reopened', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-test-'));
    const filePath = join(directory, 'graph.sqlite3');
    try {
      const firstConnection = openDatabase(filePath);
      const firstService = new GraphService(new GraphRepository(firstConnection));
      const graph = firstService.create({ name: '重启恢复测试' });
      const nodeId = '77777777-7777-4777-8777-777777777777';
      firstService.save({
        id: graph.id,
        name: graph.name,
        nodes: [{ id: nodeId, name: '持久节点', description: '磁盘数据', position: { x: 17, y: 29 } }],
        edges: [],
      });
      firstConnection.close();

      const secondConnection = openDatabase(filePath);
      const restored = new GraphService(new GraphRepository(secondConnection)).load(graph.id);
      expect(restored?.nodes[0]).toMatchObject({ id: nodeId, name: '持久节点', position: { x: 17, y: 29 } });
      secondConnection.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
