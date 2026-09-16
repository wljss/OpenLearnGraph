import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  confirmDocumentImportInputSchema,
  documentIdInputSchema,
  documentPreviewTokenInputSchema,
  documentSearchInputSchema,
  documentSectionGetInputSchema,
  documentSectionListInputSchema,
  type DocumentSearchView,
  type DocumentSectionSummaryView,
  type DocumentSectionView,
  type DocumentPreviewView,
  type DocumentSectionPreviewView,
  type ImportedDocumentSummaryView,
  type ImportedDocumentView,
} from '../../shared/contracts';
import {
  extractDocument,
  MAX_DOCUMENT_FILE_BYTES,
  type ExtractedDocument,
} from '../documents/documentExtractor';
import type { DocumentRepository } from '../repositories/documentRepository';

const PREVIEW_TTL_MS = 30 * 60 * 1_000;
const PREVIEW_SECTION_LIMIT = 12;
const PREVIEW_CONTENT_LIMIT = 6_000;

interface CachedPreview {
  token: string;
  createdAt: number;
  sourceName: string;
  sourcePath: string;
  sourceSize: number;
  sourceModifiedAt: string;
  sha256: string;
  extracted: ExtractedDocument;
}

function validationError(result: { success: false; error: { issues: Array<{ message: string }> } }): Error {
  return new Error(result.error.issues[0]?.message ?? '资料导入数据无效');
}

