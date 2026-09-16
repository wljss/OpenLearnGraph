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
import { SessionRepository } from '../src/main/repositories/sessionRepository';
import { PracticeRepository } from '../src/main/repositories/practiceRepository';
import { TutorRepository } from '../src/main/repositories/tutorRepository';
import { AssessmentService } from '../src/main/services/assessmentService';
import { GraphService } from '../src/main/services/graphService';
import { LearningService } from '../src/main/services/learningService';
import { SessionService } from '../src/main/services/sessionService';
import { TutorService } from '../src/main/services/tutorService';

const sourceId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
let database: DatabaseSync;
let graphService: GraphService;
let learningService: LearningService;
let assessmentService: AssessmentService;
let sessionService: SessionService;
let tutorService: TutorService;

function installServices(targetDatabase: DatabaseSync): void {
  const graphRepository = new GraphRepository(targetDatabase);
  const learningRepository = new LearningRepository(targetDatabase);
  const assessmentRepository = new AssessmentRepository(targetDatabase);
  const sessionRepository = new SessionRepository(targetDatabase);
  const tutorRepository = new TutorRepository(targetDatabase);
  const practiceRepository = new PracticeRepository(targetDatabase);
  graphService = new GraphService(graphRepository);
  learningService = new LearningService(learningRepository, graphRepository);
  assessmentService = new AssessmentService(assessmentRepository, graphRepository, learningRepository);
  sessionService = new SessionService(sessionRepository, graphRepository, assessmentRepository, tutorRepository, practiceRepository);
  tutorService = new TutorService(tutorRepository, graphRepository, assessmentRepository, sessionRepository, practiceRepository);
}

beforeEach(() => {
  database = openDatabase(':memory:');
  installServices(database);
});

afterEach(() => database.close());

function createGraph(description = '理解基础概念的定义、用途和一个具体例子。'): string {
  const graph = graphService.create({ name: '学习会话测试' });
  graphService.save({
    id: graph.id,
    name: graph.name,
    nodes: [
      { id: sourceId, name: '基础概念', description, position: { x: 0, y: 0 } },
      { id: targetId, name: '进阶概念', description: '进阶内容', position: { x: 220, y: 0 } },
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
      { text: `${prompt}正确`, isCorrect: true },
      { text: `${prompt}错误`, isCorrect: false },
    ],
  });
}

