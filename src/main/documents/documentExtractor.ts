import { basename, extname, posix } from 'node:path';
import chardet from 'chardet';
import { XMLParser } from 'fast-xml-parser';
import iconv from 'iconv-lite';
import JSZip, { type JSZipObject } from 'jszip';
import type {
  DocumentFormat,
  DocumentImportWarningView,
} from '../../shared/contracts';

export const MAX_DOCUMENT_FILE_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 10_000_000;
const MAX_EPUB_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_SECTIONS = 5_000;
const SECTION_TARGET_CHARS = 24_000;

export interface ExtractedDocumentSection {
  heading: string;
  locator: string;
  content: string;
}

export interface ExtractedDocument {
  format: DocumentFormat;
  title: string;
  author: string;
  publisher: string;
  language: string;
  identifier: string;
  encoding: string | null;
  pageCount: number | null;
  sections: ExtractedDocumentSection[];
  warnings: DocumentImportWarningView[];
  blockedReason: string | null;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

interface ZipEntryWithSize extends JSZipObject {
  _data?: { uncompressedSize?: number };
}

function warning(
  code: string,
  severity: DocumentImportWarningView['severity'],
  message: string,
): DocumentImportWarningView {
  return { code, severity, message };
}

function normalizeText(value: string): string {
  // These are non-printing C0 controls other than tab and line breaks.
  // eslint-disable-next-line no-control-regex
  const unsafeControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(unsafeControls, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function withoutExtension(fileName: string): string {
  const extension = extname(fileName);
  return basename(fileName, extension).trim() || '未命名资料';
}

function assertExtractedSize(sections: ExtractedDocumentSection[]): void {
  const charCount = sections.reduce((total, section) => total + section.content.length, 0);
  if (!charCount) throw new Error('没有提取到可读正文');
  if (charCount > MAX_EXTRACTED_CHARS) {
    throw new Error('提取后的正文超过 1000 万字，请拆分文件后再导入');
  }
  if (sections.length > MAX_SECTIONS) {
    throw new Error('资料包含的章节或页面过多，请拆分文件后再导入');
  }
}

function splitLongContent(
  content: string,
  heading: string,
  locator: string,
): ExtractedDocumentSection[] {
  if (content.length <= SECTION_TARGET_CHARS * 1.5) return [{ heading, locator, content }];
  const paragraphs = content.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';
  const pushCurrent = (): void => {
    const normalized = normalizeText(current);
    if (normalized) chunks.push(normalized);
    current = '';
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > SECTION_TARGET_CHARS * 2) {
      pushCurrent();
      for (let offset = 0; offset < paragraph.length; offset += SECTION_TARGET_CHARS) {
        chunks.push(paragraph.slice(offset, offset + SECTION_TARGET_CHARS));
      }
      continue;
    }
    if (current && current.length + paragraph.length > SECTION_TARGET_CHARS) pushCurrent();
    current += `${current ? '\n\n' : ''}${paragraph}`;
  }
  pushCurrent();
  return chunks.map((chunk, index) => ({
    heading: chunks.length === 1 ? heading : `${heading}（${index + 1}/${chunks.length}）`,
    locator,
    content: chunk,
  }));
}

function isHeadingLine(line: string, markdown: boolean): { heading: string; level: number } | null {
  if (markdown) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (match) return { heading: match[2].trim(), level: match[1].length };
  }
  const trimmed = line.trim();
  if (/^(第[\d一二三四五六七八九十百千万零〇两]+[章节篇部卷]\s*.+|chapter\s+\d+\b.*)$/i.test(trimmed)
    && trimmed.length <= 160) {
    return { heading: trimmed, level: 1 };
  }
  return null;
}

function extractTextTitle(text: string, fileName: string, markdown: boolean): string {
  const firstLines = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 8);
  for (const line of firstLines) {
    const heading = isHeadingLine(line, markdown);
    if (heading?.heading) return heading.heading.slice(0, 300);
  }
  const first = firstLines[0] ?? '';
  if (first && first.length <= 100 && !/[。！？.!?]$/.test(first)) return first;
  return withoutExtension(fileName);
}

