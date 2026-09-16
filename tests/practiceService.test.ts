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
import { PracticeRepository } from '../src/main/repositories/practiceRepository';
import { SessionRepository } from '../src/main/repositories/sessionRepository';
import { TutorRepository } from '../src/main/repositories/tutorRepository';
import { AssessmentService } from '../src/main/services/assessmentService';
import { GraphService } from '../src/main/services/graphService';
import { LearningService } from '../src/main/services/learningService';
import { PracticeService } from '../src/main/services/practiceService';
import { SessionService } from '../src/main/services/sessionService';
import { TutorService } from '../src/main/services/tutorService';
import type { PracticeAttemptView, QuestionPurpose } from '../src/shared/contracts';

const nodeId = '11111111-1111-4111-8111-111111111111';
let database: DatabaseSync;
let graphService: GraphService;
let learningService: LearningService;
let assessmentService: AssessmentService;
let practiceService: PracticeService;
let sessionService: SessionService;
let tutorService: TutorService;

function installServices(targetDatabase: DatabaseSync): void {
  const graphRepository = new GraphRepository(targetDatabase);
  const learningRepository = new LearningRepository(targetDatabase);
  const assessmentRepository = new AssessmentRepository(targetDatabase);
  const practiceRepository = new PracticeRepository(targetDatabase);
  const sessionRepository = new SessionRepository(targetDatabase);
  const tutorRepository = new TutorRepository(targetDatabase);
  graphService = new GraphService(graphRepository);
  learningService = new LearningService(learningRepository, graphRepository);
  assessmentService = new AssessmentService(assessmentRepository, graphRepository, learningRepository);
  practiceService = new PracticeService(
    practiceRepository,
    graphRepository,
    assessmentRepository,
    sessionRepository,
    tutorRepository,
  );
  sessionService = new SessionService(
    sessionRepository,
    graphRepository,
    assessmentRepository,
    tutorRepository,
    practiceRepository,
  );
  tutorService = new TutorService(
    tutorRepository,
    graphRepository,
    assessmentRepository,
    sessionRepository,
    practiceRepository,
  );
}

beforeEach(() => {
  database = openDatabase(':memory:');
  installServices(database);
});

afterEach(() => database.close());

function createGraph(): string {
  const graph = graphService.create({ name: '练习测试' });
  graphService.save({
    id: graph.id,
    name: graph.name,
    nodes: [{
      id: nodeId,
      name: '梯度下降',
      description: '沿负梯度方向更新参数，并根据学习率控制步长。',
      position: { x: 0, y: 0 },
    }],
    edges: [],
  });
  return graph.id;
}

function addQuestion(prompt: string, purpose: QuestionPurpose): void {
  assessmentService.saveQuestion({
    nodeId,
    prompt,
    explanation: `${prompt}的解析`,
    purpose,
    options: [
      { text: `${prompt}正确`, isCorrect: true },
      { text: `${prompt}错误`, isCorrect: false },
    ],
  });
}

function answer(attempt: PracticeAttemptView, index: number, correct: boolean): string | null {
  const question = attempt.questions[index];
  if (!question) throw new Error('expected practice question');
  return correct
    ? question.options.find((option) => option.text.endsWith('正确'))?.id ?? null
    : question.options.find((option) => option.text.endsWith('错误'))?.id ?? null;
}

