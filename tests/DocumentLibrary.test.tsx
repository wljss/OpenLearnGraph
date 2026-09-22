import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentPreviewView,
  DocumentSectionView,
  ImportedDocumentView,
  KnowledgeGraphDocument,
  OpenLearnGraphApi,
} from '../src/shared/contracts';
import { DocumentLibrary } from '../src/renderer/features/documents/DocumentLibrary';

const preview: DocumentPreviewView = {
  previewToken: '11111111-1111-4111-8111-111111111111',
  sourceName: 'guide.md',
  format: 'MARKDOWN',
  fileSize: 2048,
  modifiedAt: '2026-01-01T00:00:00.000Z',
  sha256: 'a'.repeat(64),
  title: '学习指南',
  author: '',
  publisher: '',
  language: 'zh-CN',
  identifier: '',
  encoding: 'UTF-8',
  pageCount: null,
  sectionCount: 2,
  charCount: 120,
  warnings: [{ code: 'ENCODING_DETECTED', severity: 'INFO', message: '完全在本机完成编码转换。' }],
  sections: [
    { position: 0, heading: '第一章', locator: '第 1–5 行', content: '第一章的正文。', charCount: 60, truncated: false },
    { position: 1, heading: '第二章', locator: '第 6–10 行', content: '第二章的正文。', charCount: 60, truncated: false },
  ],
  canImport: true,
  blockedReason: null,
  duplicateDocumentId: null,
  duplicateDocumentTitle: null,
};

const imported: ImportedDocumentView = {
  id: '22222222-2222-4222-8222-222222222222',
  title: '学习指南（校对版）',
  author: '本地作者',
  publisher: '',
  language: 'zh-CN',
  identifier: '',
  format: 'MARKDOWN',
  sourceName: preview.sourceName,
  fileSize: preview.fileSize,
  sha256: preview.sha256,
  encoding: preview.encoding,
  pageCount: null,
  sectionCount: 2,
  charCount: 120,
  warningCount: 0,
  importedAt: '2026-01-02T00:00:00.000Z',
  modifiedAt: preview.modifiedAt,
  warnings: preview.warnings,
};

const graph: KnowledgeGraphDocument = {
  id: '33333333-3333-4333-8333-333333333333',
  name: '测试图谱',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [],
  edges: [],
};

const secondGraph: KnowledgeGraphDocument = {
  ...graph,
  id: '44444444-4444-4444-8444-444444444444',
  name: '第二个图谱',
};

function libraryProps(overrides: Partial<ComponentProps<typeof DocumentLibrary>> = {}): ComponentProps<typeof DocumentLibrary> {
  return {
    activeGraph: graph,
    structureDirty: false,
    onClose: vi.fn(),
    onGraphUpdated: vi.fn(),
    onMessage: vi.fn(),
    ...overrides,
  };
}

const firstSection: DocumentSectionView = {
  position: 0,
  heading: '第一章',
  locator: '第 1–5 行',
  charCount: 8,
  content: '第一章的正文。',
  startOffset: 0,
  endOffset: 8,
  totalLength: 8,
  previousOffset: null,
  nextOffset: null,
};