function splitTextSections(text: string, markdown: boolean): ExtractedDocumentSection[] {
  const lines = text.split('\n');
  const headings = lines.flatMap((line, index) => {
    const match = isHeadingLine(line, markdown);
    return match ? [{ ...match, index }] : [];
  });
  if (!headings.length) {
    return splitLongContent(text, '正文', `第 1–${Math.max(1, lines.length)} 行`);
  }

  const sections: ExtractedDocumentSection[] = [];
  if (headings[0].index > 0) {
    const preface = normalizeText(lines.slice(0, headings[0].index).join('\n'));
    if (preface) sections.push(...splitLongContent(preface, '开篇', `第 1–${headings[0].index} 行`));
  }
  headings.forEach((item, index) => {
    const end = headings[index + 1]?.index ?? lines.length;
    const content = normalizeText(lines.slice(item.index + 1, end).join('\n'));
    if (!content) return;
    sections.push(...splitLongContent(
      content,
      item.heading.slice(0, 300),
      `第 ${item.index + 1}–${end} 行`,
    ));
  });
  return sections.length ? sections : splitLongContent(text, '正文', `第 1–${Math.max(1, lines.length)} 行`);
}

function decodeText(buffer: Buffer): { text: string; encoding: string; warnings: DocumentImportWarningView[] } {
  let encoding: string;
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) encoding = 'UTF-8';
  else if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) encoding = 'UTF-16LE';
  else if (buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) encoding = 'UTF-16BE';
  else encoding = chardet.detect(buffer) || 'UTF-8';

  const normalizedEncoding = encoding.toLocaleLowerCase() === 'ascii' ? 'UTF-8' : encoding;
  if (!iconv.encodingExists(normalizedEncoding)) throw new Error(`暂不支持文本编码：${encoding}`);
  const text = normalizeText(iconv.decode(buffer, normalizedEncoding).replace(/^\ufeff/, ''));
  const replacementCount = [...text].filter((character) => character === '�').length;
  const warnings: DocumentImportWarningView[] = [];
  if (!/^utf-?8$/i.test(normalizedEncoding)) {
    warnings.push(warning('ENCODING_DETECTED', 'INFO', `检测到文本编码 ${normalizedEncoding}，已在本机转换为 Unicode。`));
  }
  if (replacementCount > Math.max(2, text.length * 0.001)) {
    warnings.push(warning('ENCODING_REPLACEMENTS', 'WARNING', '正文中出现较多无法解码的字符，请仔细检查预览。'));
  }
  return { text, encoding: normalizedEncoding, warnings };
}

async function extractPlainText(
  buffer: Buffer,
  fileName: string,
  format: 'TEXT' | 'MARKDOWN',
): Promise<ExtractedDocument> {
  const decoded = decodeText(buffer);
  if (!decoded.text) throw new Error('文本文件为空');
  const sections = splitTextSections(decoded.text, format === 'MARKDOWN');
  assertExtractedSize(sections);
  return {
    format,
    title: extractTextTitle(decoded.text, fileName, format === 'MARKDOWN'),
    author: '',
    publisher: '',
    language: '',
    identifier: '',
    encoding: decoded.encoding,
    pageCount: null,
    sections,
    warnings: decoded.warnings,
    blockedReason: null,
  };
}

function isPdfTextItem(value: unknown): value is PdfTextItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PdfTextItem>;
  return typeof item.str === 'string'
    && Array.isArray(item.transform)
    && item.transform.length >= 6
    && typeof item.width === 'number'
    && typeof item.height === 'number';
}

function pdfPageText(items: unknown[]): string {
  let output = '';
  let previousY: number | null = null;
  let previousEndX: number | null = null;
  let previousHeight = 0;
  for (const item of items) {
    if (!isPdfTextItem(item) || !item.str) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const newLine = previousY !== null && Math.abs(y - previousY) > Math.max(2, previousHeight * 0.45);
    if (newLine) output += '\n';
    else if (previousEndX !== null && x - previousEndX > Math.max(1.5, previousHeight * 0.2)) output += ' ';
    output += item.str;
    if (item.hasEOL) output += '\n';
    previousY = y;
    previousEndX = x + item.width;
    previousHeight = item.height || previousHeight;
  }
  return normalizeText(output);
}

function metadataString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(metadataString).filter(Boolean).join('; ');
  if (value && typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    return metadataString(text);
  }
  return '';
}

