import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  CompleteDiagnosticResult,
  DiagnosticAttemptView,
  KnowledgeGraphDocument,
  OpenLearnGraphApi,
} from '../src/shared/contracts';
import { DiagnosticRunner } from '../src/renderer/features/assessment/DiagnosticRunner';

const graph: KnowledgeGraphDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '线性代数',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [{
    id: '22222222-2222-4222-8222-222222222222',
    graphId: '11111111-1111-4111-8111-111111111111',
    name: '矩阵乘法',
    description: '',
    position: { x: 0, y: 0 },
    status: 'AVAILABLE',
    learningPhase: 'NOT_STARTED',
    statusReason: '可以开始学习。',
    evidenceCount: 0,
    lastEvidenceAt: null,
    latestEvidenceKind: null,
    latestEvidenceScoreEarned: null,
    latestEvidenceScorePossible: null,
    diagnosticQuestionCount: 2,
  }],
  edges: [],
};

const attempt: DiagnosticAttemptView = {
  id: '33333333-3333-4333-8333-333333333333',
  graphId: graph.id,
  startedAt: '2026-01-02T00:00:00.000Z',
  questions: [
    {
      attemptQuestionId: '44444444-4444-4444-8444-444444444444',
      nodeId: graph.nodes[0].id,
      nodeName: graph.nodes[0].name,
      prompt: '第一题',
      options: [
        { id: '55555555-5555-4555-8555-555555555555', text: '答案 A' },
        { id: '66666666-6666-4666-8666-666666666666', text: '答案 B' },
      ],
    },
    {
      attemptQuestionId: '77777777-7777-4777-8777-777777777777',
      nodeId: graph.nodes[0].id,
      nodeName: graph.nodes[0].name,
      prompt: '第二题',
      options: [
        { id: '88888888-8888-4888-8888-888888888888', text: '答案 C' },
        { id: '99999999-9999-4999-8999-999999999999', text: '答案 D' },
      ],
    },
  ],
};

function result(): CompleteDiagnosticResult {
  return {
    attemptId: attempt.id,
    startedAt: attempt.startedAt,
    completedAt: '2026-01-02T00:10:00.000Z',
    correctCount: 1,
    questionCount: 2,
    nodeResults: [{
      nodeId: graph.nodes[0].id,
      nodeName: graph.nodes[0].name,
      correctCount: 1,
      questionCount: 2,
      passed: false,
    }],
    questionResults: [
      {
        attemptQuestionId: attempt.questions[0].attemptQuestionId,
        nodeId: graph.nodes[0].id,
        nodeName: graph.nodes[0].name,
        prompt: '第一题',
        selectedOptionText: '答案 A',
        correctOptionText: '答案 A',
        explanation: '第一题解析',
        isCorrect: true,
      },
      {
        attemptQuestionId: attempt.questions[1].attemptQuestionId,
        nodeId: graph.nodes[0].id,
        nodeName: graph.nodes[0].name,
        prompt: '第二题',
        selectedOptionText: null,
        correctOptionText: '答案 C',
        explanation: '第二题解析',
        isCorrect: false,
      },
    ],
    evidence: [],
    graph: {
      ...graph,
      nodes: [{
        ...graph.nodes[0],
        status: 'LEARNING',
        learningPhase: 'LEARNING',
        statusReason: '最近一次诊断答对 1/2 题，尚未达到 80% 的掌握标准。',
        evidenceCount: 1,
        latestEvidenceKind: 'DIAGNOSTIC_RESULT',
        latestEvidenceScoreEarned: 1,
        latestEvidenceScorePossible: 2,
      }],
    },
  };
}

function installAssessmentApi(overrides: Partial<OpenLearnGraphApi['assessments']> = {}) {
  const assessments = {
    listQuestions: vi.fn(),
    saveQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    listDiagnosticAttempts: vi.fn().mockResolvedValue([]),
    startDiagnostic: vi.fn().mockResolvedValue(attempt),
    resumeDiagnostic: vi.fn(),
    saveDiagnosticAnswer: vi.fn().mockResolvedValue(undefined),
    cancelDiagnostic: vi.fn().mockResolvedValue(undefined),
    getDiagnosticResult: vi.fn(),
    completeDiagnostic: vi.fn().mockResolvedValue(result()),
    ...overrides,
  };
  window.openLearnGraph = { assessments } as unknown as OpenLearnGraphApi;
  return assessments;
}

