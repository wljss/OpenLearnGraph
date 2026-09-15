import { useEffect, useRef } from 'react';
import type { KnowledgeGraphDocument, KnowledgeNodeView } from '../../../shared/contracts';

interface NodeDetailsProps {
  graph: KnowledgeGraphDocument | null; node: KnowledgeNodeView | null;
  focusNodeNameId: string | null; onAddNode: () => void;
  onUpdate: (node: KnowledgeNodeView) => void; onDelete: (nodeId: string) => void;
}
const statusLabels = {
  LOCKED: '已锁定', AVAILABLE: '可学习', LEARNING: '学习中', MASTERED: '已掌握', REVIEW_DUE: '待复习',
} as const;

export function NodeDetails({ graph, node, focusNodeNameId, onAddNode, onUpdate, onDelete }: NodeDetailsProps): React.JSX.Element {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const lastFocusedNodeId = useRef<string | null>(null);

  useEffect(() => {
    if (!node || node.id !== focusNodeNameId || lastFocusedNodeId.current === node.id) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
    lastFocusedNodeId.current = node.id;
  }, [focusNodeNameId, node]);

  if (!graph) return (
    <aside className="details-panel empty-details">
      <div className="empty-icon">◇</div>
      <h2>先创建知识图谱</h2>
      <p>创建图谱后，就可以在这里整理概念详情。</p>
    </aside>
  );
  if (!node) return (
    <aside className="details-panel empty-details">
      <div className="empty-icon">◇</div>
      <h2>{graph.nodes.length ? '选择一个概念' : '还没有概念'}</h2>
      <p>{graph.nodes.length ? '查看和编辑概念详情、先修条件与学习状态。' : '添加知识点后，可以在这里填写名称和描述。'}</p>
      {!graph.nodes.length && <button className="secondary-button details-empty-action" type="button" onClick={onAddNode}>添加第一个概念</button>}
    </aside>
  );
  const prerequisites = graph.edges.filter((edge) => edge.targetNodeId === node.id)
    .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.sourceNodeId))
    .filter((candidate): candidate is KnowledgeNodeView => Boolean(candidate));
  const dependents = graph.edges.filter((edge) => edge.sourceNodeId === node.id)
    .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.targetNodeId))
    .filter((candidate): candidate is KnowledgeNodeView => Boolean(candidate));
  const connectedEdgeCount = prerequisites.length + dependents.length;
  return (
    <aside className="details-panel">
      <div className="panel-kicker">概念详情</div>
      <label>
        名称
        <input
          ref={nameInputRef}
          className={!node.name.trim() ? 'input-invalid' : undefined}
          aria-invalid={!node.name.trim()}
          value={node.name}
          maxLength={160}
          onChange={(event) => onUpdate({ ...node, name: event.target.value })}
        />
        {!node.name.trim() && <span className="validation-hint">概念名称不能为空，保存前请填写。</span>}
      </label>
      <label>描述<textarea value={node.description} rows={8} maxLength={10_000} placeholder="说明这个概念是什么，以及学习它的意义……" onChange={(event) => onUpdate({ ...node, description: event.target.value })} /></label>
      <div className="detail-section">
        <span className="field-label">状态</span>
        <div className="status-badge"><span className="status-dot" />{statusLabels[node.status]}</div>
        <p className="field-hint">M1 中新概念默认可学习；掌握度与证据将在 M2 引入。</p>
      </div>
      <div className="detail-section">
        <span className="field-label">先修概念</span>
        {prerequisites.length ? <ul className="prerequisite-list">{prerequisites.map((item) => <li key={item.id}>{item.name}</li>)}</ul> : <p className="field-hint">暂无先修概念</p>}
      </div>
      <div className="detail-section">
        <span className="field-label">后续概念</span>
        {dependents.length ? <ul className="prerequisite-list">{dependents.map((item) => <li key={item.id}>{item.name}</li>)}</ul> : <p className="field-hint">暂无后续概念</p>}
      </div>
      <div className="future-card"><span>后续能力</span><p>掌握度、证据、来源引用与导师建议将在后续里程碑中显示于此。</p></div>
      <button className="danger-button" type="button" onClick={() => onDelete(node.id)}>
        删除概念{connectedEdgeCount ? `及 ${connectedEdgeCount} 条关系` : ''}
      </button>
    </aside>
  );
}