describe('formative practice', () => {
  it('separates practice and diagnostic question purposes', () => {
    const graphId = createGraph();
    addQuestion('仅诊断一', 'DIAGNOSTIC');
    addQuestion('仅诊断二', 'DIAGNOSTIC');
    addQuestion('仅练习', 'PRACTICE');
    addQuestion('通用', 'BOTH');
    expect(graphService.load(graphId)?.nodes[0]).toMatchObject({
      diagnosticQuestionCount: 3,
      practiceQuestionCount: 2,
    });

    const diagnostic = assessmentService.startDiagnostic({ graphId, nodeIds: [nodeId] });
    expect(diagnostic.questions.map((question) => question.prompt)).toEqual(['仅诊断一', '仅诊断二', '通用']);
    assessmentService.cancelDiagnostic(diagnostic.id);
    const practice = practiceService.start({ graphId, nodeId, mode: 'PRACTICE' });
    expect(practice.questions.map((question) => question.prompt)).toEqual(['仅练习', '通用']);
  });

  it('saves immutable answers, gives immediate feedback, and completes without claiming mastery', () => {
    const graphId = createGraph();
    addQuestion('练习一', 'PRACTICE');
    addQuestion('练习二', 'PRACTICE');
    const attempt = practiceService.start({ graphId, nodeId, mode: 'PRACTICE' });
    const first = practiceService.saveAnswer({
      attemptId: attempt.id,
      attemptQuestionId: attempt.questions[0].attemptQuestionId,
      selectedOptionId: answer(attempt, 0, false),
    });
    expect(first).toMatchObject({ isCorrect: false, correctOptionText: '练习一正确', explanation: '练习一的解析' });
    expect(() => practiceService.saveAnswer({
      attemptId: attempt.id,
      attemptQuestionId: attempt.questions[0].attemptQuestionId,
      selectedOptionId: answer(attempt, 0, true),
    })).toThrow('答案不能修改');
    expect(() => practiceService.complete(attempt.id)).toThrow('完成全部练习题');

    practiceService.saveAnswer({
      attemptId: attempt.id,
      attemptQuestionId: attempt.questions[1].attemptQuestionId,
      selectedOptionId: answer(attempt, 1, true),
    });
    const completed = practiceService.complete(attempt.id);
    expect(completed.attempt).toMatchObject({ status: 'COMPLETED' });
    expect(completed.evidence).toMatchObject({
      kind: 'PRACTICE_RESULT',
      scoreEarned: 1,
      scorePossible: 2,
      practiceAttemptId: attempt.id,
    });
    expect(completed.graph.nodes[0]).toMatchObject({
      status: 'LEARNING',
      latestEvidenceKind: 'PRACTICE_RESULT',
      latestEvidenceScoreEarned: 1,
      latestEvidenceScorePossible: 2,
    });
    expect(() => practiceService.complete(attempt.id)).toThrow('已经结束');
  });

  it('keeps diagnostic mastery authoritative after a review practice', () => {
    const graphId = createGraph();
    addQuestion('通用一', 'BOTH');
    addQuestion('通用二', 'BOTH');
    const diagnostic = assessmentService.startDiagnostic({ graphId, nodeIds: [nodeId] });
    assessmentService.completeDiagnostic({
      attemptId: diagnostic.id,
      answers: diagnostic.questions.map((question) => ({
        attemptQuestionId: question.attemptQuestionId,
        selectedOptionId: question.options.find((option) => option.text.endsWith('正确'))?.id ?? null,
      })),
    });
    const review = practiceService.start({ graphId, nodeId, mode: 'REVIEW' });
    for (let index = 0; index < review.questions.length; index += 1) {
      practiceService.saveAnswer({
        attemptId: review.id,
        attemptQuestionId: review.questions[index].attemptQuestionId,
        selectedOptionId: null,
      });
    }
    const completed = practiceService.complete(review.id);
    expect(completed.graph.nodes[0]).toMatchObject({
      status: 'MASTERED',
      latestEvidenceKind: 'DIAGNOSTIC_RESULT',
      evidenceCount: 2,
    });
    expect(learningService.listEvidence(nodeId)[0].kind).toBe('PRACTICE_RESULT');
    expect(tutorService.getRecommendation(graphId)).toBeNull();
  });

  it('recommends a fresh diagnosis after targeted remediation', () => {
    const graphId = createGraph();
    addQuestion('通用一', 'BOTH');
    addQuestion('通用二', 'BOTH');
    const diagnostic = assessmentService.startDiagnostic({ graphId, nodeIds: [nodeId] });
    assessmentService.completeDiagnostic({
      attemptId: diagnostic.id,
      answers: diagnostic.questions.map((question) => ({
        attemptQuestionId: question.attemptQuestionId,
        selectedOptionId: null,
      })),
    });
    expect(tutorService.getRecommendation(graphId)).toMatchObject({ action: 'REMEDIATE' });
    const remediation = practiceService.start({ graphId, nodeId, mode: 'REMEDIATE' });
    for (let index = 0; index < remediation.questions.length; index += 1) {
      practiceService.saveAnswer({
        attemptId: remediation.id,
        attemptQuestionId: remediation.questions[index].attemptQuestionId,
        selectedOptionId: answer(remediation, index, true),
      });
    }
    const completed = practiceService.complete(remediation.id);
    expect(completed.graph.nodes[0]).toMatchObject({
      latestEvidenceKind: 'DIAGNOSTIC_RESULT',
      mostRecentEvidenceKind: 'PRACTICE_RESULT',
    });
    expect(tutorService.getRecommendation(graphId)).toMatchObject({
      action: 'ASSESS',
      reasonCode: 'ASSESS_WITH_QUESTION_BANK',
    });
  });

  it('blocks parallel flows, cancellation evidence, and deletion of an active practice target', () => {
    const graphId = createGraph();
    addQuestion('通用一', 'BOTH');
    addQuestion('通用二', 'BOTH');
    const attempt = practiceService.start({ graphId, nodeId, mode: 'PRACTICE' });
    expect(() => assessmentService.startDiagnostic({ graphId, nodeIds: [nodeId] })).toThrow('未完成的练习');
    expect(() => sessionService.start({ graphId, nodeId, action: 'TEACH' })).toThrow('未完成的练习');
    expect(() => graphService.save({ id: graphId, name: '练习测试', nodes: [], edges: [] }))
      .toThrow('有未完成的练习');
    expect(practiceService.cancel(attempt.id).status).toBe('CANCELLED');
    expect(learningService.listEvidence(nodeId)).toHaveLength(0);
    expect(graphService.save({ id: graphId, name: '练习测试', nodes: [], edges: [] }).nodes).toHaveLength(0);
  });

  it('links an accepted tutor decision and resumes the active practice after restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-practice-'));
    const filePath = join(directory, 'graph.sqlite3');
    database.close();
    try {
      database = openDatabase(filePath);
      installServices(database);
      const graphId = createGraph();
      addQuestion('练习一', 'PRACTICE');
      const teach = tutorService.getRecommendation(graphId);
      if (!teach) throw new Error('expected teaching decision');
      tutorService.respondDecision({ decisionId: teach.id, response: 'ACCEPTED' });
      const session = sessionService.start({
        graphId,
        nodeId,
        action: 'TEACH',
        sourceDecisionId: teach.id,
      });
      sessionService.complete({ sessionId: session.id, notes: '我理解了梯度和学习率的关系。' });
      const decision = tutorService.getRecommendation(graphId);
      expect(decision).toMatchObject({ action: 'PRACTICE', targetNodeId: nodeId });
      if (!decision) throw new Error('expected practice decision');
      tutorService.respondDecision({ decisionId: decision.id, response: 'ACCEPTED' });
      const practice = practiceService.start({
        graphId,
        nodeId,
        mode: 'PRACTICE',
        sourceDecisionId: decision.id,
      });
      practiceService.saveAnswer({
        attemptId: practice.id,
        attemptQuestionId: practice.questions[0].attemptQuestionId,
        selectedOptionId: answer(practice, 0, true),
      });
      database.close();

      database = openDatabase(filePath);
      installServices(database);
      expect(practiceService.getActive(graphId)).toMatchObject({
        id: practice.id,
        status: 'IN_PROGRESS',
        answers: [expect.objectContaining({ isCorrect: true })],
      });
      expect(tutorService.getRecommendation(graphId)).toMatchObject({
        reasonCode: 'RESUME_PRACTICE',
        context: { practiceAttemptId: practice.id },
      });
    } finally {
      database.close();
      database = openDatabase(':memory:');
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
