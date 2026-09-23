// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/database/database';
import { GraphRepository } from '../src/main/repositories/graphRepository';
import { OnboardingRepository } from '../src/main/repositories/onboardingRepository';
import { OnboardingService } from '../src/main/services/onboardingService';

let database: DatabaseSync;
let service: OnboardingService;

beforeEach(() => {
  database = openDatabase(':memory:');
  const graphRepository = new GraphRepository(database);
  service = new OnboardingService(new OnboardingRepository(database, graphRepository));
});

afterEach(() => database.close());

describe('onboarding service', () => {
  it('starts new profiles without interrupting them with fake progress', () => {
    expect(service.getState()).toMatchObject({
      status: 'NOT_STARTED',
      sampleGraphId: null,
      checklist: {
        hasGraph: false,
        hasConcept: false,
        hasRelationship: false,
        hasLearningSession: false,
        hasPractice: false,
        hasDiagnostic: false,
      },
    });
  });

  it('creates one reusable sample graph with content, relationships, and questions', () => {
    const created = service.createSample();

    expect(created.state).toMatchObject({
      status: 'IN_PROGRESS',
      sampleGraphId: created.graph.id,
      checklist: { hasGraph: true, hasConcept: true, hasRelationship: true },
    });
    expect(created.graph).toMatchObject({ name: '示例：机器学习入门' });
    expect(created.graph.nodes).toHaveLength(3);
    expect(created.graph.edges).toHaveLength(2);
    expect(created.graph.nodes.map((node) => node.diagnosticQuestionCount)).toEqual([2, 2, 2]);
    expect(created.graph.nodes.map((node) => node.practiceQuestionCount)).toEqual([2, 2, 2]);
    expect(created.graph.nodes.map((node) => node.status)).toEqual(['AVAILABLE', 'LOCKED', 'LOCKED']);

    const repeated = service.createSample();
    expect(repeated.graph.id).toBe(created.graph.id);
    expect(database.prepare('SELECT COUNT(*) AS count FROM knowledge_graphs').get()).toMatchObject({ count: 1 });
  });

  it('persists guide status and only deletes the marked sample graph', () => {
    const sample = service.createSample();
    const otherGraphId = crypto.randomUUID();
    const now = new Date().toISOString();
    database.prepare(
      'INSERT INTO knowledge_graphs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(otherGraphId, '用户图谱', now, now);

    expect(service.updateStatus({ status: 'COMPLETED' }).status).toBe('COMPLETED');
    const afterDelete = service.deleteSample();
    expect(afterDelete.sampleGraphId).toBeNull();
    expect(database.prepare('SELECT id FROM knowledge_graphs WHERE id = ?').get(sample.graph.id)).toBeUndefined();
    expect(database.prepare('SELECT id FROM knowledge_graphs WHERE id = ?').get(otherGraphId)).toBeTruthy();
  });

  it('rejects untrusted status values', () => {
    expect(() => service.updateStatus({ status: 'NOT_STARTED' })).toThrow();
    expect(() => service.updateStatus({ status: 'UNKNOWN' })).toThrow();
  });
});
