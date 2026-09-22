import { useEffect, useMemo, useState } from 'react';
import type {
  AiCandidateGenerationPreviewView,
  GraphSummary,
  ImportedDocumentView,
  KnowledgeGraphDocument,
  DocumentSectionSummaryView,
} from '../../../shared/contracts';
import { errorMessage } from '../../errorMessage';

const SECTION_PAGE_SIZE = 50;
const MAX_SELECTED_SECTIONS = 80;
const MAX_TOTAL_CHARACTERS = 256_000;
const BATCH_CHARACTERS = 32_000;

export function AiCandidateScopeDialog({
  document,
  initialSectionPosition,
  activeGraph,
  onClose,
  onPrepared,
  onGraphCreated,
  onMessage,
}: {
  document: ImportedDocumentView;
  initialSectionPosition: number;
  activeGraph: KnowledgeGraphDocument | null;
  onClose: () => void;
  onPrepared: (preview: AiCandidateGenerationPreviewView, targetGraph: KnowledgeGraphDocument) => void;
  onGraphCreated: (graph: KnowledgeGraphDocument) => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
}): React.JSX.Element {
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [sections, setSections] = useState<DocumentSectionSummaryView[]>([]);
  const [targetGraphId, setTargetGraphId] = useState(activeGraph?.id ?? '');
  const [startPosition, setStartPosition] = useState(initialSectionPosition);
  const [endPosition, setEndPosition] = useState(initialSectionPosition);
  const [newGraphName, setNewGraphName] = useState('');
  const [creatingGraph, setCreatingGraph] = useState(false);
  const [showGraphCreator, setShowGraphCreator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const load = async (): Promise<void> => {
      try {
        const offsets = Array.from(
          { length: Math.ceil(document.sectionCount / SECTION_PAGE_SIZE) },
          (_, index) => index * SECTION_PAGE_SIZE,
        );
        const [availableGraphs, sectionPages] = await Promise.all([
          window.openLearnGraph.graphs.list(),
          Promise.all(offsets.map((offset) => window.openLearnGraph.documents.listSections(document.id, offset))),
        ]);
        if (!current) return;
        const loadedSections = sectionPages.flat().sort((left, right) => left.position - right.position);
        setGraphs(availableGraphs);
        setSections(loadedSections);
        const preferredGraph = activeGraph && availableGraphs.some((graph) => graph.id === activeGraph.id)
          ? activeGraph.id
          : availableGraphs[0]?.id ?? '';
        setTargetGraphId(preferredGraph);
        setShowGraphCreator(!availableGraphs.length);
      } catch (reason) {
        if (current) setError(`发送范围加载失败：${errorMessage(reason)}`);
      } finally {
        if (current) setLoading(false);
      }
    };
    void load();
    return () => { current = false; };
  }, [activeGraph, document.id, document.sectionCount]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy || creatingGraph) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, creatingGraph, onClose]);

  const selectedSections = useMemo(
    () => sections.filter((section) => section.position >= startPosition && section.position <= endPosition),
    [endPosition, sections, startPosition],
  );
  const selectedCharCount = selectedSections.reduce((total, section) => total + section.charCount, 0);
  const estimatedBatchCount = Math.max(1, Math.ceil(selectedCharCount / BATCH_CHARACTERS));
  const rangeTooLong = selectedSections.length > MAX_SELECTED_SECTIONS;
  const contentTooLong = selectedCharCount > MAX_TOTAL_CHARACTERS;
  const currentSection = sections.find((section) => section.position === initialSectionPosition);
  const startSection = sections.find((section) => section.position === startPosition);
  const endSection = sections.find((section) => section.position === endPosition);

  const createGraph = async (): Promise<void> => {
    if (!newGraphName.trim()) return;
    setCreatingGraph(true);
    setError(null);
    try {
      const graph = await window.openLearnGraph.graphs.create({ name: newGraphName });
      setGraphs((current) => [
        ...current.filter((item) => item.id !== graph.id),
        { id: graph.id, name: graph.name, createdAt: graph.createdAt, updatedAt: graph.updatedAt },
      ]);
      setTargetGraphId(graph.id);
      setNewGraphName('');
      setShowGraphCreator(false);
      onGraphCreated(graph);
      onMessage(`已创建目标图谱“${graph.name}”。`, 'success');
    } catch (reason) {
      setError(`图谱创建失败：${errorMessage(reason)}`);
    } finally {
      setCreatingGraph(false);
    }
  };

  const prepare = async (): Promise<void> => {
    if (!targetGraphId || !selectedSections.length || rangeTooLong || contentTooLong) return;
    setBusy(true);
    setError(null);
    try {
      const [targetGraph, preview] = await Promise.all([
        window.openLearnGraph.graphs.load(targetGraphId),
        window.openLearnGraph.ai.previewCandidateGeneration({
          graphId: targetGraphId,
          documentId: document.id,
          sectionPositions: selectedSections.map((section) => section.position),
        }),
      ]);
      if (!targetGraph) throw new Error('目标图谱已经不存在，请重新选择');
      onPrepared(preview, targetGraph);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="candidate-workspace-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <section className="ai-scope-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-scope-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>步骤 1 / 2 · 选择目标与范围</span><h3 id="ai-scope-title">生成学习路线候选</h3></div>
          <button type="button" aria-label="关闭范围选择" disabled={busy || creatingGraph} onClick={onClose}>×</button>
        </header>
        <div className="ai-scope-body">
          {loading ? <p className="ai-inline-status" role="status">正在读取图谱与章节目录……</p> : <>
            <section className="ai-scope-block">
              <div className="ai-scope-heading">
                <div><strong>添加到哪个图谱？</strong><p>AI 结果会先进入这个图谱的候选审核区，不会直接写入正式图谱。</p></div>
                <button type="button" disabled={busy || creatingGraph} onClick={() => setShowGraphCreator((value) => !value)}>
                  {showGraphCreator ? '取消新建' : '＋ 新建图谱'}
                </button>
              </div>
              {graphs.length > 0 && (
                <label className="ai-scope-field" htmlFor="ai-target-graph">
                  目标图谱
                  <select id="ai-target-graph" value={targetGraphId} disabled={busy || creatingGraph} onChange={(event) => setTargetGraphId(event.target.value)}>
                    {graphs.map((graph) => <option key={graph.id} value={graph.id}>{graph.name}{graph.id === activeGraph?.id ? '（当前）' : ''}</option>)}
                  </select>
                </label>
              )}
              {showGraphCreator && (
                <form className="ai-new-graph" onSubmit={(event) => { event.preventDefault(); void createGraph(); }}>
                  <label htmlFor="ai-new-graph-name">新图谱名称</label>
                  <div>
                    <input id="ai-new-graph-name" value={newGraphName} maxLength={120} disabled={busy || creatingGraph} placeholder="例如：深度学习基础" autoFocus onChange={(event) => setNewGraphName(event.target.value)} />
                    <button className="primary-button" type="submit" disabled={busy || creatingGraph || !newGraphName.trim()}>{creatingGraph ? '创建中…' : '创建并选中'}</button>
                  </div>
                </form>
              )}
            </section>

            <section className="ai-scope-block">
              <div className="ai-scope-heading">
                <div><strong>分析哪些连续章节？</strong><p>从当前阅读位置开始，可扩展为一组连续章节；应用会自动拆成多次请求再合并结果。</p></div>
                <button type="button" disabled={busy} onClick={() => { setStartPosition(initialSectionPosition); setEndPosition(initialSectionPosition); }}>仅当前节</button>
              </div>
              <div className="ai-range-fields">
                <label htmlFor="ai-range-start">开始章节
                  <select id="ai-range-start" value={startPosition} disabled={busy} onChange={(event) => {
                    const position = Number(event.target.value);
                    setStartPosition(position);
                    if (endPosition < position) setEndPosition(position);
                  }}>
                    {sections.map((section) => <option key={section.position} value={section.position}>第 {section.position + 1} 节 · {section.heading}</option>)}
                  </select>
                </label>
                <span aria-hidden="true">至</span>
                <label htmlFor="ai-range-end">结束章节
                  <select id="ai-range-end" value={endPosition} disabled={busy} onChange={(event) => setEndPosition(Number(event.target.value))}>
                    {sections.filter((section) => section.position >= startPosition).map((section) => <option key={section.position} value={section.position}>第 {section.position + 1} 节 · {section.heading}</option>)}
                  </select>
                </label>
              </div>
              <div className="ai-range-summary" aria-live="polite">
                <span><small>范围</small><strong>{selectedSections.length} 节</strong></span>
                <span><small>正文</small><strong>{selectedCharCount.toLocaleString('zh-CN')} 字符</strong></span>
                <span><small>预计请求</small><strong>{estimatedBatchCount} 批</strong></span>
              </div>
              {startSection && endSection && <p className="ai-range-caption">{startSection.heading}{startSection.position !== endSection.position ? ` → ${endSection.heading}` : ''}</p>}
              {currentSection && <p className="ai-range-current">当前阅读：第 {currentSection.position + 1} 节 · {currentSection.heading}</p>}
              {rangeTooLong && <p className="document-reader-error" role="alert">一次最多选择 {MAX_SELECTED_SECTIONS} 个连续章节，请缩小范围。</p>}
              {contentTooLong && <p className="document-reader-error" role="alert">一次最多分析 {MAX_TOTAL_CHARACTERS.toLocaleString('zh-CN')} 个字符，请缩小范围。</p>}
            </section>

            <div className="ai-privacy-note">
              <strong>现在还不会发送任何正文</strong>
              <p>下一步会显示准确的目标图谱、章节、字符数与请求批次。只有你再次勾选同意并确认，正文才会发送给 DeepSeek。</p>
            </div>
          </>}
          {error && <p className="document-reader-error" role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" disabled={busy || creatingGraph} onClick={onClose}>取消</button>
          <button className="primary-button" type="button" disabled={loading || busy || creatingGraph || !targetGraphId || !selectedSections.length || rangeTooLong || contentTooLong} onClick={() => void prepare()}>
            {busy ? '正在核对…' : '下一步：核对发送范围'}
          </button>
        </footer>
      </section>
    </div>
  );
}
