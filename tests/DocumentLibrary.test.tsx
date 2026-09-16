import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  DocumentPreviewView,
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
  sections: preview.sections,
};

function installApi(overrides: Partial<OpenLearnGraphApi['documents']> = {}): OpenLearnGraphApi['documents'] {
  const documents: OpenLearnGraphApi['documents'] = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(imported),
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
});