function sectionPreviews(extracted: ExtractedDocument): DocumentSectionPreviewView[] {
  return extracted.sections.slice(0, PREVIEW_SECTION_LIMIT).map((section, position) => ({
    position,
    heading: section.heading,
    locator: section.locator,
    content: section.content.slice(0, PREVIEW_CONTENT_LIMIT),
    charCount: section.content.length,
    truncated: section.content.length > PREVIEW_CONTENT_LIMIT,
  }));
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export class DocumentService {
  private readonly previews = new Map<string, CachedPreview>();

  constructor(private readonly repository: DocumentRepository) {}

  private cleanupExpiredPreviews(): void {
    const expiresBefore = Date.now() - PREVIEW_TTL_MS;
    for (const [token, preview] of this.previews) {
      if (preview.createdAt < expiresBefore) this.previews.delete(token);
    }
  }

  private toPreview(preview: CachedPreview): DocumentPreviewView {
    const duplicate = this.repository.findByHash(preview.sha256);
    const charCount = preview.extracted.sections.reduce((total, section) => total + section.content.length, 0);
    const blockedReason = duplicate
      ? `“${duplicate.title}”已经导入，无需重复保存。`
      : preview.extracted.blockedReason;
    return {
      previewToken: preview.token,
      sourceName: preview.sourceName,
      format: preview.extracted.format,
      fileSize: preview.sourceSize,
      modifiedAt: preview.sourceModifiedAt,
      sha256: preview.sha256,
      title: preview.extracted.title,
      author: preview.extracted.author,
      publisher: preview.extracted.publisher,
      language: preview.extracted.language,
      identifier: preview.extracted.identifier,
      encoding: preview.extracted.encoding,
      pageCount: preview.extracted.pageCount,
      sectionCount: preview.extracted.sections.length,
      charCount,
      warnings: preview.extracted.warnings,
      sections: sectionPreviews(preview.extracted),
      canImport: !blockedReason && charCount > 0,
      blockedReason: blockedReason || (charCount ? null : '没有提取到可保存的正文。'),
      duplicateDocumentId: duplicate?.id ?? null,
      duplicateDocumentTitle: duplicate?.title ?? null,
    };
  }

  list(): ImportedDocumentSummaryView[] {
    return this.repository.list();
  }

  get(untrustedDocumentId: unknown): ImportedDocumentView {
    const parsed = documentIdInputSchema.safeParse({ documentId: untrustedDocumentId });
    if (!parsed.success) throw validationError(parsed);
    const document = this.repository.find(parsed.data.documentId);
    if (!document) throw new Error('要查看的资料不存在');
    return document;
  }

  listSections(untrustedDocumentId: unknown, untrustedOffset: unknown): DocumentSectionSummaryView[] {
    const parsed = documentSectionListInputSchema.safeParse({
      documentId: untrustedDocumentId, offset: untrustedOffset,
    });
    if (!parsed.success) throw validationError(parsed);
    this.get(parsed.data.documentId);
    return this.repository.listSections(parsed.data.documentId, parsed.data.offset);
  }

  getSection(
    untrustedDocumentId: unknown,
    untrustedPosition: unknown,
    untrustedOffset: unknown,
  ): DocumentSectionView {
    const parsed = documentSectionGetInputSchema.safeParse({
      documentId: untrustedDocumentId, position: untrustedPosition, offset: untrustedOffset,
    });
    if (!parsed.success) throw validationError(parsed);
    this.get(parsed.data.documentId);
    const section = this.repository.getSection(
      parsed.data.documentId, parsed.data.position, parsed.data.offset,
    );
    if (!section) throw new Error('要查看的章节不存在');
    return section;
  }

  search(untrustedDocumentId: unknown, untrustedQuery: unknown): DocumentSearchView {
    const parsed = documentSearchInputSchema.safeParse({
      documentId: untrustedDocumentId, query: untrustedQuery,
    });
    if (!parsed.success) throw validationError(parsed);
    this.get(parsed.data.documentId);
    return this.repository.search(parsed.data.documentId, parsed.data.query);
  }

  async previewFile(filePath: string): Promise<DocumentPreviewView> {
    this.cleanupExpiredPreviews();
    const resolvedPath = await realpath(filePath);
    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) throw new Error('请选择一个本地文件');
    if (fileStat.size <= 0) throw new Error('文件为空');
    if (fileStat.size > MAX_DOCUMENT_FILE_BYTES) throw new Error('单个文件不能超过 100 MB');
    const buffer = await readFile(resolvedPath);
    const extracted = await extractDocument(buffer, basename(resolvedPath));
    const preview: CachedPreview = {
      token: randomUUID(),
      createdAt: Date.now(),
      sourceName: basename(resolvedPath),
      sourcePath: resolvedPath,
      sourceSize: fileStat.size,
      sourceModifiedAt: fileStat.mtime.toISOString(),
      sha256: createHash('sha256').update(buffer).digest('hex'),
      extracted,
    };
    this.previews.set(preview.token, preview);
    return this.toPreview(preview);
  }

  async confirmImport(untrustedInput: unknown): Promise<ImportedDocumentView> {
    this.cleanupExpiredPreviews();
    const parsed = confirmDocumentImportInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw validationError(parsed);
    const preview = this.previews.get(parsed.data.previewToken);
    if (!preview) throw new Error('资料预览已过期，请重新选择文件');
    const currentStat = await stat(preview.sourcePath).catch(() => null);
    if (!currentStat
      || currentStat.size !== preview.sourceSize
      || currentStat.mtime.toISOString() !== preview.sourceModifiedAt) {
      this.previews.delete(preview.token);
      throw new Error('源文件在预览后发生了变化，请重新选择并检查内容');
    }
    const currentHash = await hashFile(preview.sourcePath).catch(() => null);
    if (currentHash !== preview.sha256) {
      this.previews.delete(preview.token);
      throw new Error('源文件在预览后发生了变化，请重新选择并检查内容');
    }
    const view = this.toPreview(preview);
    if (!view.canImport) throw new Error(view.blockedReason ?? '当前资料无法导入');
    const imported = this.repository.create({
      metadata: parsed.data,
      sourceName: preview.sourceName,
      sourcePath: preview.sourcePath,
      sourceSize: preview.sourceSize,
      sourceModifiedAt: preview.sourceModifiedAt,
      sha256: preview.sha256,
      extracted: preview.extracted,
    });
    this.previews.delete(preview.token);
    return imported;
  }

  discardPreview(untrustedToken: unknown): void {
    const parsed = documentPreviewTokenInputSchema.safeParse({ previewToken: untrustedToken });
    if (!parsed.success) throw validationError(parsed);
    this.previews.delete(parsed.data.previewToken);
  }

  delete(untrustedDocumentId: unknown): void {
    const parsed = documentIdInputSchema.safeParse({ documentId: untrustedDocumentId });
    if (!parsed.success) throw validationError(parsed);
    this.repository.delete(parsed.data.documentId);
  }
}