async function extractPdf(buffer: Buffer, fileName: string): Promise<ExtractedDocument> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });
  try {
    const document = await task.promise;
    if (document.numPages > MAX_SECTIONS) throw new Error('PDF 页数超过 5000 页，请拆分后再导入');
    const metadata = await document.getMetadata().catch(() => null);
    const info = (metadata?.info ?? {}) as Record<string, unknown>;
    const xmp = metadata?.metadata;
    const sections: ExtractedDocumentSection[] = [];
    let lowTextPages = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = pdfPageText(content.items);
      if (text.length < 20) lowTextPages += 1;
      if (text) sections.push({ heading: `第 ${pageNumber} 页`, locator: `第 ${pageNumber} 页`, content: text });
      page.cleanup();
    }
    const warnings: DocumentImportWarningView[] = [
      warning('PDF_READING_ORDER', 'INFO', 'PDF 文本按页面和坐标重建；复杂分栏、脚注或表格请在预览中核对阅读顺序。'),
    ];
    if (!sections.length) {
      warnings.push(warning('PDF_NO_TEXT_LAYER', 'BLOCKING', 'PDF 没有可读取的文本层，可能是扫描版；需要 OCR 后才能导入。'));
      return {
        format: 'PDF',
        title: metadataString(info.Title) || xmp?.get('dc:title')?.trim() || withoutExtension(fileName),
        author: metadataString(info.Author) || xmp?.get('dc:creator')?.trim() || '',
        publisher: xmp?.get('dc:publisher')?.trim() || '',
        language: xmp?.get('dc:language')?.trim() || '',
        identifier: xmp?.get('dc:identifier')?.trim() || '',
        encoding: null,
        pageCount: document.numPages,
        sections: [],
        warnings,
        blockedReason: 'PDF 没有可读取的文本层；当前版本尚未启用 OCR。',
      };
    }
    if (lowTextPages / document.numPages >= 0.6) {
      warnings.push(warning('PDF_LOW_TEXT_DENSITY', 'WARNING', '多数页面提取文字很少，文件可能包含扫描页，请仔细检查预览。'));
    }
    assertExtractedSize(sections);
    return {
      format: 'PDF',
      title: metadataString(info.Title) || xmp?.get('dc:title')?.trim() || withoutExtension(fileName),
      author: metadataString(info.Author) || xmp?.get('dc:creator')?.trim() || '',
      publisher: xmp?.get('dc:publisher')?.trim() || '',
      language: xmp?.get('dc:language')?.trim() || '',
      identifier: xmp?.get('dc:identifier')?.trim() || '',
      encoding: null,
      pageCount: document.numPages,
      sections,
      warnings,
      blockedReason: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) throw new Error('PDF 受密码保护，请解密后再导入', { cause: error });
    throw error;
  } finally {
    await task.destroy();
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function attribute(record: unknown, name: string): string {
  if (!record || typeof record !== 'object') return '';
  return metadataString((record as Record<string, unknown>)[`@_${name}`]);
}

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'div', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main',
  'nav', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul',
]);

function orderedMarkupText(value: unknown, parentTag = ''): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((item) => orderedMarkupText(item, parentTag)).join('');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value as Record<string, unknown>).map(([key, child]) => {
    if (key === ':@') return '';
    if (key === '#text') return metadataString(child);
    const tag = key.toLocaleLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'svg') return '';
    const inner = orderedMarkupText(child, tag);
    return BLOCK_TAGS.has(tag) ? `\n${inner}\n` : inner;
  }).join(parentTag === 'pre' ? '' : '');
}

function firstMarkupHeading(value: unknown): string {
  if (Array.isArray(value)) {
    for (const child of value) {
      const heading = firstMarkupHeading(child);
      if (heading) return heading;
    }
    return '';
  }
  if (!value || typeof value !== 'object') return '';
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^h[1-6]$/i.test(key)) return normalizeText(orderedMarkupText(child)).slice(0, 300);
    const heading = firstMarkupHeading(child);
    if (heading) return heading;
  }
  return '';
}

function resolveEpubPath(baseFile: string, href: string): string {
  const decodedHref = decodeURIComponent(href.split('#')[0]);
  const resolved = posix.normalize(posix.join(posix.dirname(baseFile), decodedHref)).replace(/^\/+/, '');
  if (!resolved || resolved.startsWith('../') || resolved.includes('/../')) {
    throw new Error('EPUB 包含不安全的章节路径');
  }
  return resolved;
}

