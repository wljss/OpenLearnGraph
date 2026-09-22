import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  CandidateWorkspaceView,
  KnowledgeGraphDocument,
  OpenLearnGraphApi,
} from '../src/shared/contracts';
import { CandidateWorkspace } from '../src/renderer/features/documents/CandidateWorkspace';

const graph: KnowledgeGraphDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '机器学习',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [],
  edges: [],
};

const workspace: CandidateWorkspaceView = {
  concepts: [
    {
      id: '22222222-2222-4222-8222-222222222222', graphId: graph.id,
      documentId: '44444444-4444-4444-8444-444444444444',
      documentTitle: '课程资料', documentSourceName: 'course.md', sectionPosition: 0,
      sourceLocator: '第 1–4 行', sourceStartOffset: 0, sourceEndOffset: 4,
      sourceQuote: '线性回归', name: '线性回归', description: '', origin: 'MANUAL', sourceModel: null, status: 'PENDING',
      acceptedNodeId: null, duplicateNodeId: null, duplicateNodeName: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', reviewedAt: null,
    },
    {
      id: '33333333-3333-4333-8333-333333333333', graphId: graph.id,
      documentId: '44444444-4444-4444-8444-444444444444',
      documentTitle: '课程资料', documentSourceName: 'course.md', sectionPosition: 1,
      sourceLocator: '第 5–8 行', sourceStartOffset: 0, sourceEndOffset: 4,
      sourceQuote: '梯度下降', name: '梯度下降', description: '', origin: 'MANUAL', sourceModel: null, status: 'PENDING',
      acceptedNodeId: null, duplicateNodeId: null, duplicateNodeName: null,
      createdAt: '2026-01-01T00:01:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z', reviewedAt: null,
    },
  ],
  relationships: [],
  pendingConceptCount: 2,
  pendingRelationshipCount: 0,
  blockingIssues: [],
};

function installApi(initialWorkspace: CandidateWorkspaceView = workspace): OpenLearnGraphApi['candidates'] {
  const withRelationship: CandidateWorkspaceView = {
    ...workspace,
    pendingRelationshipCount: 1,
    relationships: [{
      id: '55555555-5555-4555-8555-555555555555', graphId: graph.id,
      sourceCandidateId: workspace.concepts[0].id,
      targetCandidateId: workspace.concepts[1].id,
      relationship: 'PREREQUISITE', status: 'PENDING', acceptedEdgeId: null,
      createdAt: '2026-01-01T00:02:00.000Z',
    }],
  };
  const candidates: OpenLearnGraphApi['candidates'] = {
    getWorkspace: vi.fn().mockResolvedValue(initialWorkspace),
    createConcept: vi.fn(),
    updateConcept: vi.fn().mockResolvedValue(workspace),
    reviewConcept: vi.fn().mockResolvedValue(workspace),
    createRelationship: vi.fn().mockResolvedValue(withRelationship),
    deleteRelationship: vi.fn().mockResolvedValue(workspace),
    apply: vi.fn().mockResolvedValue({
      graph: { ...graph, nodes: [{
        id: '66666666-6666-4666-8666-666666666666', graphId: graph.id,
        name: '线性回归', description: '', position: { x: 90, y: 90 },
        status: 'AVAILABLE', learningPhase: 'NOT_STARTED', statusReason: '',
        evidenceCount: 0, lastEvidenceAt: null, latestEvidenceKind: null,
        mostRecentEvidenceKind: null, latestEvidenceScoreEarned: null,
        latestEvidenceScorePossible: null, diagnosticQuestionCount: 0, practiceQuestionCount: 0,
      }] },
      acceptedConceptCount: 2,
      acceptedRelationshipCount: 1,
    }),
  };
  window.openLearnGraph = { candidates } as unknown as OpenLearnGraphApi;
  return candidates;
}

