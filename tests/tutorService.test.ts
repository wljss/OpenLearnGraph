// @vitest-environment node
import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/database/database';
import { AssessmentRepository } from '../src/main/repositories/assessmentRepository';
import { GraphRepository } from '../src/main/repositories/graphRepository';
import { LearningRepository } from '../src/main/repositories/learningRepository';
import { TutorRepository } from '../src/main/repositories/tutorRepository';
import { AssessmentService } from '../src/main/services/assessmentService';
import { GraphService } from '../src/main/services/graphService';
import { LearningService } from '../src/main/services/learningService';
import { TutorService } from '../src/main/services/tutorService';

const sourceId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
let database: DatabaseSync;
let graphService: GraphService;
let learningService: LearningService;
let assessmentService: AssessmentService;
let tutorService: TutorService;

function installServices(targetDatabase: DatabaseSync): void {
  const graphRepository = new GraphRepository(targetDatabase);
  const learningRepository = new LearningRepository(targetDatabase);
  const assessmentRepository = new AssessmentRepository(targetDatabase);
  graphService = new GraphService(graphRepository);
  learningService = new LearningService(learningRepository, graphRepository);
  assessmentService = new AssessmentService(assessmentRepository, graphRepository, learningRepository);
  tutorService = new TutorService(new TutorRepository(targetDatabase), graphRepository, assessmentRepository);
}

beforeEach(() => {
  database = openDatabase(':memory:');
  installServices(database);
});

afterEach(() => database.close());

function createGraph(): string {
  const graph = graphService.create({ name: '学习建议测试' });
  graphService.save({
    id: graph.id,
    name: graph.name,
    nodes: [
      { id: sourceId, name: '基础概念', description: '', position: { x: 0, y: 0 } },
      { id: targetId, name: '进阶概念', description: '', position: { x: 220, y: 0 } },
    ],
    edges: [{
      id: '33333333-3333-4333-8333-333333333333',
      sourceNodeId: sourceId,
      targetNodeId: targetId,
      relationship: 'PREREQUISITE',
    }],
  });
  return graph.id;
}

function addQuestion(prompt: string): void {
  assessmentService.saveQuestion({
    nodeId: sourceId,
    prompt,
    explanation: `${prompt}解析`,
    options: [
      { text: '正确答案', isCorrect: true },
      { text: '错误答案', isCorrect: false },
    ],
  });
}

describe('tutor decision engine', () => {
  it('returns no recommendation for an empty graph and reuses a decision for unchanged state', () => {
    const empty = graphService.create({ name: '空图谱' });
    expect(tutorService.getRecommendation(empty.id)).toBeNull();

    const graphId = createGraph();
    const first = tutorService.getRecommendation(graphId);
    const second = tutorService.getRecommendation(graphId);
    expect(first).toMatchObject({ action: 'TEACH', targetNodeId: sourceId, response: 'PENDING' });
    expect(second?.id).toBe(first?.id);
    expect(tutorService.listDecisions(graphId)).toHaveLength(1);
  });

  it('preserves responses, marks outdated decisions stale, and never changes evidence by acceptance', () => {
    const graphId = createGraph();
    const initial = tutorService.getRecommendation(graphId);
    if (!initial) throw new Error('expected recommendation');
    expect(tutorService.respondDecision({ decisionId: initial.id, response: 'DISMISSED' }).response).toBe('DISMISSED');
    expect(tutorService.respondDecision({ decisionId: initial.id, response: 'PENDING' }).response).toBe('PENDING');
    expect(tutorService.respondDecision({ decisionId: initial.id, response: 'ACCEPTED' }).response).toBe('ACCEPTED');
    expect(learningService.listEvidence(sourceId)).toHaveLength(0);

    learningService.recordEvidence({ nodeId: sourceId, kind: 'STUDY_STARTED' });
    expect(() => tutorService.respondDecision({ decisionId: initial.id, response: 'DISMISSED' }))
      .toThrow('学习状态已经改变');
    const next = tutorService.getRecommendation(graphId);
    expect(next).toMatchObject({ action: 'PRACTICE', targetNodeId: sourceId });
    expect(tutorService.listDecisions(graphId)).toEqual([
      expect.objectContaining({ id: next?.id, isStale: false }),
      expect.objectContaining({ id: initial.id, response: 'ACCEPTED', isStale: true }),
    ]);
  });

  it('prioritizes an unfinished diagnostic, then remediates a failed result', () => {
    const graphId = createGraph();
    addQuestion('问题一');
    addQuestion('问题二');
    const ready = tutorService.getRecommendation(graphId);
    expect(ready).toMatchObject({ action: 'ASSESS', targetNodeId: sourceId });

    const attempt = assessmentService.startDiagnostic({ graphId, nodeIds: [sourceId] });
    const resume = tutorService.getRecommendation(graphId);
    expect(resume).toMatchObject({
      action: 'ASSESS',
      reasonCode: 'RESUME_DIAGNOSTIC',
      context: { attemptId: attempt.id },
    });

    assessmentService.completeDiagnostic({
      attemptId: attempt.id,
      answers: attempt.questions.map((question) => ({
        attemptQuestionId: question.attemptQuestionId,
        selectedOptionId: null,
      })),
    });
    expect(tutorService.getRecommendation(graphId)).toMatchObject({
      action: 'REMEDIATE',
      reasonCode: 'REMEDIATE_FAILED_DIAGNOSTIC',
      targetNodeId: sourceId,
    });
  });

  it('restores decision history after reopening the database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-tutor-'));
    const filePath = join(directory, 'graph.sqlite3');
    database.close();
    try {
      database = openDatabase(filePath);
      installServices(database);
      const graphId = createGraph();
      const decision = tutorService.getRecommendation(graphId);
      if (!decision) throw new Error('expected recommendation');
      tutorService.respondDecision({ decisionId: decision.id, response: 'DISMISSED' });
      database.close();

      database = openDatabase(filePath);
      installServices(database);
      expect(tutorService.getRecommendation(graphId)).toMatchObject({ id: decision.id, response: 'DISMISSED' });
      expect(tutorService.listDecisions(graphId)).toHaveLength(1);
    } finally {
      database.close();
      database = openDatabase(':memory:');
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