async function extractEpub(buffer: Buffer, fileName: string): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const entries = Object.values(zip.files) as ZipEntryWithSize[];
  const uncompressedSize = entries.reduce((total, entry) => total + (entry._data?.uncompressedSize ?? 0), 0);
  if (uncompressedSize > MAX_EPUB_UNCOMPRESSED_BYTES) throw new Error('EPUB 解压后超过 200 MB，已停止解析');
  if (entries.length > 20_000) throw new Error('EPUB 内部文件数量异常，已停止解析');

  const mimetype = await zip.file('mimetype')?.async('string');
  if (mimetype?.trim() !== 'application/epub+zip') throw new Error('文件不是有效的 EPUB 电子书');
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('EPUB 缺少 META-INF/container.xml');
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
  const container = parser.parse(containerXml) as Record<string, unknown>;
  const rootfiles = (container.container as Record<string, unknown> | undefined)?.rootfiles as Record<string, unknown> | undefined;
  const rootfile = asArray(rootfiles?.rootfile)[0];
  const packagePath = attribute(rootfile, 'full-path');
  if (!packagePath) throw new Error('EPUB 没有声明内容清单');
  const packageXml = await zip.file(packagePath)?.async('string');
  if (!packageXml) throw new Error('EPUB 内容清单不存在');
  const packageData = parser.parse(packageXml) as Record<string, unknown>;
  const packageNode = packageData.package as Record<string, unknown> | undefined;
  if (!packageNode) throw new Error('EPUB 内容清单无效');
  const metadata = (packageNode.metadata ?? {}) as Record<string, unknown>;
  const manifest = (packageNode.manifest ?? {}) as Record<string, unknown>;
  const spine = (packageNode.spine ?? {}) as Record<string, unknown>;
  const manifestItems = asArray(manifest.item).filter((item): item is Record<string, unknown> => (
    typeof item === 'object' && item !== null
  ));
  const byId = new Map(manifestItems.map((item) => [attribute(item, 'id'), item]));
  const spineItems = asArray(spine.itemref).filter((item): item is Record<string, unknown> => (
    typeof item === 'object' && item !== null
  ));
  if (!spineItems.length) throw new Error('EPUB 没有可读取的章节顺序');
  if (spineItems.length > MAX_SECTIONS) throw new Error('EPUB 章节数量超过 5000，请拆分后再导入');

  const orderedParser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    removeNSPrefix: true,
    processEntities: true,
  });
  const sections: ExtractedDocumentSection[] = [];
  for (const itemRef of spineItems) {
    const manifestItem = byId.get(attribute(itemRef, 'idref'));
    if (!manifestItem) continue;
    const mediaType = attribute(manifestItem, 'media-type');
    if (!/xhtml|html|xml/i.test(mediaType)) continue;
    const href = attribute(manifestItem, 'href');
    if (!href) continue;
    const chapterPath = resolveEpubPath(packagePath, href);
    const markup = await zip.file(chapterPath)?.async('string');
    if (!markup) continue;
    const parsedMarkup: unknown = orderedParser.parse(markup);
    const content = normalizeText(orderedMarkupText(parsedMarkup));
    if (!content) continue;
    const explicitHeading = firstMarkupHeading(parsedMarkup);
    const firstLine = content.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
    const heading = explicitHeading || (firstLine.length <= 180 ? firstLine : `章节 ${sections.length + 1}`);
    const body = explicitHeading && content.startsWith(explicitHeading)
      ? normalizeText(content.slice(explicitHeading.length))
      : content;
    if (body) sections.push(...splitLongContent(body, heading.slice(0, 300), chapterPath));
  }
  assertExtractedSize(sections);
  const title = metadataString(metadata.title) || withoutExtension(fileName);
  const warnings: DocumentImportWarningView[] = [];
  if (!metadataString(metadata.title) || !metadataString(metadata.creator)) {
    warnings.push(warning('EPUB_METADATA_INCOMPLETE', 'INFO', 'EPUB 元数据不完整，可在确认导入前补充标题或作者。'));
  }
  return {
    format: 'EPUB',
    title,
    author: metadataString(metadata.creator),
    publisher: metadataString(metadata.publisher),
    language: metadataString(metadata.language),
    identifier: metadataString(metadata.identifier),
    encoding: 'UTF-8',
    pageCount: null,
    sections,
    warnings,
    blockedReason: null,
  };
}

export async function extractDocument(
  buffer: Buffer,
  fileName: string,
): Promise<ExtractedDocument> {
  if (!buffer.length) throw new Error('文件为空');
  if (buffer.length > MAX_DOCUMENT_FILE_BYTES) throw new Error('单个文件不能超过 100 MB');
  const extension = extname(fileName).toLocaleLowerCase();
  const isPdf = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (isPdf) return extractPdf(buffer, fileName);
  if (extension === '.epub') return extractEpub(buffer, fileName);
  if (['.md', '.markdown', '.mdown', '.mkd'].includes(extension)) {
    return extractPlainText(buffer, fileName, 'MARKDOWN');
  }
  if (['.txt', '.text'].includes(extension)) return extractPlainText(buffer, fileName, 'TEXT');
  if (extension === '.pdf') throw new Error('文件扩展名是 PDF，但内容不是有效的 PDF');
  throw new Error('暂不支持这种文件格式；请选择 PDF、EPUB、Markdown 或 TXT');
}
