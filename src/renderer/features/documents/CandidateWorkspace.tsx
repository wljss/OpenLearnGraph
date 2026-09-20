import { useEffect, useMemo, useState } from 'react';
import type {
  CandidateConceptView,
  CandidateWorkspaceView,
  KnowledgeGraphDocument,
} from '../../../shared/contracts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorMessage } from '../../errorMessage';

interface CandidateWorkspaceProps {
  graph: KnowledgeGraphDocument;
  onClose: () => void;
  onNavigateSource: (concept: CandidateConceptView) => void;
  onGraphUpdated: (graph: KnowledgeGraphDocument) => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

function ConceptCard({ concept, busy, onWorkspace, onNavigateSource, onMessage }: {
  concept: CandidateConceptView;
  busy: boolean;
  onWorkspace: (workspace: CandidateWorkspaceView) => void;
  onNavigateSource: (concept: CandidateConceptView) => void;
  onMessage: CandidateWorkspaceProps['onMessage'];
}): React.JSX.Element {
  const [name, setName] = useState(concept.name);
  const [description, setDescription] = useState(concept.description);
  const [saving, setSaving] = useState(false);
  const changed = name !== concept.name || description !== concept.description;

  const save = async (): Promise<void> => {
    if (!name.trim() || !changed) return;
    setSaving(true);
    try {
      onWorkspace(await window.openLearnGraph.candidates.updateConcept({
        candidateId: concept.id,
        name,
        description,
      }));
      onMessage('候选概念已保存。', 'success');
    } catch (error) {
      onMessage(`候选概念保存失败：${errorMessage(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const review = async (status: 'PENDING' | 'IGNORED'): Promise<void> => {
    setSaving(true);
    try {
      onWorkspace(await window.openLearnGraph.candidates.reviewConcept({
        candidateId: concept.id,
        status,
      }));
      onMessage(status === 'IGNORED' ? '候选概念已忽略，审核记录仍会保留。' : '候选概念已恢复为待审核。', 'success');
    } catch (error) {
      onMessage(`候选概念状态更新失败：${errorMessage(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={`candidate-card candidate-${concept.status.toLocaleLowerCase()}`}>
      <header>
        <span>{concept.status === 'PENDING' ? '待审核' : concept.status === 'ACCEPTED' ? '已写入图谱' : '已忽略'}{concept.origin === 'AI' ? ` · AI ${concept.sourceModel ?? ''}` : ' · 手工'}</span>
        <button
          type="button"
          disabled={!concept.documentId}
          title={concept.documentId ? '返回资料中的原文位置' : '原资料已删除，仅保留出处快照'}
          onClick={() => onNavigateSource(concept)}
        >
          {concept.documentTitle} · {concept.sourceLocator}
        </button>
      </header>
      <blockquote>{concept.sourceQuote}</blockquote>
      {concept.status === 'PENDING' ? <>
        <label>
          概念名称
          <input value={name} maxLength={160} disabled={busy || saving} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          概念描述
          <textarea value={description} maxLength={10_000} disabled={busy || saving} placeholder="说明这个概念是什么，以及学习它的意义……" onChange={(event) => setDescription(event.target.value)} />
        </label>
        {concept.duplicateNodeId && <p className="candidate-duplicate" role="alert">与正式图谱中的“{concept.duplicateNodeName}”重名，请修改名称后再写入。</p>}
        <footer>
          <button type="button" disabled={busy || saving} onClick={() => void review('IGNORED')}>忽略</button>
          <button className="primary-button" type="button" disabled={busy || saving || !changed || !name.trim()} onClick={() => void save()}>
            {saving ? '处理中…' : '保存修改'}
          </button>
        </footer>
      </> : <>
        <h4>{concept.name}</h4>
        <p>{concept.description || '未填写描述'}</p>
        {concept.status === 'IGNORED' && <footer>
          <button type="button" disabled={busy || saving} onClick={() => void review('PENDING')}>恢复审核</button>
        </footer>}
      </>}
    </article>
  );
}

export function CandidateWorkspace({
  graph, onClose, onNavigateSource, onGraphUpdated, onMessage,
}: CandidateWorkspaceProps): React.JSX.Element {
  const [workspace, setWorkspace] = useState<CandidateWorkspaceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [applyConfirmation, setApplyConfirmation] = useState(false);

  useEffect(() => {
    let active = true;
    void window.openLearnGraph.candidates.getWorkspace(graph.id).then((result) => {
      if (active) setWorkspace(result);
    }).catch((error: unknown) => {
      if (active) onMessage(`候选图谱加载失败：${errorMessage(error)}`, 'error');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [graph.id, onMessage]);

  const pending = useMemo(
    () => workspace?.concepts.filter((concept) => concept.status === 'PENDING') ?? [],
    [workspace],
  );
  const history = useMemo(
    () => workspace?.concepts.filter((concept) => concept.status !== 'PENDING') ?? [],
    [workspace],
  );
  const relationshipHistory = useMemo(
    () => workspace?.relationships.filter((relationship) => relationship.status !== 'PENDING') ?? [],
    [workspace],
  );
  const conceptById = useMemo(
    () => new Map(workspace?.concepts.map((concept) => [concept.id, concept]) ?? []),
    [workspace],
  );

  const effectiveSourceId = pending.some((concept) => concept.id === sourceId)
    ? sourceId
    : pending[0]?.id ?? '';
  const effectiveTargetId = pending.some((concept) => concept.id === targetId)
    && targetId !== effectiveSourceId
    ? targetId
    : pending.find((concept) => concept.id !== effectiveSourceId)?.id ?? '';

  const createRelationship = async (): Promise<void> => {
    if (!effectiveSourceId || !effectiveTargetId || effectiveSourceId === effectiveTargetId) return;
    setBusy(true);
    try {
      setWorkspace(await window.openLearnGraph.candidates.createRelationship({
        graphId: graph.id,
        sourceCandidateId: effectiveSourceId,
        targetCandidateId: effectiveTargetId,
      }));
      onMessage('候选先修关系已添加。', 'success');
    } catch (error) {
      onMessage(`候选关系添加失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteRelationship = async (relationshipId: string): Promise<void> => {
    setBusy(true);
    try {
      setWorkspace(await window.openLearnGraph.candidates.deleteRelationship(relationshipId));
    } catch (error) {
      onMessage(`候选关系删除失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (): Promise<void> => {
    setApplyConfirmation(false);
    setBusy(true);
    try {
      const result = await window.openLearnGraph.candidates.apply(graph.id);
      onGraphUpdated(result.graph);
      setWorkspace(await window.openLearnGraph.candidates.getWorkspace(graph.id));
      onMessage(`已将 ${result.acceptedConceptCount} 个概念和 ${result.acceptedRelationshipCount} 条先修关系写入图谱。`, 'success');
    } catch (error) {
      onMessage(`候选图谱写入失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="candidate-workspace-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
        <section className="candidate-workspace" role="dialog" aria-modal="true" aria-labelledby="candidate-workspace-title" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <span>人工审核 · 写入前始终是候选图谱</span>
              <h3 id="candidate-workspace-title">{graph.name} · 候选概念</h3>
              <p>每个候选项都保留原文出处。当前阶段完全本地，不调用 AI API。</p>
            </div>
            <button type="button" aria-label="关闭候选图谱" disabled={busy} onClick={onClose}>×</button>
          </header>
          {loading ? <p className="candidate-loading">正在读取候选图谱……</p> : workspace ? (
            <div className="candidate-workspace-body">
              {workspace.blockingIssues.length > 0 && (
                <ul className="candidate-issues" role="alert">{workspace.blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
              )}
              <section className="candidate-list-section">
                <div className="candidate-section-title">
                  <h4>待审核概念</h4><span>{pending.length} 个</span>
                </div>
                {pending.length ? <div className="candidate-card-list">{pending.map((concept) => (
                  <ConceptCard key={`${concept.id}:${concept.updatedAt}:${concept.status}`} concept={concept} busy={busy} onWorkspace={setWorkspace} onNavigateSource={onNavigateSource} onMessage={onMessage} />
                ))}</div> : <div className="candidate-empty">在资料正文中选中原文，然后点击“创建候选概念”。</div>}
              </section>

              <section className="candidate-relations-section">
                <div className="candidate-section-title"><h4>候选先修关系</h4><span>{workspace.pendingRelationshipCount} 条</span></div>
                <div className="candidate-relation-builder">
                  <select aria-label="先修候选概念" value={effectiveSourceId} disabled={busy || pending.length < 2} onChange={(event) => setSourceId(event.target.value)}>
                    {pending.map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}
                  </select>
                  <span>是</span>
                  <select aria-label="后续候选概念" value={effectiveTargetId} disabled={busy || pending.length < 2} onChange={(event) => setTargetId(event.target.value)}>
                    {pending.filter((concept) => concept.id !== effectiveSourceId).map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}
                  </select>
                  <span>的先修</span>
                  <button type="button" disabled={busy || pending.length < 2 || !effectiveSourceId || !effectiveTargetId} onClick={() => void createRelationship()}>添加关系</button>
                </div>
                <ol className="candidate-relation-list">{workspace.relationships.filter((item) => item.status === 'PENDING').map((relationship) => (
                  <li key={relationship.id}>
                    <span><strong>{conceptById.get(relationship.sourceCandidateId)?.name}</strong> → <strong>{conceptById.get(relationship.targetCandidateId)?.name}</strong></span>
                    <button type="button" disabled={busy} onClick={() => void deleteRelationship(relationship.id)}>删除</button>
                  </li>
                ))}</ol>
              </section>

              {(history.length > 0 || relationshipHistory.length > 0) && <details className="candidate-history">
                <summary>审核历史（{history.length} 个概念 · {relationshipHistory.length} 条关系）</summary>
                {history.length > 0 && <div className="candidate-card-list">{history.map((concept) => (
                  <ConceptCard key={`${concept.id}:${concept.updatedAt}:${concept.status}`} concept={concept} busy={busy} onWorkspace={setWorkspace} onNavigateSource={onNavigateSource} onMessage={onMessage} />
                ))}</div>}
                {relationshipHistory.length > 0 && <div className="candidate-relation-history">
                  <strong>先修关系记录</strong>
                  <ol className="candidate-relation-list">{relationshipHistory.map((relationship) => (
                    <li key={relationship.id}>
                      <span><strong>{conceptById.get(relationship.sourceCandidateId)?.name}</strong> → <strong>{conceptById.get(relationship.targetCandidateId)?.name}</strong></span>
                      <em>{relationship.status === 'ACCEPTED' ? '已写入图谱' : '已忽略'}</em>
                    </li>
                  ))}</ol>
                </div>}
              </details>}
            </div>
          ) : <div className="candidate-empty">候选图谱暂时无法读取，请关闭后重试。</div>}
          <footer>
            <span>{workspace ? `${workspace.pendingConceptCount} 个概念 · ${workspace.pendingRelationshipCount} 条关系待写入` : '候选图谱未加载'}</span>
            <button
              className="primary-button"
              type="button"
              disabled={busy || !workspace?.pendingConceptCount || Boolean(workspace.blockingIssues.length)}
              onClick={() => setApplyConfirmation(true)}
            >
              {busy ? '处理中…' : '确认写入正式图谱'}
            </button>
          </footer>
        </section>
      </div>
      {applyConfirmation && workspace && (
        <ConfirmDialog
          title="将候选内容写入正式图谱？"
          description={`将新增 ${workspace.pendingConceptCount} 个概念和 ${workspace.pendingRelationshipCount} 条先修关系。写入后可在图谱中继续编辑，但候选审核记录会保留。`}
          confirmLabel="确认写入图谱"
          onCancel={() => setApplyConfirmation(false)}
          onConfirm={() => void apply()}
        />
      )}
    </>
  );
}
