import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ConfirmDocumentImportInput,
  DocumentFormat,
  DocumentImportWarningView,
  DocumentSearchView,
  DocumentSectionSummaryView,
  DocumentSectionView,
  ImportedDocumentSummaryView,
  ImportedDocumentView,
} from '../../shared/contracts';
import type { ExtractedDocument } from '../documents/documentExtractor';

interface DocumentRow {
  id: string;
  title: string;
  author: string;
  publisher: string;
  language: string;
  identifier: string;
  format: DocumentFormat;
  source_name: string;
  source_size: number;
  source_modified_at: string;
  sha256: string;
  encoding: string | null;
  page_count: number | null;
  section_count: number;
  char_count: number;
  warnings_json: string;
  imported_at: string;
}

interface SectionRow {
  position: number;
  heading: string;
  locator: string;
  char_count: number;
}

interface SectionContentRow extends SectionRow {
  content: string;
  total_length: number;
}

interface SearchRow extends SectionRow {
  excerpt: string;
  match_at: number;
}

export interface NewImportedDocument {
  metadata: ConfirmDocumentImportInput;
  sourceName: string;
  sourcePath: string;
  sourceSize: number;
  sourceModifiedAt: string;
  sha256: string;
  extracted: ExtractedDocument;
}

const DOCUMENT_COLUMNS = `id, title, author, publisher, language, identifier, format,
  source_name, source_size, source_modified_at, sha256, encoding, page_count,
  section_count, char_count, warnings_json, imported_at`;
const SECTION_PAGE_SIZE = 50;
const SECTION_CHUNK_SIZE = 24_000;
const SEARCH_RESULT_LIMIT = 50;

function parseWarnings(value: string): DocumentImportWarningView[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => (
    item && typeof item === 'object'
    && typeof (item as Record<string, unknown>).code === 'string'
    && ['INFO', 'WARNING', 'BLOCKING'].includes(String((item as Record<string, unknown>).severity))
    && typeof (item as Record<string, unknown>).message === 'string'
  ))) throw new Error('导入资料的警告记录已损坏');
  return parsed as DocumentImportWarningView[];
}

function toSummary(row: DocumentRow): ImportedDocumentSummaryView {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    publisher: row.publisher,
    language: row.language,
    identifier: row.identifier,
    format: row.format,
    sourceName: row.source_name,
    fileSize: Number(row.source_size),
    sha256: row.sha256,
    encoding: row.encoding,
    pageCount: row.page_count === null ? null : Number(row.page_count),
    sectionCount: Number(row.section_count),
    charCount: Number(row.char_count),
    warningCount: parseWarnings(row.warnings_json).filter((item) => item.severity !== 'INFO').length,
    importedAt: row.imported_at,
  };
}

function sectionSummary(row: SectionRow): DocumentSectionSummaryView {
  return {
    position: Number(row.position),
    heading: row.heading,
    locator: row.locator,
    charCount: Number(row.char_count),
  };
}

