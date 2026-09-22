import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  KnowledgeGraphDocument,
  OpenLearnGraphApi,
  PracticeAnswerFeedbackView,
  PracticeAttemptView,
} from '../src/shared/contracts';
import { PracticeRunner } from '../src/renderer/features/practice/PracticeRunner';

const graph: KnowledgeGraphDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '练习图谱',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [{
    id: '22222222-2222-4222-8222-222222222222',
    graphId: '11111111-1111-4111-8111-111111111111',
    name: '梯度下降',
    description: '优化方法',
    position: { x: 0, y: 0 },
    status: 'LEARNING',
    learningPhase: 'LEARNING',
    statusReason: '正在学习。',
    evidenceCount: 1,
    lastEvidenceAt: '2026-01-01T00:00:00.000Z',
    latestEvidenceKind: 'LEARNING_SESSION_COMPLETED',
    mostRecentEvidenceKind: 'LEARNING_SESSION_COMPLETED',
    latestEvidenceScoreEarned: null,
    latestEvidenceScorePossible: null,
    diagnosticQuestionCount: 0,
    practiceQuestionCount: 1,
  }],
  edges: [],
};

const active: PracticeAttemptView = {
  id: '33333333-3333-4333-8333-333333333333',
  graphId: graph.id,
  nodeId: graph.nodes[0].id,
  nodeName: '梯度下降',
  mode: 'PRACTICE',
  status: 'IN_PROGRESS',
  sourceDecisionId: null,
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  questions: [{
    attemptQuestionId: '44444444-4444-4444-8444-444444444444',
    prompt: '学习率过大时可能发生什么？',
    options: [
      { id: '55555555-5555-4555-8555-555555555555', text: '震荡或发散' },
      { id: '66666666-6666-4666-8666-666666666666', text: '必然更快收敛' },
    ],
  }],
  answers: [],
};

const feedback: PracticeAnswerFeedbackView = {
  attemptQuestionId: active.questions[0].attemptQuestionId,
  selectedOptionId: active.questions[0].options[0].id,
  selectedOptionText: '震荡或发散',
  correctOptionId: active.questions[0].options[0].id,
  correctOptionText: '震荡或发散',
  explanation: '步长过大会越过低点。',
  isCorrect: true,
};

function installApi(overrides: Partial<OpenLearnGraphApi['practice']> = {}) {
  const practice = {
    list: vi.fn().mockResolvedValue([]),
    getActive: vi.fn().mockResolvedValue(null),
    get: vi.fn(),
    start: vi.fn().mockResolvedValue(active),
    saveAnswer: vi.fn().mockResolvedValue(feedback),
    complete: vi.fn().mockResolvedValue({
      attempt: { ...active, status: 'COMPLETED', completedAt: '2026-01-01T00:05:00.000Z', answers: [feedback] },
      evidence: {
        id: '77777777-7777-4777-8777-777777777777',
        nodeId: graph.nodes[0].id,
        kind: 'PRACTICE_RESULT',
        rating: null,
        note: '完成形成性练习',
        occurredAt: '2026-01-01T00:05:00.000Z',
        scoreEarned: 1,
        scorePossible: 1,
        assessmentAttemptId: null,
        learningSessionId: null,
        practiceAttemptId: active.id,
      },
      graph: {
        ...graph,
        nodes: [{ ...graph.nodes[0], latestEvidenceKind: 'PRACTICE_RESULT', latestEvidenceScoreEarned: 1, latestEvidenceScorePossible: 1 }],
      },
    }),
    cancel: vi.fn(),
    ...overrides,
  };
  window.openLearnGraph = { practice } as unknown as OpenLearnGraphApi;
  return practice;
}

describe('PracticeRunner', () => {
  it('shows immediate feedback and completes into non-mastery evidence', async () => {
    const api = installApi();
    const onGraphUpdated = vi.fn();
    render(
      <PracticeRunner
        graph={graph}
        launch={{ nodeId: graph.nodes[0].id, mode: 'PRACTICE' }}
        onClose={vi.fn()}
        onGraphUpdated={onGraphUpdated}
        onPracticeChanged={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    expect(await screen.findByText('学习率过大时可能发生什么？')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /震荡或发散/ }));
    expect(await screen.findByText('回答正确')).toBeVisible();
    expect(screen.getByText('解析：步长过大会越过低点。')).toBeVisible();
    expect(api.saveAnswer).toHaveBeenCalledWith({
      attemptId: active.id,
      attemptQuestionId: active.questions[0].attemptQuestionId,
      selectedOptionId: active.questions[0].options[0].id,
    });
    fireEvent.click(screen.getByRole('button', { name: '完成练习' }));
    expect(await screen.findByText('答对 1 / 1 题')).toBeVisible();
    expect(screen.getByText('完成 形成性练习 · 答对 1/1 题')).toBeVisible();
    expect(screen.getByText(/回看错题后进行客观诊断/)).toBeVisible();
    expect(screen.getByText('这是一条形成性练习证据，不会直接把概念标记为已掌握。')).toBeVisible();
    expect(onGraphUpdated).toHaveBeenCalled();
  });

  it('restores answered feedback from an active practice', async () => {
    const restored = { ...active, answers: [feedback] };
    const api = installApi({ getActive: vi.fn().mockResolvedValue(restored) });
    render(
      <PracticeRunner
        graph={graph}
        launch={{}}
        onClose={vi.fn()}
        onGraphUpdated={vi.fn()}
        onPracticeChanged={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    expect(await screen.findByText('回答正确')).toBeVisible();
    expect(screen.getByText('解析：步长过大会越过低点。')).toBeVisible();
    await waitFor(() => expect(api.getActive).toHaveBeenCalledWith(graph.id));
    expect(api.saveAnswer).not.toHaveBeenCalled();
  });
});