describe('DiagnosticRunner', () => {
  it('submits explicit answers and presents persisted results', async () => {
    const api = installAssessmentApi();
    const onGraphUpdated = vi.fn();
    render(<DiagnosticRunner graph={graph} onClose={vi.fn()} onGraphUpdated={onGraphUpdated} onMessage={vi.fn()} />);
    expect(screen.getByText('1', { selector: '.diagnostic-coverage strong' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /开始诊断/ }));

    expect(await screen.findByRole('heading', { name: '第一题' })).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: /答案 A/ }));
    await waitFor(() => expect(api.saveDiagnosticAnswer).toHaveBeenCalledWith({
      attemptId: attempt.id,
      attemptQuestionId: attempt.questions[0].attemptQuestionId,
      selectedOptionId: attempt.questions[0].options[0].id,
    }));
    fireEvent.click(screen.getByRole('button', { name: '下一题' }));
    fireEvent.click(screen.getByRole('radio', { name: /我不知道/ }));
    await waitFor(() => expect(api.saveDiagnosticAnswer).toHaveBeenLastCalledWith({
      attemptId: attempt.id,
      attemptQuestionId: attempt.questions[1].attemptQuestionId,
      selectedOptionId: null,
    }));
    fireEvent.click(screen.getByRole('button', { name: '提交诊断' }));

    await waitFor(() => expect(api.completeDiagnostic).toHaveBeenCalledWith({
      attemptId: attempt.id,
      answers: [
        { attemptQuestionId: attempt.questions[0].attemptQuestionId, selectedOptionId: attempt.questions[0].options[0].id },
        { attemptQuestionId: attempt.questions[1].attemptQuestionId, selectedOptionId: null },
      ],
    }));
    expect(await screen.findByRole('heading', { name: '答对 1 / 2 题' })).toBeVisible();
    expect(screen.getByText('正确答案：答案 C')).toBeVisible();
    expect(onGraphUpdated).toHaveBeenCalledWith(result().graph);
  });

  it('keeps an interrupted diagnostic available when the learner leaves for later', async () => {
    const api = installAssessmentApi();
    const onClose = vi.fn();
    render(<DiagnosticRunner graph={graph} onClose={onClose} onGraphUpdated={vi.fn()} onMessage={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /开始诊断/ }));
    await screen.findByRole('heading', { name: '第一题' });
    fireEvent.click(screen.getByRole('button', { name: '稍后继续' }));
    expect(api.cancelDiagnostic).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('requires explicit confirmation before discarding recovered progress', async () => {
    const inProgress = {
      id: attempt.id,
      graphId: graph.id,
      status: 'IN_PROGRESS' as const,
      startedAt: attempt.startedAt,
      completedAt: null,
      questionCount: 2,
      answeredCount: 1,
      correctCount: null,
      nodeCount: 1,
    };
    const api = installAssessmentApi({
      listDiagnosticAttempts: vi.fn()
        .mockResolvedValueOnce([inProgress])
        .mockResolvedValueOnce([{ ...inProgress, status: 'CANCELLED', completedAt: '2026-01-02T00:05:00.000Z' }]),
    });
    render(<DiagnosticRunner graph={graph} onClose={vi.fn()} onGraphUpdated={vi.fn()} onMessage={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '放弃' }));
    expect(screen.getByRole('alertdialog', { name: '放弃这次诊断？' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '放弃诊断' }));
    await waitFor(() => expect(api.cancelDiagnostic).toHaveBeenCalledWith(attempt.id));
  });

  it('restores saved answers and continues at the first unanswered question', async () => {
    const inProgress = {
      id: attempt.id,
      graphId: graph.id,
      status: 'IN_PROGRESS' as const,
      startedAt: attempt.startedAt,
      completedAt: null,
      questionCount: 2,
      answeredCount: 1,
      correctCount: null,
      nodeCount: 1,
    };
    const api = installAssessmentApi({
      listDiagnosticAttempts: vi.fn().mockResolvedValue([inProgress]),
      resumeDiagnostic: vi.fn().mockResolvedValue({
        ...attempt,
        answers: [{
          attemptQuestionId: attempt.questions[0].attemptQuestionId,
          selectedOptionId: attempt.questions[0].options[0].id,
        }],
      }),
    });
    render(<DiagnosticRunner graph={graph} onClose={vi.fn()} onGraphUpdated={vi.fn()} onMessage={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '继续作答' }));
    expect(await screen.findByRole('heading', { name: '第二题' })).toBeVisible();
    expect(screen.getByText('1 / 2 已作答')).toBeVisible();
    expect(api.resumeDiagnostic).toHaveBeenCalledWith(attempt.id);
  });

  it('opens a historical result and starts a targeted retest for failed concepts', async () => {
    const completed = {
      id: attempt.id,
      graphId: graph.id,
      status: 'COMPLETED' as const,
      startedAt: attempt.startedAt,
      completedAt: result().completedAt,
      questionCount: 2,
      answeredCount: 2,
      correctCount: 1,
      nodeCount: 1,
    };
    const review = result();
    const api = installAssessmentApi({
      listDiagnosticAttempts: vi.fn().mockResolvedValue([completed]),
      getDiagnosticResult: vi.fn().mockResolvedValue(review),
    });
    render(<DiagnosticRunner graph={graph} onClose={vi.fn()} onGraphUpdated={vi.fn()} onMessage={vi.fn()} />);

    fireEvent.click(await screen.findByRole('tab', { name: '历史记录 · 1' }));
    fireEvent.click(screen.getByRole('button', { name: '查看结果' }));
    expect(await screen.findByRole('heading', { name: '答对 1 / 2 题' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重测未掌握概念 · 1' }));
    fireEvent.click(screen.getByRole('button', { name: '开始诊断 · 2 题' }));
    await waitFor(() => expect(api.startDiagnostic).toHaveBeenCalledWith({
      graphId: graph.id,
      nodeIds: [graph.nodes[0].id],
    }));
  });
});
