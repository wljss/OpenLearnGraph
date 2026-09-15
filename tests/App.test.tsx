import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraphDocument, OpenLearnGraphApi, SaveGraphInput } from '../src/shared/contracts';
import { App } from '../src/renderer/App';

const firstGraph: KnowledgeGraphDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '机器学习基础',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [{
    id: '22222222-2222-4222-8222-222222222222',
    graphId: '11111111-1111-4111-8111-111111111111',
    name: '线性代数',
    description: '基础知识',
    position: { x: 120, y: 120 },
    status: 'AVAILABLE',
    learningPhase: 'NOT_STARTED',
    statusReason: '没有未完成的先修概念，可以开始学习。',
    evidenceCount: 0,
    lastEvidenceAt: null,
    latestEvidenceKind: null,
    latestEvidenceScoreEarned: null,
    latestEvidenceScorePossible: null,
    diagnosticQuestionCount: 0,
  }],
  edges: [],
};

const secondGraph: KnowledgeGraphDocument = {
  ...firstGraph,
  id: '33333333-3333-4333-8333-333333333333',
  name: '深度学习',
  nodes: [],
};

function summary(graph: KnowledgeGraphDocument) {
  const { id, name, createdAt, updatedAt } = graph;
  return { id, name, createdAt, updatedAt };
}

function savedDocument(input: SaveGraphInput): KnowledgeGraphDocument {
  return {
    id: input.id,
    name: input.name.trim(),
    createdAt: firstGraph.createdAt,
    updatedAt: '2026-01-02T00:00:00.000Z',
    nodes: input.nodes.map((node) => ({
      ...node,
      graphId: input.id,
      status: 'AVAILABLE',
      learningPhase: 'NOT_STARTED',
      statusReason: '没有未完成的先修概念，可以开始学习。',
      evidenceCount: 0,
      lastEvidenceAt: null,
      latestEvidenceKind: null,
      latestEvidenceScoreEarned: null,
      latestEvidenceScorePossible: null,
      diagnosticQuestionCount: 0,
    })),
    edges: input.edges.map((edge) => ({ ...edge, graphId: input.id })),
  };
}

function installApi(overrides: Partial<OpenLearnGraphApi['graphs']> = {}): OpenLearnGraphApi {
  const api: OpenLearnGraphApi = {
    graphs: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      load: vi.fn(),
      save: vi.fn().mockImplementation(savedDocument),
      ...overrides,
    },
    learning: {
      listEvidence: vi.fn().mockResolvedValue([]),
      recordEvidence: vi.fn(),
    },
    assessments: {
      listQuestions: vi.fn().mockResolvedValue([]),
      saveQuestion: vi.fn(),
      deleteQuestion: vi.fn(),
      startDiagnostic: vi.fn(),
      cancelDiagnostic: vi.fn(),
      completeDiagnostic: vi.fn(),
    },
    lifecycle: { setUnsavedChanges: vi.fn() },
  };
  window.openLearnGraph = api;
  return api;
}

