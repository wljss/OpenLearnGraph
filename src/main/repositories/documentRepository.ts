import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ConfirmDocumentImportInput,
  DocumentFormat,
  DocumentImportWarningView,
  DocumentSectionPreviewView,
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
  content: string;
  char_count: number;
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

function previewSection(row: SectionRow): DocumentSectionPreviewView {
  const limit = 8_000;
  return {
    position: Number(row.position),
    heading: row.heading,
    locator: row.locator,
    content: row.content.slice(0, limit),
    charCount: Number(row.char_count),
    truncated: row.content.length > limit,
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
    const sections = this.database.prepare(
      `SELECT position, heading, locator, content, char_count
       FROM imported_document_sections
       WHERE document_id = ?
       ORDER BY position
       LIMIT 50`,
    ).all(documentId) as unknown as SectionRow[];
    return {
      ...toSummary(row),
      modifiedAt: row.source_modified_at,
      warnings: parseWarnings(row.warnings_json),
      sections: sections.map(previewSection),
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