function installApi(overrides: Partial<OpenLearnGraphApi['documents']> = {}): OpenLearnGraphApi['documents'] {
  const documents: OpenLearnGraphApi['documents'] = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(imported),
    listSections: vi.fn().mockResolvedValue([
      { position: 0, heading: '第一章', locator: '第 1–5 行', charCount: 8 },
      { position: 1, heading: '第二章', locator: '第 6–10 行', charCount: 8 },
    ]),
    getSection: vi.fn().mockImplementation(async (_id: string, position: number) => (
      position === 0 ? firstSection : { ...firstSection, position: 1, heading: '第二章', locator: '第 6–10 行', content: '第二章的正文。' }
    )),
    search: vi.fn().mockResolvedValue({ hits: [], hasMore: false }),
    chooseFiles: vi.fn().mockResolvedValue({ previews: [preview], failures: [] }),
    confirmImport: vi.fn().mockResolvedValue(imported),
    discardPreview: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const emptyWorkspace = {
    concepts: [], relationships: [], pendingConceptCount: 0,
    pendingRelationshipCount: 0, blockingIssues: [],
  };
  window.openLearnGraph = {
    graphs: {
      list: vi.fn().mockResolvedValue([graph, secondGraph]),
      create: vi.fn().mockResolvedValue(graph),
      load: vi.fn().mockImplementation(async (graphId: string) => (graphId === secondGraph.id ? secondGraph : graph)),
      save: vi.fn(),
    },
    documents,
    candidates: {
      getWorkspace: vi.fn().mockResolvedValue(emptyWorkspace),
      createConcept: vi.fn().mockResolvedValue(emptyWorkspace),
      updateConcept: vi.fn().mockResolvedValue(emptyWorkspace),
      reviewConcept: vi.fn().mockResolvedValue(emptyWorkspace),
      createRelationship: vi.fn().mockResolvedValue(emptyWorkspace),
      deleteRelationship: vi.fn().mockResolvedValue(emptyWorkspace),
      apply: vi.fn(),
    },
    ai: {
      getSettings: vi.fn().mockResolvedValue({
        provider: 'DEEPSEEK', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
        configured: true, secureStorageAvailable: true,
      }),
      saveSettings: vi.fn(), clearApiKey: vi.fn(), testConnection: vi.fn(),
      previewCandidateGeneration: vi.fn().mockResolvedValue({
        previewToken: '77777777-7777-4777-8777-777777777777',
        graphId: secondGraph.id,
        documentId: imported.id,
        documentTitle: imported.title,
        documentSourceName: imported.sourceName,
        model: 'deepseek-flash',
        sections: [
          { position: 0, heading: '第一章', locator: '第 1–5 行', charCount: 8 },
          { position: 1, heading: '第二章', locator: '第 6–10 行', charCount: 8 },
        ],
        totalCharCount: 16,
        batchCount: 1,
        excerpt: '第一章的正文。',
        expiresAt: '2026-01-02T00:10:00.000Z',
      }),
      generateCandidates: vi.fn().mockResolvedValue({
        workspace: emptyWorkspace, provider: 'DEEPSEEK', model: 'deepseek-flash',
        conceptCount: 2, relationshipCount: 1, batchCount: 1, mergeWarnings: [],
        promptTokens: 100, completionTokens: 30,
      }),
      cancelCandidateGeneration: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as OpenLearnGraphApi;
  return documents;
}

describe('DocumentLibrary', () => {
  it('previews extracted text, allows metadata correction, and confirms import', async () => {
    const documents = installApi();
    const onMessage = vi.fn();
    render(<DocumentLibrary {...libraryProps({ onMessage })} />);
    expect(await screen.findByText('还没有导入资料')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '选择资料（可多选）' }));
    expect(await screen.findByText('第一章的正文。')).toBeVisible();
    expect(screen.getByText('完全在本机完成编码转换。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /第二章/ }));
    expect(screen.getByText('第二章的正文。')).toBeVisible();

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '学习指南（校对版）' } });
    fireEvent.change(screen.getByLabelText('作者'), { target: { value: '本地作者' } });
    fireEvent.click(screen.getByRole('button', { name: '确认导入资料库' }));

    await waitFor(() => expect(documents.confirmImport).toHaveBeenCalledWith({
      previewToken: preview.previewToken,
      title: '学习指南（校对版）',
      author: '本地作者',
      publisher: '',
      language: 'zh-CN',
      identifier: '',
    }));
    expect(await screen.findByRole('heading', { name: '学习指南（校对版）' })).toBeVisible();
    expect(onMessage).toHaveBeenLastCalledWith('“学习指南（校对版）”已保存到本地资料库。', 'success');
  });

  it('queues every selected document and imports them one by one', async () => {
    const secondPreview: DocumentPreviewView = {
      ...preview,
      previewToken: '22222222-2222-4222-8222-222222222222',
      sourceName: 'second.txt',
      title: '第二份资料',
      sha256: 'b'.repeat(64),
      sections: [{ ...preview.sections[0], content: '第二份资料正文。' }],
    };
    const secondImported: ImportedDocumentView = {
      ...imported,
      id: '33333333-3333-4333-8333-333333333333',
      title: secondPreview.title,
      sourceName: secondPreview.sourceName,
      sha256: secondPreview.sha256,
    };
    const documents = installApi({
      chooseFiles: vi.fn().mockResolvedValue({ previews: [preview, secondPreview], failures: [] }),
      confirmImport: vi.fn().mockImplementation(async (input) => (
        input.previewToken === secondPreview.previewToken ? secondImported : imported
      )),
    });
    render(<DocumentLibrary {...libraryProps()} />);

    fireEvent.click(await screen.findByRole('button', { name: '选择资料（可多选）' }));
    expect(await screen.findByText(/批量预览 1 \/ 2/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认导入资料库' }));
    expect(await screen.findByRole('heading', { name: '第二份资料' })).toBeVisible();
    expect(screen.getByText(/批量预览 2 \/ 2/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认导入资料库' }));

    await waitFor(() => expect(documents.confirmImport).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: secondImported.title })).toBeVisible();
  });

  it('blocks duplicates and can open the existing imported record', async () => {
    const duplicatePreview: DocumentPreviewView = {
      ...preview,
      canImport: false,
      blockedReason: '“学习指南（校对版）”已经导入，无需重复保存。',
      duplicateDocumentId: imported.id,
      duplicateDocumentTitle: imported.title,
    };
    const documents = installApi({ chooseFiles: vi.fn().mockResolvedValue({ previews: [duplicatePreview], failures: [] }) });
    render(<DocumentLibrary {...libraryProps()} />);
    fireEvent.click(await screen.findByRole('button', { name: '选择资料（可多选）' }));
    expect(await screen.findByText(duplicatePreview.blockedReason as string)).toBeVisible();
    expect(screen.getByRole('button', { name: '确认导入资料库' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /查看已导入/ }));
    await waitFor(() => expect(documents.get).toHaveBeenCalledWith(imported.id));
    expect(await screen.findByRole('heading', { name: imported.title })).toBeVisible();
  });

  it('asks before discarding edited preview metadata', async () => {
    const onClose = vi.fn();
    installApi();
    render(<DocumentLibrary {...libraryProps({ onClose })} />);
    fireEvent.click(await screen.findByRole('button', { name: '选择资料（可多选）' }));
    await screen.findByLabelText('标题');
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '尚未保存的新标题' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭资料库' }));
    expect(screen.getByRole('alertdialog', { name: '放弃当前资料预览？' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '放弃预览' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('explains import preview limits and provides paging for the saved full text', async () => {
    const limitedPreview: DocumentPreviewView = {
      ...preview,
      sectionCount: 13,
      sections: [{
        position: 0, heading: '第一章', locator: '第 1 页',
        content: '甲'.repeat(6000), charCount: 9000, truncated: true,
      }],
    };
    const limitedDetail: ImportedDocumentView = {
      ...imported,
      sectionCount: 1,
    };
    const longSection: DocumentSectionView = {
      ...firstSection,
      content: '乙'.repeat(24_000), charCount: 26_000,
      endOffset: 24_000, totalLength: 26_000, nextOffset: 24_000,
    };
    installApi({
      chooseFiles: vi.fn().mockResolvedValue({ previews: [limitedPreview], failures: [] }),
      confirmImport: vi.fn().mockResolvedValue(limitedDetail),
      listSections: vi.fn().mockResolvedValue([{ position: 0, heading: '第一章', locator: '第 1 页', charCount: 26_000 }]),
      getSection: vi.fn().mockImplementation(async (_id: string, _position: number, offset: number) => (
        offset === 0 ? longSection : {
          ...longSection, content: '尾声', startOffset: 24_000, endOffset: 26_000,
          previousOffset: 0, nextOffset: null,
        }
      )),
    });
    render(<DocumentLibrary {...libraryProps()} />);
    fireEvent.click(await screen.findByRole('button', { name: '选择资料（可多选）' }));
    expect(await screen.findByText(/当前仅展示前 1 \/ 13 节/)).toBeVisible();
    expect(screen.getByText(/前 6,000 个字符/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认导入资料库' }));
    expect(await screen.findByText(/本节第 1–24,000 \/ 26,000 字符/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '下一段' }));
    expect(await screen.findByText('尾声')).toBeVisible();
  });

  it('searches and jumps to a later chapter without loading the whole book', async () => {
    const longDocument: ImportedDocumentView = { ...imported, title: '长资料', sectionCount: 70 };
    const listSections = vi.fn().mockImplementation(async (_id: string, offset: number) => (
      Array.from({ length: offset === 0 ? 50 : 20 }, (_, index) => ({
        position: offset + index,
        heading: `第 ${offset + index + 1} 章`,
        locator: `第 ${offset + index + 1} 页`,
        charCount: 100,
      }))
    ));
    const getSection = vi.fn().mockImplementation(async (_id: string, position: number, offset: number) => (
      position === 69 ? {
        ...firstSection,
        position,
        heading: '第 70 章',
        locator: '第 70 页',
        content: '这里出现独有检索词并继续。',
        startOffset: offset,
        endOffset: offset + 13,
        totalLength: 26000,
        previousOffset: offset ? 0 : null,
        nextOffset: null,
      } : firstSection
    ));
    const documents = installApi({
      list: vi.fn().mockResolvedValue([longDocument]),
      get: vi.fn().mockResolvedValue(longDocument),
      listSections,
      getSection,
      search: vi.fn().mockResolvedValue({
        hits: [{ position: 69, heading: '第 70 章', locator: '第 70 页', charCount: 100, excerpt: '……独有检索词……', matchOffset: 25_000 }],
        hasMore: false,
      }),
    });
    render(<DocumentLibrary {...libraryProps()} />);
    fireEvent.click(await screen.findByRole('button', { name: /长资料/ }));
    expect(await screen.findByText('章节目录 · 50 / 70')).toBeVisible();
    fireEvent.change(screen.getByLabelText('搜索正文'), { target: { value: '独有检索词' } });
    fireEvent.click(screen.getByRole('button', { name: '查找' }));
    expect(await screen.findByText('匹配章节 · 1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /第 70 章.*独有检索词/ }));
    await waitFor(() => expect(getSection).toHaveBeenCalledWith(longDocument.id, 69, 24_920));
    expect(await screen.findByText('独有检索词')).toBeVisible();
    fireEvent.change(screen.getByLabelText('跳到第几节'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: '跳转' }));
    await waitFor(() => expect(getSection).toHaveBeenCalledWith(longDocument.id, 69, 0));
    fireEvent.click(screen.getByRole('button', { name: '加载后续章节' }));
    await waitFor(() => expect(listSections).toHaveBeenCalledWith(longDocument.id, 50));
    expect(await screen.findByText('章节目录 · 70 / 70')).toBeVisible();
    expect(documents.search).toHaveBeenCalledWith(longDocument.id, '独有检索词');
  });

  it('shows a search failure inside the reader', async () => {
    installApi({
      list: vi.fn().mockResolvedValue([imported]),
      search: vi.fn().mockRejectedValue(new Error('数据库暂时不可读')),
    });
    render(<DocumentLibrary {...libraryProps()} />);
    fireEvent.click(await screen.findByRole('button', { name: /学习指南（校对版）/ }));
    await screen.findByLabelText('搜索正文');
    fireEvent.change(screen.getByLabelText('搜索正文'), { target: { value: '正文' } });
    fireEvent.click(screen.getByRole('button', { name: '查找' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('资料搜索失败：数据库暂时不可读');
  });

  it('turns an exact text selection into a source-grounded candidate concept', async () => {
    installApi({ list: vi.fn().mockResolvedValue([imported]) });
    const candidates = window.openLearnGraph.candidates;
    render(<DocumentLibrary {...libraryProps()} />);
    fireEvent.click(await screen.findByRole('button', { name: /学习指南（校对版）/ }));
    const text = await screen.findByText('第一章的正文。');
    const pre = text.closest('pre') as HTMLPreElement;
    const textNode = pre.firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(pre);
    fireEvent.click(screen.getByRole('button', { name: '加入路线预览（3 字）' }));
    await waitFor(() => expect(candidates.createConcept).toHaveBeenCalledWith({
      graphId: graph.id,
      documentId: imported.id,
      sectionPosition: 0,
      sourceStartOffset: 0,
      sourceEndOffset: 3,
      name: '第一章',
      description: '',
    }));
    expect(await screen.findByRole('dialog', { name: '学习路线预览' })).toBeVisible();
  });

  it('shows the exact cloud upload scope before asking DeepSeek to generate candidates', async () => {
    installApi({ list: vi.fn().mockResolvedValue([imported]) });
    const ai = window.openLearnGraph.ai;
    render(<DocumentLibrary {...libraryProps()} />);
    fireEvent.click(await screen.findByRole('button', { name: /学习指南（校对版）/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'AI 生成学习路线' }));
    expect(await screen.findByRole('dialog', { name: '生成学习路线候选' })).toBeVisible();
    const graphSelector = await screen.findByLabelText('目标图谱');
    expect(graphSelector).toHaveValue(graph.id);
    fireEvent.change(graphSelector, { target: { value: secondGraph.id } });
    fireEvent.change(screen.getByLabelText('结束章节'), { target: { value: '1' } });
    expect(screen.getByText('2 节')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '下一步：核对发送范围' }));
    expect(await screen.findByRole('dialog', { name: '核对 DeepSeek 发送范围' })).toBeVisible();
    expect(screen.getByText(secondGraph.name)).toBeVisible();
    expect(screen.getByText('2 节 · 16 字符 · 1 批')).toBeVisible();
    expect(ai.previewCandidateGeneration).toHaveBeenCalledWith({
      graphId: secondGraph.id,
      documentId: imported.id,
      sectionPositions: [0, 1],
    });
    expect(ai.generateCandidates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '确认发送并生成' }));
    await waitFor(() => expect(ai.generateCandidates).toHaveBeenCalledWith('77777777-7777-4777-8777-777777777777'));
    expect(await screen.findByRole('dialog', { name: '学习路线预览' })).toBeVisible();
  });
});
