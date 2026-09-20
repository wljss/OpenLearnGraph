import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  KnowledgeGraphDocument,
  OpenLearnGraphApi,
  TutorDecisionView,
} from '../src/shared/contracts';
import { TutorRecommendation } from '../src/renderer/features/tutor/TutorRecommendation';

const graph: KnowledgeGraphDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '测试图谱',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [{
    id: '22222222-2222-4222-8222-222222222222',
    graphId: '11111111-1111-4111-8111-111111111111',
    name: '线性代数',
    description: '',
    position: { x: 0, y: 0 },
    status: 'AVAILABLE',
    learningPhase: 'NOT_STARTED',
    statusReason: '可以开始学习。',
    evidenceCount: 0,
    lastEvidenceAt: null,
    latestEvidenceKind: null,
    mostRecentEvidenceKind: null,
    latestEvidenceScoreEarned: null,
    latestEvidenceScorePossible: null,
    diagnosticQuestionCount: 0,
    practiceQuestionCount: 0,
  }],
  edges: [],
};

const decision: TutorDecisionView = {
  id: '33333333-3333-4333-8333-333333333333',
  graphId: graph.id,
  targetNodeId: graph.nodes[0].id,
  targetNodeName: '线性代数',
  action: 'TEACH',
  reasonCode: 'START_FOUNDATION',
  reason: '这是当前可直接开始的基础概念。',
  evidence: ['没有未完成的先修概念'],
  context: {},
  response: 'PENDING',
  isStale: false,
  sourceVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function installTutorApi(): OpenLearnGraphApi {
  const api: OpenLearnGraphApi = {
    graphs: { list: vi.fn(), create: vi.fn(), load: vi.fn(), save: vi.fn() },
    learning: { listEvidence: vi.fn(), recordEvidence: vi.fn() },
    assessments: {
      listQuestions: vi.fn(),
      saveQuestion: vi.fn(),
      deleteQuestion: vi.fn(),
      listDiagnosticAttempts: vi.fn(),
      startDiagnostic: vi.fn(),
      resumeDiagnostic: vi.fn(),
      saveDiagnosticAnswer: vi.fn(),
      cancelDiagnostic: vi.fn(),
      getDiagnosticResult: vi.fn(),
      completeDiagnostic: vi.fn(),
    },
    tutor: {
      getRecommendation: vi.fn().mockResolvedValue(decision),
      listDecisions: vi.fn().mockResolvedValue([decision]),
      respondDecision: vi.fn().mockImplementation(({ response }) => Promise.resolve({
        ...decision,
        response,
      })),
    },
    sessions: {
      list: vi.fn(),
      getActive: vi.fn(),
      get: vi.fn(),
      start: vi.fn(),
      saveDraft: vi.fn(),
      complete: vi.fn(),
      cancel: vi.fn(),
    },
    practice: {
      list: vi.fn(), getActive: vi.fn(), get: vi.fn(), start: vi.fn(),
      saveAnswer: vi.fn(), complete: vi.fn(), cancel: vi.fn(),
    },
    documents: {
      list: vi.fn(), get: vi.fn(), listSections: vi.fn(), getSection: vi.fn(),
      search: vi.fn(), chooseFile: vi.fn(), confirmImport: vi.fn(),
      discardPreview: vi.fn(), delete: vi.fn(),
    },
    candidates: {
      getWorkspace: vi.fn(), createConcept: vi.fn(), updateConcept: vi.fn(),
      reviewConcept: vi.fn(), createRelationship: vi.fn(), deleteRelationship: vi.fn(), apply: vi.fn(),
    },
    lifecycle: { setUnsavedChanges: vi.fn() },
  };
  window.openLearnGraph = api;
  return api;
}

describe('TutorRecommendation', () => {
  it('explains a recommendation and only executes it after recording acceptance', async () => {
    const api = installTutorApi();
    const onExecute = vi.fn();
    render(
      <TutorRecommendation
        graph={graph}
        structureDirty={false}
        disabled={false}
        onExecute={onExecute}
        onMessage={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: '开始学习：线性代数' })).toBeVisible();
    fireEvent.click(screen.getByText('为什么这样建议'));
    expect(screen.getByText('没有未完成的先修概念')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '查看这个概念' }));

    await waitFor(() => expect(api.tutor.respondDecision).toHaveBeenCalledWith({
      decisionId: decision.id,
      response: 'ACCEPTED',
    }));
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ response: 'ACCEPTED' }));
    expect(api.learning.recordEvidence).not.toHaveBeenCalled();
  });

  it('pauses generation while the graph has unsaved structure changes', () => {
    const api = installTutorApi();
    render(
      <TutorRecommendation
        graph={graph}
        structureDirty
        disabled={false}
        onExecute={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    expect(screen.getByText('保存后生成下一步建议')).toBeVisible();
    expect(api.tutor.getRecommendation).not.toHaveBeenCalled();
  });
});
