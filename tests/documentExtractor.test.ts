// @vitest-environment node
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { extractDocument } from '../src/main/documents/documentExtractor';
import { createTestEpub, createTestPdf } from './documentFixtures.mjs';

describe('local document extraction', () => {
  it('detects Chinese text encoding and preserves Markdown section structure', async () => {
    const source = '# 机器学习导论\n\n这是第一段。\n\n## 模型评估\n\n这是第二段。';
    const result = await extractDocument(iconv.encode(source, 'gb18030'), '课程笔记.md');
    expect(result).toMatchObject({
      format: 'MARKDOWN',
      title: '机器学习导论',
      encoding: 'GB18030',
      blockedReason: null,
    });
    expect(result.sections.map((section) => section.heading)).toEqual(['机器学习导论', '模型评估']);
    expect(result.sections[1].content).toContain('这是第二段');
    expect(result.warnings[0]?.code).toBe('ENCODING_DETECTED');
  });

  it('reads EPUB metadata and follows the declared spine order', async () => {
    const result = await extractDocument(await createTestEpub(), 'book.epub');
    expect(result).toMatchObject({
      format: 'EPUB',
      title: '可靠学习',
      author: '本地作者',
      publisher: '开放出版社',
      language: 'zh-CN',
      identifier: 'urn:isbn:1234567890',
    });
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].content).toContain('第一章正文');
    expect(result.sections[0].content).toContain('用 机器学习 解决问题');
    expect(result.sections[0].content).not.toContain('不应进入正文');
    expect(result.sections[1].content).toContain('第二章正文');
  });

  it('extracts PDF text and embedded metadata by page', async () => {
    const result = await extractDocument(createTestPdf('Hello PDF extraction'), 'fallback.pdf');
    expect(result).toMatchObject({
      format: 'PDF',
      title: 'PDF Test Book',
      author: 'Local Author',
      pageCount: 1,
      blockedReason: null,
    });
    expect(result.sections[0]).toMatchObject({ heading: '第 1 页', locator: '第 1 页' });
    expect(result.sections[0].content).toContain('Hello PDF extraction');
  });

  it('recognizes a PDF without a text layer instead of silently importing it', async () => {
    const result = await extractDocument(createTestPdf(), 'scan.pdf');
    expect(result.sections).toEqual([]);
    expect(result.blockedReason).toContain('OCR');
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'PDF_NO_TEXT_LAYER',
      severity: 'BLOCKING',
    }));
  });

  it('rejects unsupported or misleading files', async () => {
    await expect(extractDocument(Buffer.from('not a pdf'), 'fake.pdf')).rejects.toThrow('不是有效的 PDF');
    await expect(extractDocument(Buffer.from('%PDF-1.4\nbroken'), 'broken.pdf')).rejects.toThrow('PDF 解析失败');
    await expect(extractDocument(Buffer.from('not an epub'), 'broken.epub')).rejects.toThrow('EPUB 文件损坏');
    await expect(extractDocument(Buffer.from('binary'), 'archive.zip')).rejects.toThrow('暂不支持');
  });
});
