import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  KnowledgeGraphDocument,
  LearningSessionView,
  OpenLearnGraphApi,
} from '../src/shared/contracts';
import { LearningSessionRunner } from '../src/renderer/features/session/LearningSessionRunner';

const graph: KnowledgeGraphDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '会话图谱',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [{
    id: '22222222-2222-4222-8222-222222222222',
    graphId: '11111111-1111-4111-8111-111111111111',
    name: '梯度下降',
    description: '梯度下降沿目标函数的负梯度方向逐步更新参数。',
    position: { x: 0, y: 0 },
    status: 'AVAILABLE',
    learningPhase: 'NOT_STARTED',
    statusReason: '可以开始学习。',
    evidenceCount: 0,
    lastEvidenceAt: null,
    latestEvidenceKind: null,
    latestEvidenceScoreEarned: null,
    latestEvidenceScorePossible: null,
    diagnosticQuestionCount: 0,
  }],
  edges: [],
};

const activeSession: LearningSessionView = {
  id: '33333333-3333-4333-8333-333333333333',
  graphId: graph.id,
  nodeId: graph.nodes[0].id,
  nodeName: '梯度下降',
  description: graph.nodes[0].description,
  prerequisites: [],
  action: 'TEACH',
  status: 'IN_PROGRESS',
  notes: '',
  stepIndex: 0,
  sourceDecisionId: null,
  startedAt: '2026-01-01T08:00:00.000Z',
  updatedAt: '2026-01-01T08:00:00.000Z',
  completedAt: null,
};

function installApi(overrides: Partial<OpenLearnGraphApi['sessions']> = {}): OpenLearnGraphApi['sessions'] {
  const sessions: OpenLearnGraphApi['sessions'] = {
    list: vi.fn().mockResolvedValue([]),
    getActive: vi.fn().mockResolvedValue(null),
    get: vi.fn(),
    start: vi.fn().mockResolvedValue(activeSession),
    saveDraft: vi.fn().mockImplementation((input) => Promise.resolve({
      ...activeSession,
      notes: input.notes,
      stepIndex: input.stepIndex,
    })),
    complete: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
  window.openLearnGraph = { sessions } as unknown as OpenLearnGraphApi;
  return sessions;
}

describe('LearningSessionRunner', () => {
  it('autosaves active recall and only creates evidence when explicitly completed', async () => {
    const completedGraph: KnowledgeGraphDocument = {
      ...graph,
      nodes: [{
        ...graph.nodes[0],
        status: 'LEARNING',
        learningPhase: 'LEARNING',
        statusReason: '你已经开始学习。',
        evidenceCount: 1,
        latestEvidenceKind: 'LEARNING_SESSION_COMPLETED',
      }],
    };
    const sessions = installApi({
      complete: vi.fn().mockResolvedValue({
        session: {
          ...activeSession,
          status: 'COMPLETED',
          stepIndex: 2,
          notes: '它沿负梯度方向更新参数。',
          completedAt: '2026-01-01T09:00:00.000Z',
        },
        evidence: {
          id: '44444444-4444-4444-8444-444444444444',
          nodeId: graph.nodes[0].id,
          kind: 'LEARNING_SESSION_COMPLETED',
          rating: null,
          note: '它沿负梯度方向更新参数。',
          occurredAt: '2026-01-01T09:00:00.000Z',
          scoreEarned: null,
          scorePossible: null,
          assessmentAttemptId: null,
          learningSessionId: activeSession.id,
        },
        graph: completedGraph,
      }),
    });
    const onGraphUpdated = vi.fn();
    render(
      <LearningSessionRunner
        graph={graph}
        launch={{ nodeId: graph.nodes[0].id, action: 'TEACH' }}
        onClose={vi.fn()}
        onGraphUpdated={onGraphUpdated}
        onSessionChanged={vi.fn()}
        onDraftDirtyChange={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    expect(await screen.findByText('本次学习内容')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '开始主动回忆' }));
    const textarea = await screen.findByRole('textbox', { name: /我的理解/ });
    fireEvent.change(textarea, { target: { value: '它沿负梯度方向更新参数。' } });
    await waitFor(() => expect(sessions.saveDraft).toHaveBeenCalledWith({
      sessionId: activeSession.id,
      notes: '它沿负梯度方向更新参数。',
      stepIndex: 1,
    }), { timeout: 2_000 });

    fireEvent.click(screen.getByRole('button', { name: '查看学习总结' }));
    const completeButton = screen.getByRole('button', { name: '完成学习会话' });
    await waitFor(() => expect(completeButton).toBeEnabled());
    fireEvent.click(completeButton);

    await waitFor(() => expect(sessions.complete).toHaveBeenCalledWith({
      sessionId: activeSession.id,
      notes: '它沿负梯度方向更新参数。',
    }));
    expect(onGraphUpdated).toHaveBeenCalledWith(completedGraph);
    expect(await screen.findByText('这次留下的学习总结')).toBeVisible();
  });

  it('restores the exact step and saves once more before closing', async () => {
    const restored = { ...activeSession, notes: '已经写好的草稿', stepIndex: 1 };
    const sessions = installApi({
      getActive: vi.fn().mockResolvedValue(restored),
      list: vi.fn().mockResolvedValue([restored]),
      saveDraft: vi.fn().mockResolvedValue(restored),
    });
    const onClose = vi.fn();
    render(
      <LearningSessionRunner
        graph={graph}
        launch={{}}
        onClose={onClose}
        onGraphUpdated={vi.fn()}
        onSessionChanged={vi.fn()}
        onDraftDirtyChange={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    expect(await screen.findByDisplayValue('已经写好的草稿')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '保存并关闭学习会话' }));
    await waitFor(() => expect(sessions.saveDraft).toHaveBeenCalledWith({
      sessionId: restored.id,
      notes: restored.notes,
      stepIndex: 1,
    }));
    expect(onClose).toHaveBeenCalled();
  });
});