describe('CandidateWorkspace', () => {
  it('edits candidates, creates a prerequisite, and only applies after confirmation', async () => {
    const candidates = installApi();
    const onGraphUpdated = vi.fn();
    render(<CandidateWorkspace
      graph={graph}
      onClose={vi.fn()}
      onNavigateSource={vi.fn()}
      onGraphUpdated={onGraphUpdated}
      onMessage={vi.fn()}
    />);
    expect(await screen.findByText('建议学习的内容')).toBeVisible();
    expect(screen.getByText('出处与结构检查已完成。你可以直接整体确认，也可以逐项核对。')).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: '修改' })[0]);
    const nameInputs = screen.getAllByLabelText('学习内容名称');
    fireEvent.change(nameInputs[0], { target: { value: '一元线性回归' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并保留' }));
    await waitFor(() => expect(candidates.updateConcept).toHaveBeenCalledWith(expect.objectContaining({ name: '一元线性回归' })));

    fireEvent.click(screen.getByText('调整学习顺序（可选）'));
    fireEvent.click(screen.getByRole('button', { name: '添加学习顺序' }));
    await waitFor(() => expect(candidates.createRelationship).toHaveBeenCalledWith({
      graphId: graph.id,
      sourceCandidateId: workspace.concepts[0].id,
      targetCandidateId: workspace.concepts[1].id,
    }));
    expect(await screen.findByRole('button', { name: '移除此顺序' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '加入“机器学习”' }));
    expect(screen.getByRole('alertdialog', { name: '将这条学习路线加入“机器学习”？' })).toBeVisible();
    expect(screen.getByText(/已有的 0 个概念和 0 条关系不会被覆盖/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '加入学习路线' }));
    await waitFor(() => expect(candidates.apply).toHaveBeenCalledWith(graph.id));
    expect(onGraphUpdated).toHaveBeenCalledTimes(1);
  });

  it('keeps source navigation available from the review card', async () => {
    installApi();
    const onNavigateSource = vi.fn();
    render(<CandidateWorkspace
      graph={graph}
      onClose={vi.fn()}
      onNavigateSource={onNavigateSource}
      onGraphUpdated={vi.fn()}
      onMessage={vi.fn()}
    />);
    fireEvent.click(await screen.findByRole('button', { name: /课程资料 · 第 1–4 行/ }));
    expect(onNavigateSource).toHaveBeenCalledWith(workspace.concepts[0]);
  });

  it('lets the user optionally confirm or exclude a suggestion in plain language', async () => {
    const candidates = installApi();
    render(<CandidateWorkspace
      graph={graph}
      onClose={vi.fn()}
      onNavigateSource={vi.fn()}
      onGraphUpdated={vi.fn()}
      onMessage={vi.fn()}
    />);
    fireEvent.click((await screen.findAllByRole('button', { name: '保留' }))[0]);
    await waitFor(() => expect(candidates.reviewConcept).toHaveBeenCalledWith({
      candidateId: workspace.concepts[0].id,
      status: 'PENDING',
    }));
    fireEvent.click(screen.getAllByRole('button', { name: '不加入' })[1]);
    await waitFor(() => expect(candidates.reviewConcept).toHaveBeenCalledWith({
      candidateId: workspace.concepts[1].id,
      status: 'IGNORED',
    }));
  });

  it('shows accepted prerequisite relationships in review history', async () => {
    const accepted: CandidateWorkspaceView = {
      concepts: workspace.concepts.map((concept, index) => ({
        ...concept,
        status: 'ACCEPTED',
        acceptedNodeId: index === 0
          ? '66666666-6666-4666-8666-666666666666'
          : '88888888-8888-4888-8888-888888888888',
      })),
      relationships: [{
        id: '55555555-5555-4555-8555-555555555555', graphId: graph.id,
        sourceCandidateId: workspace.concepts[0].id,
        targetCandidateId: workspace.concepts[1].id,
        relationship: 'PREREQUISITE', status: 'ACCEPTED',
        acceptedEdgeId: '77777777-7777-4777-8777-777777777777',
        createdAt: '2026-01-01T00:02:00.000Z',
      }],
      pendingConceptCount: 0,
      pendingRelationshipCount: 0,
      blockingIssues: [],
    };
    installApi(accepted);
    render(<CandidateWorkspace
      graph={graph}
      onClose={vi.fn()}
      onNavigateSource={vi.fn()}
      onGraphUpdated={vi.fn()}
      onMessage={vi.fn()}
    />);
    expect(await screen.findByText('这批学习路线已经加入图谱')).toBeVisible();
    fireEvent.click(screen.getByText(/已排除与已写入记录（2 项内容 · 1 条顺序）/));
    expect(screen.getByText('学习顺序记录')).toBeVisible();
    expect(screen.getAllByText(/已加入图谱/)).toHaveLength(3);
  });
});
