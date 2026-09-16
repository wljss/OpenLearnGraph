import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentPreviewView,
  DocumentSectionView,
  ImportedDocumentView,
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
    chooseFile: vi.fn().mockResolvedValue(preview),
    confirmImport: vi.fn().mockResolvedValue(imported),
    discardPreview: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  window.openLearnGraph = { documents } as unknown as OpenLearnGraphApi;
  return documents;
}

describe('DocumentLibrary', () => {
  it('previews extracted text, allows metadata correction, and confirms import', async () => {
    const documents = installApi();
    const onMessage = vi.fn();
    render(<DocumentLibrary onClose={vi.fn()} onMessage={onMessage} />);
    expect(await screen.findByText('还没有导入资料')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '选择第一份资料' }));
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

  it('blocks duplicates and can open the existing imported record', async () => {
    const duplicatePreview: DocumentPreviewView = {
      ...preview,
      canImport: false,
      blockedReason: '“学习指南（校对版）”已经导入，无需重复保存。',
      duplicateDocumentId: imported.id,
      duplicateDocumentTitle: imported.title,
    };
    const documents = installApi({ chooseFile: vi.fn().mockResolvedValue(duplicatePreview) });
    render(<DocumentLibrary onClose={vi.fn()} onMessage={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '选择第一份资料' }));
    expect(await screen.findByText(duplicatePreview.blockedReason as string)).toBeVisible();
    expect(screen.getByRole('button', { name: '确认导入资料库' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /查看已导入/ }));
    await waitFor(() => expect(documents.get).toHaveBeenCalledWith(imported.id));
    expect(await screen.findByRole('heading', { name: imported.title })).toBeVisible();
  });

  it('asks before discarding edited preview metadata', async () => {
    const onClose = vi.fn();
    installApi();
    render(<DocumentLibrary onClose={onClose} onMessage={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '选择第一份资料' }));
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
      chooseFile: vi.fn().mockResolvedValue(limitedPreview),
      confirmImport: vi.fn().mockResolvedValue(limitedDetail),
      listSections: vi.fn().mockResolvedValue([{ position: 0, heading: '第一章', locator: '第 1 页', charCount: 26_000 }]),
      getSection: vi.fn().mockImplementation(async (_id: string, _position: number, offset: number) => (
        offset === 0 ? longSection : {
          ...longSection, content: '尾声', startOffset: 24_000, endOffset: 26_000,
          previousOffset: 0, nextOffset: null,
        }
      )),
    });
    render(<DocumentLibrary onClose={vi.fn()} onMessage={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '选择第一份资料' }));
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
    render(<DocumentLibrary onClose={vi.fn()} onMessage={vi.fn()} />);
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
    render(<DocumentLibrary onClose={vi.fn()} onMessage={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /学习指南（校对版）/ }));
    await screen.findByLabelText('搜索正文');
    fireEvent.change(screen.getByLabelText('搜索正文'), { target: { value: '正文' } });
    fireEvent.click(screen.getByRole('button', { name: '查找' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('资料搜索失败：数据库暂时不可读');
  });
});
