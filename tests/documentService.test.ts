// @vitest-environment node
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/main/database/database';
import { DocumentRepository } from '../src/main/repositories/documentRepository';
import { DocumentService } from '../src/main/services/documentService';
import { createTestEpub, createTestPdf } from './documentFixtures.mjs';

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
  it('keeps all four formats readable after closing SQLite and removing the source files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'openlearngraph-document-'));
    directories.push(directory);
    const databasePath = join(directory, 'library.sqlite3');
    const cases = [
      { name: 'paper.pdf', format: 'PDF', data: createTestPdf('Hello PDF extraction'), text: 'Hello PDF extraction' },
      { name: 'book.epub', format: 'EPUB', data: await createTestEpub(), text: '用 机器学习 解决问题' },
      { name: '课程.md', format: 'MARKDOWN', data: '# 课程导论\n\n先建立概念，再连接关系。', text: '先建立概念' },
      { name: '笔记.txt', format: 'TEXT', data: '第一章 初识模型\n\n模型从数据中学习规律。', text: '模型从数据中学习规律' },
    ] as const;
    let database = openDatabase(databasePath);
    let service = new DocumentService(new DocumentRepository(database));
    const importedIds: string[] = [];

    for (const sample of cases) {
      const filePath = join(directory, sample.name);
      writeFileSync(filePath, sample.data);
      const preview = await service.previewFile(filePath);
      expect(preview.format).toBe(sample.format);
      expect(preview.canImport).toBe(true);
      expect(preview.sections.some((section) => section.content.includes(sample.text))).toBe(true);
      const imported = await service.confirmImport({
        previewToken: preview.previewToken,
        title: preview.title,
        author: preview.author,
        publisher: preview.publisher,
        language: preview.language,
        identifier: preview.identifier,
      });
      importedIds.push(imported.id);
      expect(imported.sections.some((section) => section.content.includes(sample.text))).toBe(true);
      const duplicate = await service.previewFile(filePath);
      expect(duplicate).toMatchObject({ canImport: false, duplicateDocumentId: imported.id });
      rmSync(filePath);
    }

    database.close();
    database = openDatabase(databasePath);
    service = new DocumentService(new DocumentRepository(database));
    expect(service.list()).toHaveLength(cases.length);
    importedIds.forEach((id, index) => {
      const reopened = service.get(id);
      expect(reopened.format).toBe(cases[index].format);
      expect(reopened.sections.some((section) => section.content.includes(cases[index].text))).toBe(true);
    });
    database.close();
  });

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

  it('detects a same-size change even when the modification time is restored', async () => {
    const { directory, database, service } = setup();
    const filePath = join(directory, 'notes.txt');
    writeFileSync(filePath, '原始正文', 'utf8');
    const preview = await service.previewFile(filePath);
    writeFileSync(filePath, '改写正文', 'utf8');
    utimesSync(filePath, new Date(preview.modifiedAt), new Date(preview.modifiedAt));
    expect(statSync(filePath).mtime.toISOString()).toBe(preview.modifiedAt);
    await expect(service.confirmImport({
      previewToken: preview.previewToken,
      title: '笔记', author: '', publisher: '', language: '', identifier: '',
    })).rejects.toThrow('发生了变化');
    expect(service.list()).toEqual([]);
    database.close();
  });
});
