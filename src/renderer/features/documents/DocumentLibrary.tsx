import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DocumentPreviewView,
  DocumentSectionPreviewView,
  ImportedDocumentSummaryView,
  ImportedDocumentView,
} from '../../../shared/contracts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorMessage } from '../../errorMessage';

interface DocumentLibraryProps {
  onClose: () => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

interface EditableMetadata {
  title: string;
  author: string;
  publisher: string;
  language: string;
  identifier: string;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function metadataFromPreview(preview: DocumentPreviewView): EditableMetadata {
  return {
    title: preview.title,
    author: preview.author,
    publisher: preview.publisher,
    language: preview.language,
    identifier: preview.identifier,
  };
}

function SectionReader({ sections, totalSections, isImportPreview }: {
  sections: DocumentSectionPreviewView[];
  totalSections: number;
  isImportPreview: boolean;
}): React.JSX.Element {
  const [selectedPosition, setSelectedPosition] = useState(sections[0]?.position ?? 0);
  const selected = sections.find((section) => section.position === selectedPosition) ?? sections[0];
  if (!selected) return (
    <div className="document-no-text">
      <strong>没有可预览的正文</strong>
      <p>如果这是扫描版 PDF，需要先经过 OCR 才能导入。</p>
    </div>
  );
  return (
    <div className="document-reader">
      <aside aria-label="章节与页面">
        <strong>内容预览</strong>
        {totalSections > sections.length && (
          <p className="document-preview-limit">
            当前仅展示前 {sections.length} / {totalSections} 节；
            {isImportPreview ? '确认导入时会保存全部正文。' : '其余章节也已保存在本机。'}
          </p>
        )}
        <ol>{sections.map((section) => (
          <li key={section.position}>
            <button
              type="button"
              className={section.position === selected.position ? 'active' : ''}
              onClick={() => setSelectedPosition(section.position)}
            >
              <span>{section.heading}</span>
              <small>{section.locator} · {section.charCount.toLocaleString('zh-CN')} 字符</small>
            </button>
          </li>
        ))}</ol>
      </aside>
      <article>
        <header><span>{selected.locator}</span><strong>{selected.heading}</strong></header>
        <pre>{selected.content}</pre>
        {selected.truncated && <p>这里只显示本节前 {selected.content.length.toLocaleString('zh-CN')} 个字符；{isImportPreview ? '确认导入时会保存完整正文。' : '完整正文已保存在本机。'}</p>}
      </article>
    </div>
  );
}

export function DocumentLibrary({ onClose, onMessage }: DocumentLibraryProps): React.JSX.Element {
  const [documents, setDocuments] = useState<ImportedDocumentSummaryView[]>([]);
  const [preview, setPreview] = useState<DocumentPreviewView | null>(null);
  const [detail, setDetail] = useState<ImportedDocumentView | null>(null);
  const [metadata, setMetadata] = useState<EditableMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [discardConfirmation, setDiscardConfirmation] = useState<'close' | 'back' | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);

  const loadDocuments = useCallback(async (): Promise<void> => {
    setDocuments(await window.openLearnGraph.documents.list());
  }, []);

