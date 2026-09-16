// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  completeDiagnosticInputSchema,
  completeLearningSessionInputSchema,
  recordLearningEvidenceInputSchema,
  respondTutorDecisionInputSchema,
  saveAssessmentQuestionInputSchema,
  saveDiagnosticAnswerInputSchema,
  saveLearningSessionDraftInputSchema,
  saveGraphInputSchema,
  startDiagnosticInputSchema,
  startLearningSessionInputSchema,
} from '../src/shared/contracts';

const graphId = '11111111-1111-4111-8111-111111111111';
const firstNodeId = '22222222-2222-4222-8222-222222222222';
const secondNodeId = '33333333-3333-4333-8333-333333333333';
function validGraph() {
  return {
    id: graphId, name: '线性代数',
    nodes: [
      { id: firstNodeId, name: '向量', description: '', position: { x: 0, y: 0 } },
      { id: secondNodeId, name: '矩阵', description: '', position: { x: 200, y: 0 } },
    ],
    edges: [{ id: '44444444-4444-4444-8444-444444444444', sourceNodeId: firstNodeId, targetNodeId: secondNodeId, relationship: 'PREREQUISITE' as const }],
  };
}
describe('saveGraphInputSchema', () => {
  it('accepts a valid graph', () => expect(saveGraphInputSchema.safeParse(validGraph()).success).toBe(true));
  it('rejects blank names', () => {
    const graph = validGraph(); graph.nodes[0].name = '   ';
    expect(saveGraphInputSchema.safeParse(graph).success).toBe(false);
  });
  it('rejects self, duplicate and dangling prerequisite edges', () => {
    const self = validGraph(); self.edges[0].targetNodeId = firstNodeId;
    expect(saveGraphInputSchema.safeParse(self).success).toBe(false);
    const duplicate = validGraph(); duplicate.edges.push({ ...duplicate.edges[0], id: '55555555-5555-4555-8555-555555555555' });
    expect(saveGraphInputSchema.safeParse(duplicate).success).toBe(false);
    const dangling = validGraph(); dangling.edges[0].targetNodeId = '66666666-6666-4666-8666-666666666666';
    expect(saveGraphInputSchema.safeParse(dangling).success).toBe(false);
  });
  it('rejects prerequisite cycles', () => {
    const cyclic = validGraph();
    cyclic.edges.push({
      id: '55555555-5555-4555-8555-555555555555',
      sourceNodeId: secondNodeId,
      targetNodeId: firstNodeId,
      relationship: 'PREREQUISITE',
    });
    const result = saveGraphInputSchema.safeParse(cyclic);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes('循环'))).toBe(true);
  });
});

describe('recordLearningEvidenceInputSchema', () => {
  it('accepts study starts and bounded self assessments', () => {
    expect(recordLearningEvidenceInputSchema.safeParse({ nodeId: firstNodeId, kind: 'STUDY_STARTED' }).success).toBe(true);
    expect(recordLearningEvidenceInputSchema.safeParse({
      nodeId: firstNodeId, kind: 'SELF_ASSESSMENT', rating: 4, note: '可以独立完成',
    }).success).toBe(true);
  });

  it('rejects out-of-range ratings and oversized notes', () => {
    expect(recordLearningEvidenceInputSchema.safeParse({
      nodeId: firstNodeId, kind: 'SELF_ASSESSMENT', rating: 6, note: '',
    }).success).toBe(false);
    expect(recordLearningEvidenceInputSchema.safeParse({
      nodeId: firstNodeId, kind: 'SELF_ASSESSMENT', rating: 3, note: 'x'.repeat(2_001),
    }).success).toBe(false);
  });
});

describe('diagnostic assessment schemas', () => {
  const question = {
    nodeId: firstNodeId,
    prompt: '向量点积的结果是什么？',
    explanation: '点积把两个等长向量映射为一个标量。',
    options: [
      { text: '标量', isCorrect: true },
      { text: '向量', isCorrect: false },
    ],
  };

  it('accepts a single-choice question with exactly one correct option', () => {
    expect(saveAssessmentQuestionInputSchema.safeParse(question).success).toBe(true);
  });

  it('rejects missing, multiple and duplicate answers', () => {
    expect(saveAssessmentQuestionInputSchema.safeParse({
      ...question,
      options: question.options.map((option) => ({ ...option, isCorrect: false })),
    }).success).toBe(false);
    expect(saveAssessmentQuestionInputSchema.safeParse({
      ...question,
      options: question.options.map((option) => ({ ...option, isCorrect: true })),
    }).success).toBe(false);
    expect(saveAssessmentQuestionInputSchema.safeParse({
      ...question,
      options: [
        { text: '同一答案', isCorrect: true },
        { text: ' 同一答案 ', isCorrect: false },
      ],
    }).success).toBe(false);
  });

  it('allows an explicit unknown answer and rejects duplicate question submissions', () => {
    const attemptId = '77777777-7777-4777-8777-777777777777';
    const attemptQuestionId = '88888888-8888-4888-8888-888888888888';
    const answer = { attemptQuestionId, selectedOptionId: null };
    expect(completeDiagnosticInputSchema.safeParse({ attemptId, answers: [answer] }).success).toBe(true);
    expect(completeDiagnosticInputSchema.safeParse({ attemptId, answers: [answer, answer] }).success).toBe(false);
    expect(saveDiagnosticAnswerInputSchema.safeParse({ attemptId, ...answer }).success).toBe(true);
  });

  it('requires an explicit, unique concept scope for targeted diagnostics', () => {
    expect(startDiagnosticInputSchema.safeParse({ graphId, nodeIds: [firstNodeId, secondNodeId] }).success).toBe(true);
    expect(startDiagnosticInputSchema.safeParse({ graphId, nodeIds: [] }).success).toBe(false);
    expect(startDiagnosticInputSchema.safeParse({ graphId, nodeIds: [firstNodeId, firstNodeId] }).success).toBe(false);
  });
});

describe('tutor decision schemas', () => {
  it('accepts only a valid decision response', () => {
    const decisionId = '99999999-9999-4999-8999-999999999999';
    expect(respondTutorDecisionInputSchema.safeParse({ decisionId, response: 'ACCEPTED' }).success).toBe(true);
    expect(respondTutorDecisionInputSchema.safeParse({ decisionId, response: 'IGNORED' }).success).toBe(false);
    expect(respondTutorDecisionInputSchema.safeParse({ decisionId: 'invalid', response: 'PENDING' }).success).toBe(false);
  });
});

describe('learning session schemas', () => {
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('allows only teaching-session actions and bounded drafts', () => {
    expect(startLearningSessionInputSchema.safeParse({
      graphId,
      nodeId: firstNodeId,
      action: 'TEACH',
    }).success).toBe(true);
    expect(startLearningSessionInputSchema.safeParse({
      graphId,
      nodeId: firstNodeId,
      action: 'PRACTICE',
    }).success).toBe(false);
    expect(saveLearningSessionDraftInputSchema.safeParse({
      sessionId,
      notes: '',
      stepIndex: 1,
    }).success).toBe(true);
    expect(saveLearningSessionDraftInputSchema.safeParse({
      sessionId,
      notes: 'x'.repeat(5_001),
      stepIndex: 3,
    }).success).toBe(false);
  });

  it('requires a nonblank reflection before completion', () => {
    expect(completeLearningSessionInputSchema.safeParse({ sessionId, notes: '我的理解' }).success).toBe(true);
    expect(completeLearningSessionInputSchema.safeParse({ sessionId, notes: '   ' }).success).toBe(false);
  });
});
