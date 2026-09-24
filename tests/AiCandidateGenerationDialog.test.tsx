import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  AiCandidateGenerationPreviewView,
  AiCandidateGenerationResult,
  KnowledgeGraphDocument,
  OpenLearnGraphApi,
} from '../src/shared/contracts';
import { AiCandidateGenerationDialog } from '../src/renderer/features/documents/AiCandidateGenerationDialog';

const graph: KnowledgeGraphDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '机器学习',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [],
  edges: [],
};

const preview: AiCandidateGenerationPreviewView = {
  previewToken: '77777777-7777-4777-8777-777777777777',
  graphId: graph.id,
  documentId: '22222222-2222-4222-8222-222222222222',
  documentTitle: '学习资料',
  documentSourceName: 'book.pdf',
  model: 'deepseek-flash',
  sections: [{ position: 0, heading: '第一章', locator: '第 1–10 页', charCount: 40_000 }],
  totalCharCount: 40_000,
  batchCount: 2,
  excerpt: '这是发送内容预览',
  expiresAt: '2026-01-01T00:10:00.000Z',
};

const result: AiCandidateGenerationResult = {
  workspace: { concepts: [], relationships: [], pendingConceptCount: 0, pendingRelationshipCount: 0, blockingIssues: [] },
  provider: 'DEEPSEEK', model: 'deepseek-flash', conceptCount: 2, relationshipCount: 1,
  batchCount: 2, mergeWarnings: [], promptTokens: 100, completionTokens: 20,
};

function installAi(overrides: Partial<OpenLearnGraphApi['ai']> = {}): OpenLearnGraphApi['ai'] {
  const ai = {
    getSettings: vi.fn(), saveSettings: vi.fn(), clearApiKey: vi.fn(), testConnection: vi.fn(),
    previewCandidateGeneration: vi.fn(),
    generateCandidates: vi.fn().mockResolvedValue(result),
    getCandidateGenerationProgress: vi.fn().mockResolvedValue({
      phase: 'VERIFYING', completedBatchCount: 0, totalBatchCount: 2,
      currentBatchNumber: 1, retryingGrounding: false,
    }),
    cancelCandidateGeneration: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as OpenLearnGraphApi['ai'];
  window.openLearnGraph = { ai } as unknown as OpenLearnGraphApi;
  return ai;
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof AiCandidateGenerationDialog>> = {}) {
  const props: React.ComponentProps<typeof AiCandidateGenerationDialog> = {
    preview,
    targetGraph: graph,
    onClose: vi.fn(),
    onGenerated: vi.fn(),
    onOpenSettings: vi.fn(),
    onMessage: vi.fn(),
    ...overrides,
  };
  render(<AiCandidateGenerationDialog {...props} />);
  fireEvent.click(screen.getByRole('checkbox'));
  return props;
}

describe('AiCandidateGenerationDialog', () => {
  it('shows real batch verification progress while generation is active', async () => {
    let resolveGeneration: ((value: AiCandidateGenerationResult) => void) | undefined;
    installAi({
      generateCandidates: vi.fn().mockImplementation(() => new Promise((resolve) => { resolveGeneration = resolve; })),
    });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '确认发送并生成' }));
    expect(await screen.findByText(/第 1 \/ 2 批已返回，正在本机核对结构和原文出处/)).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'AI 生成批次进度' })).toHaveAttribute('aria-valuemax', '2');
    resolveGeneration?.(result);
  });

  it('keeps the confirmed scope available for a safe retry after failure', async () => {
    const generateCandidates = vi.fn()
      .mockRejectedValueOnce(new Error('DeepSeek 服务暂时不可用'))
      .mockResolvedValueOnce(result);
    installAi({ generateCandidates });
    const props = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '确认发送并生成' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('本次生成没有写入任何候选');
    expect(screen.getByText('DeepSeek 服务暂时不可用')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '安全重试' }));
    await waitFor(() => expect(generateCandidates).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(props.onGenerated).toHaveBeenCalledWith(result));
  });

  it('cancels the active request and closes without leaving a partial result', async () => {
    let rejectGeneration: ((reason: Error) => void) | undefined;
    const generateCandidates = vi.fn().mockImplementation(() => new Promise((_resolve, reject) => { rejectGeneration = reject; }));
    const cancelCandidateGeneration = vi.fn().mockImplementation(async () => {
      rejectGeneration?.(new Error('DeepSeek 候选生成已取消'));
    });
    installAi({ generateCandidates, cancelCandidateGeneration });
    const props = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: '确认发送并生成' }));
    fireEvent.click(await screen.findByRole('button', { name: '取消生成' }));
    await waitFor(() => expect(cancelCandidateGeneration).toHaveBeenCalledWith(preview.previewToken));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
