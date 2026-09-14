import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { NodeStatus } from '../../shared/contracts';

export interface ConceptNodeData extends Record<string, unknown> { name: string; status: NodeStatus }
const STATUS_LABELS: Record<NodeStatus, string> = {
  LOCKED: '已锁定', AVAILABLE: '可学习', LEARNING: '学习中', MASTERED: '已掌握', REVIEW_DUE: '待复习',
};

export function ConceptNode({ data, selected }: NodeProps): React.JSX.Element {
  const nodeData = data as ConceptNodeData;
  return (
    <div className={`concept-node status-${nodeData.status.toLowerCase()} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="concept-title">{nodeData.name}</div>
      <div className="status-line"><span className="status-dot" />{STATUS_LABELS[nodeData.status]}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