describe('learning sessions', () => {
  it('requires real local content and refuses locked concepts', () => {
    const graphId = createGraph('');
    expect(() => sessionService.start({ graphId, nodeId: sourceId, action: 'TEACH' }))
      .toThrow('还没有学习内容');
    expect(() => sessionService.start({ graphId, nodeId: targetId, action: 'ADVANCE' }))
      .toThrow('还需掌握');
  });

  it('starts idempotently, saves a draft, resumes it, and blocks parallel activity', () => {
    const graphId = createGraph();
    const started = sessionService.start({ graphId, nodeId: sourceId, action: 'TEACH' });
    expect(started).toMatchObject({
      graphId,
      nodeId: sourceId,
      status: 'IN_PROGRESS',
      description: '理解基础概念的定义、用途和一个具体例子。',
    });
    expect(sessionService.start({ graphId, nodeId: sourceId, action: 'TEACH' }).id).toBe(started.id);
    const saved = sessionService.saveDraft({
      sessionId: started.id,
      notes: '我目前的理解',
      stepIndex: 1,
    });
    expect(sessionService.getActive(graphId)).toMatchObject({
      id: started.id,
      notes: '我目前的理解',
      stepIndex: 1,
    });
    expect(saved.updatedAt >= started.updatedAt).toBe(true);
    expect(learningService.listEvidence(sourceId)).toHaveLength(0);
    expect(() => assessmentService.startDiagnostic({ graphId, nodeIds: [sourceId] }))
      .toThrow('未完成的学习会话');
    expect(() => sessionService.start({ graphId, nodeId: targetId, action: 'ADVANCE' }))
      .toThrow('已有“基础概念”学习会话');
  });

  it('prevents deleting the concept that owns an active session', () => {
    const graphId = createGraph();
    const session = sessionService.start({ graphId, nodeId: sourceId, action: 'TEACH' });
    expect(() => graphService.save({
      id: graphId,
      name: '学习会话测试',
      nodes: [{ id: targetId, name: '进阶概念', description: '进阶内容', position: { x: 220, y: 0 } }],
      edges: [],
    })).toThrow('有未完成的学习会话');
    expect(graphService.load(graphId)?.nodes).toHaveLength(2);

    sessionService.cancel(session.id);
    expect(graphService.save({
      id: graphId,
      name: '学习会话测试',
      nodes: [{ id: targetId, name: '进阶概念', description: '进阶内容', position: { x: 220, y: 0 } }],
      edges: [],
    }).nodes).toHaveLength(1);
  });

  it('records completion evidence without claiming mastery and prevents duplicate completion', () => {
    const graphId = createGraph();
    const started = sessionService.start({ graphId, nodeId: sourceId, action: 'TEACH' });
    expect(() => sessionService.complete({ sessionId: started.id, notes: '   ' }))
      .toThrow('请先用自己的话写下学习总结');
    const completed = sessionService.complete({
      sessionId: started.id,
      notes: ' 基础概念用于说明核心关系，我还需要通过题目验证。 ',
    });
    expect(completed.session).toMatchObject({ status: 'COMPLETED', stepIndex: 2 });
    expect(completed.evidence).toMatchObject({
      kind: 'LEARNING_SESSION_COMPLETED',
      learningSessionId: started.id,
      note: '基础概念用于说明核心关系，我还需要通过题目验证。',
    });
    expect(completed.graph.nodes.find((node) => node.id === sourceId)).toMatchObject({
      status: 'LEARNING',
      learningPhase: 'LEARNING',
      latestEvidenceKind: 'LEARNING_SESSION_COMPLETED',
      evidenceCount: 1,
    });
    expect(() => sessionService.complete({ sessionId: started.id, notes: '重复' }))
      .toThrow('已经结束');
  });

  it('keeps objective diagnostic evidence authoritative after session completion', () => {
    const graphId = createGraph();
    addQuestion('问题一');
    addQuestion('问题二');
    const attempt = assessmentService.startDiagnostic({ graphId, nodeIds: [sourceId] });
    assessmentService.completeDiagnostic({
      attemptId: attempt.id,
      answers: attempt.questions.map((question) => ({
        attemptQuestionId: question.attemptQuestionId,
        selectedOptionId: null,
      })),
    });
    const started = sessionService.start({ graphId, nodeId: sourceId, action: 'TEACH' });
    const result = sessionService.complete({ sessionId: started.id, notes: '重新学习了薄弱内容' });
    expect(result.graph.nodes.find((node) => node.id === sourceId)).toMatchObject({
      status: 'LEARNING',
      latestEvidenceKind: 'DIAGNOSTIC_RESULT',
      evidenceCount: 2,
    });
    expect(learningService.listEvidence(sourceId)[0]).toMatchObject({
      kind: 'LEARNING_SESSION_COMPLETED',
      learningSessionId: started.id,
    });
  });

  it('links an accepted decision and turns the next recommendation into resume', () => {
    const graphId = createGraph();
    const decision = tutorService.getRecommendation(graphId);
    if (!decision) throw new Error('expected tutor decision');
    tutorService.respondDecision({ decisionId: decision.id, response: 'ACCEPTED' });
    const session = sessionService.start({
      graphId,
      nodeId: sourceId,
      action: 'TEACH',
      sourceDecisionId: decision.id,
    });
    expect(session.sourceDecisionId).toBe(decision.id);
    expect(tutorService.getRecommendation(graphId)).toMatchObject({
      reasonCode: 'RESUME_LEARNING_SESSION',
      context: { sessionId: session.id },
    });
    const cancelled = sessionService.cancel(session.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(learningService.listEvidence(sourceId)).toHaveLength(0);
  });

  it('restores an in-progress session and its history after a full restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-session-'));
    const filePath = join(directory, 'graph.sqlite3');
    database.close();
    try {
      database = openDatabase(filePath);
      installServices(database);
      const graphId = createGraph();
      const session = sessionService.start({ graphId, nodeId: sourceId, action: 'TEACH' });
      sessionService.saveDraft({ sessionId: session.id, notes: '重启后继续', stepIndex: 1 });
      database.close();

      database = openDatabase(filePath);
      installServices(database);
      expect(sessionService.getActive(graphId)).toMatchObject({
        id: session.id,
        notes: '重启后继续',
        stepIndex: 1,
      });
      expect(sessionService.list(graphId)).toHaveLength(1);
    } finally {
      database.close();
      database = openDatabase(':memory:');
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
