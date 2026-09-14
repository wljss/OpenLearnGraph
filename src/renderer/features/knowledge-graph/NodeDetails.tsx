import type { KnowledgeGraphDocument, KnowledgeNodeView } from '../../../shared/contracts';

interface NodeDetailsProps {
  graph: KnowledgeGraphDocument; node: KnowledgeNodeView | null;
  onUpdate: (node: KnowledgeNodeView) => void; onDelete: (nodeId: string) => void;
}
const statusLabels = {
  LOCKED: '已锁定', AVAILABLE: '可学习', LEARNING: '学习中', MASTERED: '已掌握', REVIEW_DUE: '待复习',
} as const;

export function NodeDetails({ graph, node, onUpdate, onDelete }: NodeDetailsProps): React.JSX.Element {
  if (!node) return (
    <aside className="details-panel empty-details">
      <div className="empty-icon">◇</div><h2>选择一个概念</h2><p>查看和编辑概念详情、先修条件与学习状态。</p>
    </aside>
  );
  const prerequisites = graph.edges.filter((edge) => edge.targetNodeId === node.id)
    .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.sourceNodeId))
    .filter((candidate): candidate is KnowledgeNodeView => Boolean(candidate));
  return (
    <aside className="details-panel">
      <div className="panel-kicker">概念详情</div>
      <label>名称<input value={node.name} maxLength={160} onChange={(event) => onUpdate({ ...node, name: event.target.value })} /></label>
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
      <div className="future-card"><span>后续能力</span><p>掌握度、证据、来源引用与导师建议将在后续里程碑中显示于此。</p></div>
      <button className="danger-button" type="button" onClick={() => onDelete(node.id)}>删除概念</button>
    </aside>
  );
}