describe('renderer user flows', () => {
  beforeEach(() => installApi());

  it('loads the shell and explains how to create the first graph', async () => {
    render(<App />);
    await screen.findByText('把学习目标变成一张活的知识地图');
    expect(screen.getByRole('button', { name: /创建图谱/ })).toBeDisabled();
    expect(screen.getByText('创建第一个知识图谱，开始搭建学习地图。')).toBeVisible();
    expect(screen.getByText('先创建知识图谱')).toBeVisible();
    expect(screen.queryByRole('button', { name: '添加第一个概念' })).not.toBeInTheDocument();
  });

  it('creates a named graph and confirms that it was saved locally', async () => {
    const created = { ...firstGraph, nodes: [] };
    const api = installApi({
      list: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([summary(created)]),
      create: vi.fn().mockResolvedValue(created),
    });
    render(<App />);
    await screen.findByText('把学习目标变成一张活的知识地图');

    fireEvent.change(screen.getByLabelText('新图谱名称'), { target: { value: '  机器学习基础  ' } });
    fireEvent.click(screen.getByRole('button', { name: /创建图谱/ }));

    await waitFor(() => expect(api.graphs.create).toHaveBeenCalledWith({ name: '机器学习基础' }));
    expect(await screen.findByText('知识图谱已创建并保存到本机。')).toBeVisible();
    expect(screen.getByRole('button', { name: /已保存/ })).toBeDisabled();
  });

  it('adds, immediately names, and saves a concept with Ctrl+S', async () => {
    const api = installApi({
      list: vi.fn().mockResolvedValue([summary(firstGraph)]),
      load: vi.fn().mockResolvedValue(firstGraph),
      save: vi.fn().mockImplementation(savedDocument),
    });
    render(<App />);
    await screen.findByText('已从本机加载知识图谱。');

    fireEvent.click(screen.getByRole('button', { name: /添加概念/ }));
    const nameInput = screen.getByLabelText('名称');
    expect(nameInput).toHaveValue('新概念 1');
    expect(nameInput).toHaveFocus();
    expect(screen.getByRole('button', { name: /4 分/ })).toBeDisabled();
    expect(screen.getByText('请先保存图谱结构，再记录学习状态。')).toBeVisible();
    fireEvent.change(nameInput, { target: { value: '神经网络' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });

    await waitFor(() => expect(api.graphs.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.graphs.save).mock.calls[0][0].nodes.map((node) => node.name))
      .toEqual(['线性代数', '神经网络']);
    expect(await screen.findByText('全部更改已安全保存到本机。')).toBeVisible();
    expect(api.lifecycle.setUnsavedChanges).toHaveBeenCalledWith(true);
    expect(api.lifecycle.setUnsavedChanges).toHaveBeenLastCalledWith(false);
  });

  it('asks before switching away from unsaved changes', async () => {
    const api = installApi({
      list: vi.fn().mockResolvedValue([summary(firstGraph), summary(secondGraph)]),
      load: vi.fn().mockImplementation((id: string) => Promise.resolve(id === firstGraph.id ? firstGraph : secondGraph)),
    });
    render(<App />);
    await screen.findByText('已从本机加载知识图谱。');
    fireEvent.click(screen.getByRole('button', { name: /添加概念/ }));
    fireEvent.click(screen.getByRole('button', { name: /深度学习/ }));

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('切换知识图谱？')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus();
    expect(api.graphs.load).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.graphs.load).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /深度学习/ }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '放弃更改并切换' }));

    await waitFor(() => expect(api.graphs.load).toHaveBeenCalledWith(secondGraph.id));
    expect(await screen.findByDisplayValue('深度学习')).toBeVisible();
  });

  it('requires confirmation before deleting a concept', async () => {
    installApi({
      list: vi.fn().mockResolvedValue([summary(firstGraph)]),
      load: vi.fn().mockResolvedValue(firstGraph),
    });
    render(<App />);
    await screen.findByText('已从本机加载知识图谱。');
    fireEvent.click(screen.getByText('线性代数'));
    fireEvent.click(screen.getByRole('button', { name: '删除概念' }));

    const dialog = screen.getByRole('alertdialog');
    expect(screen.getByText('线性代数')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: '删除概念' }));

    await waitFor(() => expect(screen.queryByText('线性代数')).not.toBeInTheDocument());
    expect(screen.getByText('概念及其关联数据已标记删除。保存后永久生效。')).toBeVisible();
  });

  it('starts learning and immediately explains the persisted evidence', async () => {
    const evidence = {
      id: '44444444-4444-4444-8444-444444444444',
      nodeId: firstGraph.nodes[0].id,
      kind: 'STUDY_STARTED' as const,
      rating: null,
      note: '',
      occurredAt: '2026-01-02T08:00:00.000Z',
      scoreEarned: null,
      scorePossible: null,
      assessmentAttemptId: null,
    };
    const learningGraph: KnowledgeGraphDocument = {
      ...firstGraph,
      nodes: [{
        ...firstGraph.nodes[0],
        status: 'LEARNING',
        learningPhase: 'LEARNING',
        statusReason: '你已经开始学习；继续记录练习或自评证据。',
        evidenceCount: 1,
        lastEvidenceAt: evidence.occurredAt,
      }],
    };
    const api = installApi({
      list: vi.fn().mockResolvedValue([summary(firstGraph)]),
      load: vi.fn().mockResolvedValue(firstGraph),
    });
    vi.mocked(api.learning.recordEvidence).mockResolvedValue({ graph: learningGraph, evidence });
    vi.mocked(api.learning.listEvidence).mockResolvedValue([evidence]);
    render(<App />);
    await screen.findByText('已从本机加载知识图谱。');

    fireEvent.click(screen.getByText('线性代数'));
    fireEvent.click(screen.getByRole('button', { name: '开始学习' }));

    await waitFor(() => expect(api.learning.recordEvidence).toHaveBeenCalledWith({
      nodeId: firstGraph.nodes[0].id,
      kind: 'STUDY_STARTED',
    }));
    expect(await screen.findByText('你已经开始学习；继续记录练习或自评证据。')).toBeVisible();
    expect(await screen.findByText('开始学习', { selector: 'strong' })).toBeVisible();
    expect(screen.getByText('已开始学习，并记录到本机证据时间线。')).toBeVisible();
  });

  it('records a self assessment and shows why the concept is mastered', async () => {
    const evidence = {
      id: '55555555-5555-4555-8555-555555555555',
      nodeId: firstGraph.nodes[0].id,
      kind: 'SELF_ASSESSMENT' as const,
      rating: 4 as const,
      note: '可以独立完成推导',
      occurredAt: '2026-01-02T09:00:00.000Z',
      scoreEarned: null,
      scorePossible: null,
      assessmentAttemptId: null,
    };
    const masteredGraph: KnowledgeGraphDocument = {
      ...firstGraph,
      nodes: [{
        ...firstGraph.nodes[0],
        status: 'MASTERED',
        learningPhase: 'MASTERED',
        statusReason: '最近一次自评表明你已能独立运用这个概念。',
        evidenceCount: 1,
        lastEvidenceAt: evidence.occurredAt,
      }],
    };
    const api = installApi({
      list: vi.fn().mockResolvedValue([summary(firstGraph)]),
      load: vi.fn().mockResolvedValue(firstGraph),
    });
    vi.mocked(api.learning.recordEvidence).mockResolvedValue({ graph: masteredGraph, evidence });
    vi.mocked(api.learning.listEvidence).mockResolvedValue([evidence]);
    render(<App />);
    await screen.findByText('已从本机加载知识图谱。');

    fireEvent.click(screen.getByText('线性代数'));
    fireEvent.click(screen.getByRole('button', { name: /4 分/ }));
    fireEvent.change(screen.getByPlaceholderText('例如：能独立推导，但实际应用还不熟练。'), { target: { value: '  可以独立完成推导  ' } });
    fireEvent.click(screen.getByRole('button', { name: '记录自评' }));

    await waitFor(() => expect(api.learning.recordEvidence).toHaveBeenCalledWith({
      nodeId: firstGraph.nodes[0].id,
      kind: 'SELF_ASSESSMENT',
      rating: 4,
      note: '可以独立完成推导',
    }));
    expect(await screen.findByText('最近一次自评表明你已能独立运用这个概念。')).toBeVisible();
    expect(await screen.findByText('自评 4/5 · 能独立完成')).toBeVisible();
    expect(screen.getByText('可以独立完成推导')).toBeVisible();
  });
});
