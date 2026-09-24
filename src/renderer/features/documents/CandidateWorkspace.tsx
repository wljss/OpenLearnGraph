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
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const changed = name !== concept.name || description !== concept.description;
  const pending = concept.status === 'PENDING';
  const needsRename = pending && Boolean(concept.duplicateNodeId);
  const statusLabel = concept.status === 'ACCEPTED'
    ? '已加入图谱'
    : concept.status === 'IGNORED'
      ? '已排除'
      : needsRename
        ? '需要改名'
        : concept.reviewedAt
          ? '已核对保留'
          : '建议加入';

  const save = async (): Promise<void> => {
    if (!name.trim() || !changed) return;
    setSaving(true);
    try {
      onWorkspace(await window.openLearnGraph.candidates.updateConcept({
        candidateId: concept.id,
        name,
        description,
      }));
      setEditing(false);
      onMessage(`“${name.trim()}”已更新并保留在学习路线中。`, 'success');
    } catch (error) {
      onMessage(`学习内容修改失败：${errorMessage(error)}`, 'error');
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
      if (status === 'IGNORED') onMessage(`已从本次学习路线排除“${concept.name}”；记录仍会保留。`, 'success');
      else if (concept.status === 'IGNORED') onMessage(`已将“${concept.name}”重新加入学习路线。`, 'success');
      else onMessage(`已确认保留“${concept.name}”。`, 'success');
    } catch (error) {
      onMessage(`学习内容状态更新失败：${errorMessage(error)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelEditing = (): void => {
    setName(concept.name);
    setDescription(concept.description);
    setEditing(false);
  };

  return (
    <article className={`candidate-card candidate-${concept.status.toLocaleLowerCase()}${concept.reviewedAt ? ' candidate-reviewed' : ''}${needsRename ? ' candidate-needs-attention' : ''}`}>
      <header>
        <div className="candidate-card-labels">
          <span>{statusLabel}</span>
          <small>{concept.origin === 'AI' ? `AI 建议 · ${concept.sourceModel ?? 'DeepSeek'}` : '由你从原文添加'}</small>
        </div>
        <button
          type="button"
          disabled={!concept.documentId}
          title={concept.documentId ? '返回资料中的原文位置' : '原资料已删除，仅保留出处快照'}
          onClick={() => onNavigateSource(concept)}
        >
          {concept.documentTitle} · {concept.sourceLocator}
        </button>
      </header>

      {!editing && <div className="candidate-concept-summary">
        <h4>{concept.name}</h4>
        <p>{concept.description || '尚未填写说明；可以直接保留，也可以补充成更适合自己的表述。'}</p>
      </div>}

      <details className="candidate-source-evidence">
        <summary>查看支持这项建议的原文</summary>
        <blockquote>{concept.sourceQuote}</blockquote>
      </details>

      {needsRename && <p className="candidate-duplicate" role="alert">
        图谱中已经有“{concept.duplicateNodeName}”。请换一个更具体的名称，或者不加入这项内容。
      </p>}

      {pending && editing ? <>
        <div className="candidate-edit-fields">
          <label>
            学习内容名称
            <input value={name} maxLength={160} disabled={busy || saving} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            给学习者的说明
            <textarea value={description} maxLength={10_000} disabled={busy || saving} placeholder="用自己的话说明它是什么、为什么值得学习……" onChange={(event) => setDescription(event.target.value)} />
          </label>
        </div>
        <footer>
          <button type="button" disabled={busy || saving} onClick={cancelEditing}>取消修改</button>
          <button className="primary-button" type="button" disabled={busy || saving || !changed || !name.trim()} onClick={() => void save()}>
            {saving ? '保存中…' : '保存并保留'}
          </button>
        </footer>
      </> : pending ? <footer>
        <button type="button" disabled={busy || saving} onClick={() => setEditing(true)}>{needsRename ? '修改名称' : '修改'}</button>
        <button className="candidate-exclude-button" type="button" disabled={busy || saving} onClick={() => void review('IGNORED')}>不加入</button>
        {!needsRename && !concept.reviewedAt && (
          <button className="primary-button" type="button" disabled={busy || saving} onClick={() => void review('PENDING')}>
            {saving ? '处理中…' : '保留'}
          </button>
        )}
        {!needsRename && concept.reviewedAt && <span className="candidate-reviewed-note">✓ 已核对</span>}
      </footer> : concept.status === 'IGNORED' ? <footer>
        <button type="button" disabled={busy || saving} onClick={() => void review('PENDING')}>重新加入路线</button>
      </footer> : null}
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
      if (active) onMessage(`学习路线预览加载失败：${errorMessage(error)}`, 'error');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [graph.id, onMessage]);

  const pending = useMemo(
    () => workspace?.concepts.filter((concept) => concept.status === 'PENDING') ?? [],
    [workspace],
  );
  const accepted = useMemo(
    () => workspace?.concepts.filter((concept) => concept.status === 'ACCEPTED') ?? [],
    [workspace],
  );
  const ignored = useMemo(
    () => workspace?.concepts.filter((concept) => concept.status === 'IGNORED') ?? [],
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
  const pendingRelationships = useMemo(
    () => workspace?.relationships.filter((relationship) => relationship.status === 'PENDING') ?? [],
    [workspace],
  );
  const conceptById = useMemo(
    () => new Map(workspace?.concepts.map((concept) => [concept.id, concept]) ?? []),
    [workspace],
  );
  const reviewedPendingCount = pending.filter((concept) => concept.reviewedAt).length;
  const unreviewedPendingCount = pending.length - reviewedPendingCount;
  const explainedAiRelationshipCount = pendingRelationships.filter((relationship) => (
    relationship.origin === 'AI' && relationship.reason.trim() && relationship.evidenceQuote.trim()
  )).length;

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
      onMessage('学习顺序已添加；应用已确认它不会形成循环。', 'success');
    } catch (error) {
      onMessage(`学习顺序添加失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteRelationship = async (relationshipId: string): Promise<void> => {
    setBusy(true);
    try {
      setWorkspace(await window.openLearnGraph.candidates.deleteRelationship(relationshipId));
      onMessage('已移除这条学习顺序。', 'success');
    } catch (error) {
      onMessage(`学习顺序移除失败：${errorMessage(error)}`, 'error');
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
      onMessage(`学习路线已加入“${graph.name}”：新增 ${result.acceptedConceptCount} 个学习内容和 ${result.acceptedRelationshipCount} 条学习顺序。`, 'success');
    } catch (error) {
      onMessage(`学习路线写入失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const applyDescription = workspace
    ? `将新增 ${workspace.pendingConceptCount} 个学习内容和 ${workspace.pendingRelationshipCount} 条学习顺序，其中 ${explainedAiRelationshipCount} 条 AI 顺序带有原因与原文依据。图谱中已有的 ${graph.nodes.length} 个概念和 ${graph.edges.length} 条关系不会被覆盖。${unreviewedPendingCount ? `其中 ${unreviewedPendingCount} 项内容尚未逐项标记“保留”；继续代表你接受当前整体方案。` : '你已经逐项核对了所有待加入内容。'}`
    : '';

  return (
    <>
      <div className="candidate-workspace-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
        <section className="candidate-workspace" role="dialog" aria-modal="true" aria-labelledby="candidate-workspace-title" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <span>写入前预览 · 你保留最终决定权</span>
              <h3 id="candidate-workspace-title">学习路线预览</h3>
              <p>目标图谱：{graph.name}。应用负责核对出处、重名和循环；AI 学习顺序会同时说明原因，你只需判断这个安排是否说得通。</p>
            </div>
            <button type="button" aria-label="关闭学习路线预览" disabled={busy} onClick={onClose}>×</button>
          </header>
          {loading ? <p className="candidate-loading">正在准备学习路线预览……</p> : workspace ? (
            <div className="candidate-workspace-body">
              <section className={`candidate-route-overview${workspace.blockingIssues.length ? ' has-issues' : ''}`} aria-label="学习路线概览">
                <div className="candidate-route-status">
                  <div><span>目标图谱</span><strong>{graph.name}</strong></div>
                  <p>{workspace.blockingIssues.length
                    ? '有少量冲突需要处理，解决后即可加入图谱。'
                    : pending.length
                      ? '原文与结构检查已完成。AI 内容仍是建议，你可以整体确认，也可以查看原因后排除不合适的顺序。'
                      : accepted.length
                        ? '当前没有待处理建议，已完成的审核记录保留在下方。'
                        : '当前没有准备加入图谱的内容。'}</p>
                </div>
                <div className="candidate-route-stats">
                  <span><small>准备加入</small><strong>{pending.length}</strong><em>项内容</em></span>
                  <span><small>学习顺序</small><strong>{pendingRelationships.length}</strong><em>条建议</em></span>
                  <span><small>已逐项核对</small><strong>{reviewedPendingCount}</strong><em>不强制逐项确认</em></span>
                  <span className={workspace.blockingIssues.length ? 'needs-attention' : ''}><small>需要处理</small><strong>{workspace.blockingIssues.length}</strong><em>{workspace.blockingIssues.length ? '解决后可加入' : '检查已通过'}</em></span>
                </div>
              </section>

              {workspace.blockingIssues.length > 0 && (
                <section className="candidate-issues" role="alert">
                  <strong>请先处理以下问题</strong>
                  <ul>{workspace.blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                </section>
              )}

              <section className="candidate-list-section">
                <div className="candidate-section-title">
                  <div><h4>建议学习的内容</h4><p>默认会加入路线；不确定时可查看原文，明显不需要的内容可以排除。</p></div>
                  <span>{pending.length} 项</span>
                </div>
                {pending.length ? <div className="candidate-card-list">{pending.map((concept) => (
                  <ConceptCard key={`${concept.id}:${concept.updatedAt}:${concept.status}:${concept.reviewedAt ?? ''}`} concept={concept} busy={busy} onWorkspace={setWorkspace} onNavigateSource={onNavigateSource} onMessage={onMessage} />
                ))}</div> : accepted.length ? (
                  <div className="candidate-success-state"><span aria-hidden="true">✓</span><strong>这批学习路线已经加入图谱</strong><p>可以返回图谱，从当前可学习的概念或“下一步建议”开始。</p></div>
                ) : ignored.length ? (
                  <div className="candidate-empty">所有建议都已排除。你可以在下方审核记录中重新加入，或返回资料重新生成。</div>
                ) : <div className="candidate-empty">还没有学习路线建议。请从资料正文选中文字，或使用“AI 生成学习路线”。</div>}
              </section>

              {pending.length > 0 && <section className="candidate-relations-section">
                <div className="candidate-section-title">
                  <div><h4>建议学习顺序</h4><p>AI 顺序必须同时给出原因和原文依据。你只需判断“这样学是否更容易理解”；不确定时移除即可，不影响概念本身。</p></div>
                  <span>{pendingRelationships.length} 条</span>
                </div>
                {pendingRelationships.length ? <ol className="candidate-relation-list">{pendingRelationships.map((relationship, index) => (
                  <li key={relationship.id} className={relationship.origin === 'AI' && (!relationship.reason.trim() || !relationship.evidenceQuote.trim()) ? 'needs-attention' : ''}>
                    <div className="candidate-relation-route">
                      <span className="candidate-relation-number">{index + 1}</span>
                      <span className="candidate-relation-step"><small>先学习</small><strong>{conceptById.get(relationship.sourceCandidateId)?.name}</strong></span>
                      <span className="candidate-relation-arrow" aria-hidden="true">→</span>
                      <span className="candidate-relation-step"><small>再学习</small><strong>{conceptById.get(relationship.targetCandidateId)?.name}</strong></span>
                      <button type="button" disabled={busy} onClick={() => void deleteRelationship(relationship.id)}>移除此顺序</button>
                    </div>
                    <div className="candidate-relation-explanation">
                      <span>{relationship.origin === 'AI' ? `AI 建议 · ${relationship.sourceModel ?? 'DeepSeek'}` : '由你添加'}</span>
                      <strong>为什么这样安排</strong>
                      <p>{relationship.reason || (relationship.origin === 'AI'
                        ? '这条旧版 AI 建议没有保存原因和依据，请移除后重新生成。'
                        : '这是你手动添加的学习顺序；应用已检查重复和循环。')}</p>
                    </div>
                    {relationship.evidenceQuote && <details className="candidate-relation-evidence">
                      <summary>核对关系依据 · {relationship.evidenceDocumentTitle} · {relationship.evidenceSourceLocator}</summary>
                      <blockquote>{relationship.evidenceQuote}</blockquote>
                    </details>}
                    {relationship.origin === 'AI' && (!relationship.reason.trim() || !relationship.evidenceQuote.trim()) && (
                      <p className="candidate-relation-warning" role="alert">缺少可核对依据，应用不会允许直接写入图谱。</p>
                    )}
                  </li>
                ))}</ol> : <div className="candidate-relation-empty">这批内容没有必须遵循的固定顺序，可以从任意可学习概念开始。</div>}

                <details className="candidate-relation-editor">
                  <summary>调整学习顺序（可选）</summary>
                  <p>只有在顺序明显不合适时才需要调整；应用会自动拒绝重复和循环路线。</p>
                  <div className="candidate-relation-builder">
                    <label>先学习
                      <select aria-label="先学习" value={effectiveSourceId} disabled={busy || pending.length < 2} onChange={(event) => setSourceId(event.target.value)}>
                        {pending.map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}
                      </select>
                    </label>
                    <span aria-hidden="true">然后</span>
                    <label>再学习
                      <select aria-label="再学习" value={effectiveTargetId} disabled={busy || pending.length < 2} onChange={(event) => setTargetId(event.target.value)}>
                        {pending.filter((concept) => concept.id !== effectiveSourceId).map((concept) => <option key={concept.id} value={concept.id}>{concept.name}</option>)}
                      </select>
                    </label>
                    <button type="button" disabled={busy || pending.length < 2 || !effectiveSourceId || !effectiveTargetId} onClick={() => void createRelationship()}>添加学习顺序</button>
                  </div>
                </details>
              </section>}

              {(history.length > 0 || relationshipHistory.length > 0) && <details className="candidate-history">
                <summary>已排除与已写入记录（{history.length} 项内容 · {relationshipHistory.length} 条顺序）</summary>
                {history.length > 0 && <div className="candidate-card-list">{history.map((concept) => (
                  <ConceptCard key={`${concept.id}:${concept.updatedAt}:${concept.status}:${concept.reviewedAt ?? ''}`} concept={concept} busy={busy} onWorkspace={setWorkspace} onNavigateSource={onNavigateSource} onMessage={onMessage} />
                ))}</div>}
                {relationshipHistory.length > 0 && <div className="candidate-relation-history">
                  <strong>学习顺序记录</strong>
                  <ol className="candidate-relation-list">{relationshipHistory.map((relationship) => (
                    <li key={relationship.id}>
                      <span><strong>{conceptById.get(relationship.sourceCandidateId)?.name}</strong> → <strong>{conceptById.get(relationship.targetCandidateId)?.name}</strong>{relationship.reason && <small>{relationship.reason}</small>}</span>
                      <em>{relationship.status === 'ACCEPTED' ? '已加入图谱' : '已排除'}</em>
                    </li>
                  ))}</ol>
                </div>}
              </details>}
            </div>
          ) : <div className="candidate-empty">学习路线预览暂时无法读取，请关闭后重试。</div>}
          <footer>
            <span>{workspace
              ? pending.length
                ? `准备向“${graph.name}”新增 ${pending.length} 项内容和 ${pendingRelationships.length} 条学习顺序`
                : '没有待加入内容；审核记录已保留'
              : '学习路线尚未加载'}</span>
            {workspace && !pending.length ? (
              <button className="primary-button" type="button" disabled={busy} onClick={onClose}>完成，返回图谱</button>
            ) : (
              <button
                className="primary-button"
                type="button"
                disabled={busy || !workspace?.pendingConceptCount || Boolean(workspace.blockingIssues.length)}
                onClick={() => setApplyConfirmation(true)}
              >
                {busy ? '处理中…' : `加入“${graph.name}”`}
              </button>
            )}
          </footer>
        </section>
      </div>
      {applyConfirmation && workspace && (
        <ConfirmDialog
          title={`将这条学习路线加入“${graph.name}”？`}
          description={applyDescription}
          confirmLabel="加入学习路线"
          onCancel={() => setApplyConfirmation(false)}
          onConfirm={() => void apply()}
        />
      )}
    </>
  );
}