export class DocumentRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): ImportedDocumentSummaryView[] {
    const rows = this.database.prepare(
      `SELECT ${DOCUMENT_COLUMNS}
       FROM imported_documents
       ORDER BY imported_at DESC, rowid DESC
       LIMIT 500`,
    ).all() as unknown as DocumentRow[];
    return rows.map(toSummary);
  }

  findByHash(sha256: string): ImportedDocumentSummaryView | null {
    const row = this.database.prepare(
      `SELECT ${DOCUMENT_COLUMNS} FROM imported_documents WHERE sha256 = ?`,
    ).get(sha256) as DocumentRow | undefined;
    return row ? toSummary(row) : null;
  }

  find(documentId: string): ImportedDocumentView | null {
    const row = this.database.prepare(
      `SELECT ${DOCUMENT_COLUMNS} FROM imported_documents WHERE id = ?`,
    ).get(documentId) as DocumentRow | undefined;
    if (!row) return null;
    return {
      ...toSummary(row),
      modifiedAt: row.source_modified_at,
      warnings: parseWarnings(row.warnings_json),
    };
  }

  listSections(documentId: string, offset: number): DocumentSectionSummaryView[] {
    const rows = this.database.prepare(
      `SELECT position, heading, locator, char_count
       FROM imported_document_sections
       WHERE document_id = ?
       ORDER BY position
       LIMIT ? OFFSET ?`,
    ).all(documentId, SECTION_PAGE_SIZE, offset) as unknown as SectionRow[];
    return rows.map(sectionSummary);
  }

  getSection(documentId: string, position: number, offset: number): DocumentSectionView | null {
    const row = this.database.prepare(
      `SELECT position, heading, locator, char_count,
              length(content) AS total_length,
              substr(content, ?, ?) AS content
       FROM imported_document_sections
       WHERE document_id = ? AND position = ?`,
    ).get(offset + 1, SECTION_CHUNK_SIZE, documentId, position) as SectionContentRow | undefined;
    if (!row) return null;
    const totalLength = Number(row.total_length);
    if (offset >= totalLength) throw new Error('正文位置超出范围，请从章节开头重新打开');
    const endOffset = Math.min(offset + SECTION_CHUNK_SIZE, totalLength);
    return {
      ...sectionSummary(row),
      content: row.content,
      startOffset: offset,
      endOffset,
      totalLength,
      previousOffset: offset > 0 ? Math.max(0, offset - SECTION_CHUNK_SIZE) : null,
      nextOffset: endOffset < totalLength ? endOffset : null,
    };
  }

  search(documentId: string, query: string): DocumentSearchView {
    const rows = this.database.prepare(
      `SELECT position, heading, locator, char_count, match_at,
              substr(content, max(1, match_at - 48), 160) AS excerpt
       FROM (
         SELECT position, heading, locator, char_count, content,
                instr(lower(content), lower(?)) AS match_at
         FROM imported_document_sections
         WHERE document_id = ?
       )
       WHERE match_at > 0
       ORDER BY position
       LIMIT ?`,
    ).all(query, documentId, SEARCH_RESULT_LIMIT + 1) as unknown as SearchRow[];
    return {
      hits: rows.slice(0, SEARCH_RESULT_LIMIT).map((row) => ({
        ...sectionSummary(row),
        excerpt: row.excerpt.trim(),
        matchOffset: Number(row.match_at) - 1,
      })),
      hasMore: rows.length > SEARCH_RESULT_LIMIT,
    };
  }

  create(data: NewImportedDocument): ImportedDocumentView {
    const duplicate = this.findByHash(data.sha256);
    if (duplicate) throw new Error(`“${duplicate.title}”已经导入，无需重复保存`);
    if (!data.extracted.sections.length) throw new Error(data.extracted.blockedReason ?? '资料没有可保存的正文');
    const id = randomUUID();
    const importedAt = new Date().toISOString();
    const charCount = data.extracted.sections.reduce((total, section) => total + section.content.length, 0);
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.prepare(
        `INSERT INTO imported_documents
         (id, title, author, publisher, language, identifier, format, source_name,
          source_path, source_size, source_modified_at, sha256, encoding, page_count,
          section_count, char_count, warnings_json, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        data.metadata.title,
        data.metadata.author,
        data.metadata.publisher,
        data.metadata.language,
        data.metadata.identifier,
        data.extracted.format,
        data.sourceName,
        data.sourcePath,
        data.sourceSize,
        data.sourceModifiedAt,
        data.sha256,
        data.extracted.encoding,
        data.extracted.pageCount,
        data.extracted.sections.length,
        charCount,
        JSON.stringify(data.extracted.warnings),
        importedAt,
      );
      const insertSection = this.database.prepare(
        `INSERT INTO imported_document_sections
         (id, document_id, position, heading, locator, content, char_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      data.extracted.sections.forEach((section, position) => {
        insertSection.run(
          randomUUID(), id, position, section.heading, section.locator,
          section.content, section.content.length,
        );
      });
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    return this.find(id) as ImportedDocumentView;
  }

  delete(documentId: string): void {
    const result = this.database.prepare('DELETE FROM imported_documents WHERE id = ?').run(documentId);
    if (Number(result.changes) !== 1) throw new Error('要删除的资料不存在');
  }
}
