// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractDocument } from '../src/main/documents/documentExtractor';

const localBooks = [
  'AI-Infra-Book.pdf',
  'AI-Agents-in-Depth-zh-CN.pdf',
].map((name) => ({ name, path: resolve('test-data/private/books', name) }));

const describeLocal = process.env.RUN_LOCAL_BOOK_TESTS === '1' ? describe : describe.skip;

describeLocal('authorized local PDF books', () => {
  it.each(localBooks)('extracts readable text from $name', async ({ name, path }) => {
    expect(existsSync(path), `本地测试资料不存在：${path}`).toBe(true);
    const result = await extractDocument(readFileSync(path), name);
    const charCount = result.sections.reduce((total, section) => total + section.content.length, 0);
    expect(result).toMatchObject({ format: 'PDF', blockedReason: null });
    expect(result.sections.length).toBeGreaterThan(10);
    expect(charCount).toBeGreaterThan(10_000);
  }, 120_000);
});
