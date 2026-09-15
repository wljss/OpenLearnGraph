// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/database/database';
import { GraphRepository } from '../src/main/repositories/graphRepository';
import { LearningRepository } from '../src/main/repositories/learningRepository';
import { GraphService } from '../src/main/services/graphService';
import { LearningService } from '../src/main/services/learningService';

const sourceId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
let database: DatabaseSync;
let graphService: GraphService;
let learningService: LearningService;

beforeEach(() => {
  database = openDatabase(':memory:');
  const graphRepository = new GraphRepository(database);
  graphService = new GraphService(graphRepository);
  learningService = new LearningService(new LearningRepository(database), graphRepository);
});
afterEach(() => database.close());

function createLearningGraph() {
  const graph = graphService.create({ name: '学习路径' });
  return graphService.save({
    id: graph.id,
    name: graph.name,
    nodes: [
      { id: sourceId, name: '基础概念', description: '', position: { x: 0, y: 0 } },
      { id: targetId, name: '进阶概念', description: '', position: { x: 200, y: 0 } },
    ],
    edges: [{
      id: '33333333-3333-4333-8333-333333333333',
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      relationship: 'PREREQUISITE',
    }],
  });
}

describe('learning evidence and state', () => {
  it('locks dependents, then unlocks them from explainable mastery evidence', () => {
    const graph = createLearningGraph();
    expect(graph.nodes.find((node) => node.id === targetId)?.status).toBe('LOCKED');
    expect(() => learningService.recordEvidence({ nodeId: targetId, kind: 'STUDY_STARTED' }))
      .toThrow('还需掌握：基础概念。');

    const result = learningService.recordEvidence({
      nodeId: sourceId,
      kind: 'SELF_ASSESSMENT',
      rating: 4,
      note: '  已经可以独立完成  ',
    });
    expect(result.evidence).toMatchObject({ rating: 4, note: '已经可以独立完成' });
    expect(result.graph.nodes.find((node) => node.id === sourceId)?.status).toBe('MASTERED');
    expect(result.graph.nodes.find((node) => node.id === targetId)?.status).toBe('AVAILABLE');
  });

  it('records study and uses the latest self assessment to update phase', () => {
    createLearningGraph();
    const started = learningService.recordEvidence({ nodeId: sourceId, kind: 'STUDY_STARTED' });
    expect(started.graph.nodes.find((node) => node.id === sourceId)?.status).toBe('LEARNING');
    expect(() => learningService.recordEvidence({ nodeId: sourceId, kind: 'STUDY_STARTED' }))
      .toThrow('该概念已经处于学习中。');

    learningService.recordEvidence({ nodeId: sourceId, kind: 'SELF_ASSESSMENT', rating: 5, note: '' });
    const revised = learningService.recordEvidence({ nodeId: sourceId, kind: 'SELF_ASSESSMENT', rating: 3, note: '还需要练习' });
    expect(revised.graph.nodes.find((node) => node.id === sourceId)?.status).toBe('LEARNING');
    expect(revised.graph.nodes.find((node) => node.id === targetId)?.status).toBe('LOCKED');
    expect(learningService.listEvidence(sourceId).map((item) => item.rating)).toEqual([3, 5, null]);
  });

  it('preserves evidence when graph structure is edited and saved', () => {
    const graph = createLearningGraph();
    learningService.recordEvidence({ nodeId: sourceId, kind: 'SELF_ASSESSMENT', rating: 4, note: '掌握' });

    const saved = graphService.save({
      id: graph.id,
      name: '重新命名的学习路径',
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        description: node.description,
        position: { x: node.position.x + 20, y: node.position.y },
      })),
      edges: graph.edges.map(({ id, sourceNodeId, targetNodeId, relationship }) => ({
        id, sourceNodeId, targetNodeId, relationship,
      })),
    });

    expect(saved.nodes.find((node) => node.id === sourceId)).toMatchObject({
      status: 'MASTERED',
      evidenceCount: 1,
    });
    expect(learningService.listEvidence(sourceId)).toHaveLength(1);
  });

  it('deletes evidence only when its concept is actually removed', () => {
    const graph = createLearningGraph();
    learningService.recordEvidence({ nodeId: sourceId, kind: 'STUDY_STARTED' });
    graphService.save({
      id: graph.id,
      name: graph.name,
      nodes: graph.nodes.filter((node) => node.id !== sourceId).map((node) => ({
        id: node.id, name: node.name, description: node.description, position: node.position,
      })),
      edges: [],
    });
    expect(() => learningService.listEvidence(sourceId)).toThrow('要查看的概念不存在');
  });

  it('restores evidence and projected state after a full database restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-learning-'));
    const filePath = join(directory, 'graph.sqlite3');
    try {
      const firstDatabase = openDatabase(filePath);
      const firstGraphRepository = new GraphRepository(firstDatabase);
      const firstGraphService = new GraphService(firstGraphRepository);
      const firstLearningService = new LearningService(new LearningRepository(firstDatabase), firstGraphRepository);
      const graph = firstGraphService.create({ name: '重启恢复' });
      firstGraphService.save({
        id: graph.id,
        name: graph.name,
        nodes: [{ id: sourceId, name: '持久学习概念', description: '', position: { x: 8, y: 9 } }],
        edges: [],
      });
      firstLearningService.recordEvidence({
        nodeId: sourceId,
        kind: 'SELF_ASSESSMENT',
        rating: 5,
        note: '重启后仍应存在',
      });
      firstDatabase.close();

      const secondDatabase = openDatabase(filePath);
      const secondGraphRepository = new GraphRepository(secondDatabase);
      const secondLearningService = new LearningService(new LearningRepository(secondDatabase), secondGraphRepository);
      expect(secondGraphRepository.load(graph.id)?.nodes[0]).toMatchObject({
        status: 'MASTERED',
        learningPhase: 'MASTERED',
        evidenceCount: 1,
      });
      expect(secondLearningService.listEvidence(sourceId)[0]).toMatchObject({
        rating: 5,
        note: '重启后仍应存在',
      });
      secondDatabase.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