  useEffect(() => {
    let active = true;
    void window.openLearnGraph.documents.list().then((items) => {
      if (active) setDocuments(items);
    }).catch((error: unknown) => {
      if (active) onMessage(`资料库加载失败：${errorMessage(error)}`, 'error');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [loadDocuments, onMessage]);

  useEffect(() => {
    const token = preview?.previewToken;
    return () => {
      if (token) void window.openLearnGraph.documents.discardPreview(token).catch(() => undefined);
    };
  }, [preview?.previewToken]);

  const metadataChanged = useMemo(() => (
    Boolean(preview && metadata && JSON.stringify(metadata) !== JSON.stringify(metadataFromPreview(preview)))
  ), [metadata, preview]);

  const requestClose = useCallback((): void => {
    if (busy) return;
    if (preview && metadataChanged) setDiscardConfirmation('close');
    else onClose();
  }, [busy, metadataChanged, onClose, preview]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy || discardConfirmation || deleteConfirmation) return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, deleteConfirmation, discardConfirmation, requestClose]);

  const chooseFile = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await window.openLearnGraph.documents.chooseFile();
      if (!next) return;
      setPreview(next);
      setMetadata(metadataFromPreview(next));
      setDetail(null);
      onMessage(next.canImport
        ? '文本提取完成，请核对元数据和正文预览。'
        : `文件已检查，但暂时不能导入：${next.blockedReason}`, next.canImport ? 'success' : 'error');
    } catch (error) {
      onMessage(`文件解析失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async (documentId: string): Promise<void> => {
    setBusy(true);
    try {
      setDetail(await window.openLearnGraph.documents.get(documentId));
      setPreview(null);
      setMetadata(null);
    } catch (error) {
      onMessage(`资料打开失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async (): Promise<void> => {
    if (!preview || !metadata || !preview.canImport || !metadata.title.trim()) return;
    setBusy(true);
    try {
      const imported = await window.openLearnGraph.documents.confirmImport({
        previewToken: preview.previewToken,
        title: metadata.title,
        author: metadata.author,
        publisher: metadata.publisher,
        language: metadata.language,
        identifier: metadata.identifier,
      });
      setPreview(null);
      setMetadata(null);
      setDetail(imported);
      await loadDocuments();
      onMessage(`“${imported.title}”已保存到本地资料库。`, 'success');
    } catch (error) {
      onMessage(`资料导入失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteDocument = async (): Promise<void> => {
    if (!detail) return;
    setDeleteConfirmation(false);
    setBusy(true);
    try {
      await window.openLearnGraph.documents.delete(detail.id);
      setDetail(null);
      await loadDocuments();
      onMessage('资料及其本地正文已删除。', 'success');
    } catch (error) {
      onMessage(`资料删除失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const returnToLibrary = (): void => {
    if (preview && metadataChanged) {
      setDiscardConfirmation('back');
      return;
    }
    setPreview(null);
    setMetadata(null);
    setDetail(null);
  };

  const current = preview ?? detail;
  return (
    <>
      <div className="dialog-backdrop assessment-backdrop" role="presentation" onMouseDown={requestClose}>
        <section
          className="document-library"
          role="dialog"
          aria-modal="true"
          aria-labelledby="document-library-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="assessment-modal-header document-library-header">
            <div>
              <span className="modal-kicker">完全本地 · 不调用 AI API</span>
              <h2 id="document-library-title">{current ? current.title : '本地资料库'}</h2>
              <p>{current ? current.sourceName : '先预览提取结果，确认后才保存正文。支持 PDF、EPUB、Markdown 和 TXT。'}</p>
            </div>
            <div className="document-header-actions">
              {current && <button type="button" disabled={busy} onClick={returnToLibrary}>返回资料库</button>}
              <button className="modal-close" type="button" aria-label="关闭资料库" disabled={busy} onClick={requestClose}>×</button>
            </div>
          </header>

          {!current ? (
            <div className="document-library-home">
              <div className="document-library-toolbar">
                <div><strong>已导入资料</strong><span>{documents.length} 份 · 最多显示最近 500 份</span></div>
                <button className="primary-button" type="button" disabled={busy} onClick={() => void chooseFile()}>
                  {busy ? '正在解析…' : '＋ 选择本地文件'}
                </button>
              </div>
              {loading ? <p className="document-empty">正在读取本地资料库……</p> : documents.length ? (
                <ol className="document-list">{documents.map((document) => (
                  <li key={document.id}>
                    <button type="button" disabled={busy} onClick={() => void openDocument(document.id)}>
                      <span className={`document-format format-${document.format.toLowerCase()}`}>{document.format}</span>
                      <div>
                        <strong>{document.title}</strong>
                        <p>{document.author || '作者未填写'} · {document.sectionCount} 节 · {document.charCount.toLocaleString('zh-CN')} 字符</p>
                        <small>{document.sourceName} · {formatDate(document.importedAt)}</small>
                      </div>
                      {document.warningCount > 0 && <span className="document-warning-count">{document.warningCount} 项提醒</span>}
                      <span aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}</ol>
              ) : (
                <div className="document-empty-state">
                  <span aria-hidden="true">▤</span>
                  <h3>还没有导入资料</h3>
                  <p>选择文件后会先在本机提取和预览，不会直接修改知识图谱。</p>
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => void chooseFile()}>选择第一份资料</button>
                </div>
              )}
            </div>
          ) : (
            <div className="document-review">
              <section className="document-summary-bar">
                <span className={`document-format format-${current.format.toLowerCase()}`}>{current.format}</span>
                <div><strong>{formatBytes(current.fileSize)}</strong><small>文件大小</small></div>
                <div><strong>{current.pageCount ?? '—'}</strong><small>{current.format === 'PDF' ? '页' : '页数'}</small></div>
                <div><strong>{current.sectionCount}</strong><small>章节/页面</small></div>
                <div><strong>{current.charCount.toLocaleString('zh-CN')}</strong><small>提取字符</small></div>
                <div><strong>{current.encoding ?? '—'}</strong><small>文本编码</small></div>
              </section>

              {preview && metadata ? (
                <section className="document-metadata-editor" aria-label="导入元数据">
                  <label>标题<input value={metadata.title} maxLength={300} disabled={busy} onChange={(event) => setMetadata({ ...metadata, title: event.target.value })} /></label>
                  <label>作者<input value={metadata.author} maxLength={300} disabled={busy} placeholder="可选" onChange={(event) => setMetadata({ ...metadata, author: event.target.value })} /></label>
                  <label>出版社<input value={metadata.publisher} maxLength={300} disabled={busy} placeholder="可选" onChange={(event) => setMetadata({ ...metadata, publisher: event.target.value })} /></label>
                  <label>语言<input value={metadata.language} maxLength={80} disabled={busy} placeholder="例如 zh-CN" onChange={(event) => setMetadata({ ...metadata, language: event.target.value })} /></label>
                  <label>ISBN / 标识符<input value={metadata.identifier} maxLength={200} disabled={busy} placeholder="可选" onChange={(event) => setMetadata({ ...metadata, identifier: event.target.value })} /></label>
                </section>
              ) : detail && (
                <section className="document-metadata-readonly">
                  <span>作者<strong>{detail.author || '未填写'}</strong></span>
                  <span>出版社<strong>{detail.publisher || '未填写'}</strong></span>
                  <span>语言<strong>{detail.language || '未填写'}</strong></span>
                  <span>标识符<strong>{detail.identifier || '未填写'}</strong></span>
                  <span>导入时间<strong>{formatDate(detail.importedAt)}</strong></span>
                </section>
              )}

              {current.warnings.length > 0 && (
                <ul className="document-warnings">{current.warnings.map((item) => (
                  <li key={`${item.code}:${item.message}`} className={`warning-${item.severity.toLowerCase()}`}>
                    <strong>{item.severity === 'BLOCKING' ? '无法导入' : item.severity === 'WARNING' ? '请检查' : '提取说明'}</strong>
                    <span>{item.message}</span>
                  </li>
                ))}</ul>
              )}
              {preview?.blockedReason && <div className="document-blocked" role="alert">{preview.blockedReason}</div>}
              {preview?.duplicateDocumentId && (
                <button className="secondary-button document-duplicate-link" type="button" onClick={() => void openDocument(preview.duplicateDocumentId as string)}>
                  查看已导入的“{preview.duplicateDocumentTitle}”
                </button>
              )}
              <SectionReader sections={current.sections} totalSections={current.sectionCount} isImportPreview={Boolean(preview)} />

              <footer className="document-review-footer">
                <span>SHA-256 {current.sha256.slice(0, 12)}… · 原文件不会被修改或上传</span>
                <div>
                  {detail && <button className="text-danger-button" type="button" disabled={busy} onClick={() => setDeleteConfirmation(true)}>删除资料</button>}
                  {preview && (
                    <button className="primary-button" type="button" disabled={busy || !preview.canImport || !metadata?.title.trim()} onClick={() => void confirmImport()}>
                      {busy ? '正在保存…' : '确认导入资料库'}
                    </button>
                  )}
                </div>
              </footer>
            </div>
          )}
        </section>
      </div>

      {discardConfirmation && (
        <ConfirmDialog
          title="放弃当前资料预览？"
          description="元数据修改尚未导入，返回后不会保存；源文件不会受到影响。"
          confirmLabel="放弃预览"
          destructive
          onCancel={() => setDiscardConfirmation(null)}
          onConfirm={() => {
            const target = discardConfirmation;
            setDiscardConfirmation(null);
            if (preview) void window.openLearnGraph.documents.discardPreview(preview.previewToken).catch(() => undefined);
            setPreview(null);
            setMetadata(null);
            setDetail(null);
            if (target === 'close') onClose();
          }}
        />
      )}
      {deleteConfirmation && detail && (
        <ConfirmDialog
          title={`删除“${detail.title}”？`}
          description="将删除本地资料记录和已提取正文，不会删除磁盘上的原文件。此操作无法恢复。"
          confirmLabel="删除资料"
          destructive
          onCancel={() => setDeleteConfirmation(false)}
          onConfirm={() => void deleteDocument()}
        />
      )}
    </>
  );
}
