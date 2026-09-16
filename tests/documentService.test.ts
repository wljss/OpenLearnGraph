// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/database/database';
import { DocumentRepository } from '../src/main/repositories/documentRepository';
import { DocumentService } from '../src/main/services/documentService';
import { createTestPdf } from './documentFixtures';

const directories: string[] = [];

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-document-'));
  directories.push(directory);
  const database = openDatabase(':memory:');
  const repository = new DocumentRepository(database);
  return { directory, database, repository, service: new DocumentService(repository) };
}

describe('document import service', () => {
  it('previews, confirms, lists, opens, and deletes a local document', async () => {
    const { directory, database, service } = setup();
    const filePath = join(directory, 'guide.md');
    writeFileSync(filePath, '# 学习指南\n\n先建立概念，再连接关系。', 'utf8');

    const preview = await service.previewFile(filePath);
    expect(preview).toMatchObject({
      sourceName: 'guide.md',
      format: 'MARKDOWN',
      title: '学习指南',
      canImport: true,
      duplicateDocumentId: null,
    });
    expect(preview.sha256).toHaveLength(64);

    const imported = await service.confirmImport({
      previewToken: preview.previewToken,
      title: '学习指南（校对版）',
      author: '测试作者',
      publisher: '',
      language: 'zh-CN',
      identifier: '',
    });
    expect(imported).toMatchObject({ title: '学习指南（校对版）', author: '测试作者', sectionCount: 1 });
    expect(service.list()).toHaveLength(1);
    expect(service.get(imported.id).sections[0].content).toContain('先建立概念');

    const duplicate = await service.previewFile(filePath);
    expect(duplicate).toMatchObject({
      canImport: false,
      duplicateDocumentId: imported.id,
      duplicateDocumentTitle: imported.title,
    });
    await expect(service.confirmImport({
      previewToken: duplicate.previewToken,
      title: duplicate.title,
      author: '', publisher: '', language: '', identifier: '',
    })).rejects.toThrow('已经导入');

    service.delete(imported.id);
    expect(service.list()).toEqual([]);
    expect(() => service.get(imported.id)).toThrow('不存在');
    database.close();
  });

  it('returns an actionable blocked preview for a scan-like PDF', async () => {
    const { directory, database, service } = setup();
    const filePath = join(directory, 'scan.pdf');
    writeFileSync(filePath, createTestPdf());
    const preview = await service.previewFile(filePath);
    expect(preview.canImport).toBe(false);
    expect(preview.blockedReason).toContain('OCR');
    expect(preview.pageCount).toBe(1);
    database.close();
  });

  it('rejects confirmation if the source file changed after preview', async () => {
    const { directory, database, service } = setup();
    const filePath = join(directory, 'notes.txt');
    writeFileSync(filePath, '原始正文', 'utf8');
    const preview = await service.previewFile(filePath);
    writeFileSync(filePath, '已经变化而且更长的正文', 'utf8');
    await expect(service.confirmImport({
      previewToken: preview.previewToken,
      title: '笔记', author: '', publisher: '', language: '', identifier: '',
    })).rejects.toThrow('发生了变化');
    database.close();
  });
});
