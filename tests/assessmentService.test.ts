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
import { AssessmentService } from '../src/main/services/assessmentService';
import { GraphService } from '../src/main/services/graphService';
import { LearningService } from '../src/main/services/learningService';
import type { DiagnosticAttemptView } from '../src/shared/contracts';

const sourceId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
let database: DatabaseSync;
let graphRepository: GraphRepository;
let graphService: GraphService;
let learningService: LearningService;
let assessmentService: AssessmentService;

function createServices(targetDatabase: DatabaseSync): void {
  graphRepository = new GraphRepository(targetDatabase);
  const learningRepository = new LearningRepository(targetDatabase);
  graphService = new GraphService(graphRepository);
  learningService = new LearningService(learningRepository, graphRepository);
  assessmentService = new AssessmentService(
    new AssessmentRepository(targetDatabase),
    graphRepository,
    learningRepository,
  );
}

beforeEach(() => {
  database = openDatabase(':memory:');
  createServices(database);
});

afterEach(() => database.close());

function createGraph(): string {
  const graph = graphService.create({ name: '诊断测试图谱' });
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

function addQuestion(nodeId: string, prompt: string) {
  return assessmentService.saveQuestion({
    nodeId,
    prompt: `  ${prompt}  `,
    explanation: ` ${prompt} 的解析 `,
    options: [
      { text: `${prompt} 正确`, isCorrect: true },
      { text: `${prompt} 错误`, isCorrect: false },
    ],
  });
}

function answers(attempt: DiagnosticAttemptView, correct: boolean) {
  return attempt.questions.map((question) => ({
    attemptQuestionId: question.attemptQuestionId,
    selectedOptionId: correct
      ? question.options.find((option) => option.text.endsWith('正确'))?.id ?? null
      : null,
  }));
}

describe('diagnostic assessment', () => {
  it('requires two questions per concept and excludes concepts without coverage', () => {
    const graphId = createGraph();
    expect(() => assessmentService.startDiagnostic(graphId)).toThrow('至少需要为一个概念准备 2 道诊断题');

    addQuestion(sourceId, '题目一');
    addQuestion(targetId, '尚未覆盖的题目');
    expect(graphRepository.load(graphId)?.nodes.map((node) => node.diagnosticQuestionCount)).toEqual([1, 1]);
    expect(() => assessmentService.startDiagnostic(graphId)).toThrow('至少需要为一个概念准备 2 道诊断题');

    addQuestion(sourceId, '题目二');
    const attempt = assessmentService.startDiagnostic(graphId);
    expect(attempt.questions).toHaveLength(2);
    expect(attempt.questions.every((question) => question.nodeId === sourceId)).toBe(true);
    expect(attempt.questions[0].options[0]).not.toHaveProperty('isCorrect');

    assessmentService.cancelDiagnostic(attempt.id);
    expect(() => assessmentService.completeDiagnostic({ attemptId: attempt.id, answers: answers(attempt, true) }))
      .toThrow('已经提交');
  });

  it('creates objective evidence, updates graph state, and keeps diagnostics authoritative', () => {
    const graphId = createGraph();
    addQuestion(sourceId, '题目一');
    addQuestion(sourceId, '题目二');
    const attempt = assessmentService.startDiagnostic(graphId);
    const result = assessmentService.completeDiagnostic({
      attemptId: attempt.id,
      answers: answers(attempt, true),
    });

    expect(result.correctCount).toBe(2);
    expect(result.nodeResults).toEqual([expect.objectContaining({
      nodeId: sourceId,
      correctCount: 2,
      questionCount: 2,
      passed: true,
    })]);
    expect(result.graph.nodes.find((node) => node.id === sourceId)).toMatchObject({
      status: 'MASTERED',
      latestEvidenceKind: 'DIAGNOSTIC_RESULT',
      latestEvidenceScoreEarned: 2,
      latestEvidenceScorePossible: 2,
    });
    expect(result.graph.nodes.find((node) => node.id === targetId)?.status).toBe('AVAILABLE');
    expect(learningService.listEvidence(sourceId)[0]).toMatchObject({
      kind: 'DIAGNOSTIC_RESULT',
      scoreEarned: 2,
      scorePossible: 2,
      assessmentAttemptId: attempt.id,
    });

    const selfAssessment = learningService.recordEvidence({
      nodeId: sourceId,
      kind: 'SELF_ASSESSMENT',
      rating: 1,
      note: '主观上仍不自信',
    });
    expect(selfAssessment.graph.nodes.find((node) => node.id === sourceId)).toMatchObject({
      status: 'MASTERED',
      latestEvidenceKind: 'DIAGNOSTIC_RESULT',
    });
    expect(learningService.listEvidence(sourceId)).toHaveLength(2);
  });

  it('uses the latest diagnostic to downgrade state and relock downstream concepts', () => {
    const graphId = createGraph();
    addQuestion(sourceId, '题目一');
    addQuestion(sourceId, '题目二');
    const firstAttempt = assessmentService.startDiagnostic(graphId);
    assessmentService.completeDiagnostic({ attemptId: firstAttempt.id, answers: answers(firstAttempt, true) });

    const secondAttempt = assessmentService.startDiagnostic(graphId);
    const failed = assessmentService.completeDiagnostic({
      attemptId: secondAttempt.id,
      answers: answers(secondAttempt, false),
    });
    expect(failed.graph.nodes.find((node) => node.id === sourceId)).toMatchObject({
      status: 'LEARNING',
      latestEvidenceScoreEarned: 0,
      latestEvidenceScorePossible: 2,
    });
    expect(failed.graph.nodes.find((node) => node.id === targetId)?.status).toBe('LOCKED');
  });

  it('grades from the immutable attempt snapshot after the live question is edited and deleted', () => {
    const graphId = createGraph();
    const first = addQuestion(sourceId, '原始题目一');
    addQuestion(sourceId, '原始题目二');
    const attempt = assessmentService.startDiagnostic(graphId);

    assessmentService.saveQuestion({
      id: first.id,
      nodeId: sourceId,
      prompt: '已经修改的题目',
      explanation: '新的解析',
      options: [
        { text: '新错误答案', isCorrect: false },
        { text: '新正确答案', isCorrect: true },
      ],
    });
    assessmentService.deleteQuestion(first.id);

    const completed = assessmentService.completeDiagnostic({
      attemptId: attempt.id,
      answers: answers(attempt, true),
    });
    expect(completed.correctCount).toBe(2);
    expect(completed.questionResults[0]).toMatchObject({
      prompt: '原始题目一',
      correctOptionText: '原始题目一 正确',
      explanation: '原始题目一 的解析',
    });
    expect(assessmentService.listQuestions(sourceId)).toHaveLength(1);
  });

  it('restores diagnostic questions, evidence, and state after restart', () => {
    database.close();
    const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-assessment-'));
    const filePath = join(directory, 'graph.sqlite3');
    let reopened: DatabaseSync | null = null;
    try {
      database = openDatabase(filePath);
      createServices(database);
      const graphId = createGraph();
      addQuestion(sourceId, '持久化题目一');
      addQuestion(sourceId, '持久化题目二');
      const attempt = assessmentService.startDiagnostic(graphId);
      assessmentService.completeDiagnostic({ attemptId: attempt.id, answers: answers(attempt, true) });
      database.close();

      reopened = openDatabase(filePath);
      createServices(reopened);
      expect(graphRepository.load(graphId)?.nodes.find((node) => node.id === sourceId)).toMatchObject({
        status: 'MASTERED',
        diagnosticQuestionCount: 2,
        evidenceCount: 1,
      });
      expect(assessmentService.listQuestions(sourceId)).toHaveLength(2);
      expect(learningService.listEvidence(sourceId)[0].kind).toBe('DIAGNOSTIC_RESULT');
    } finally {
      reopened?.close();
      rmSync(directory, { recursive: true, force: true });
      database = openDatabase(':memory:');
      createServices(database);
    }
  });
});
