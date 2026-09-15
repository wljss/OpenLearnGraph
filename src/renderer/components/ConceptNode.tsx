import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { NodeStatus } from '../../shared/contracts';
import { STATUS_LABELS } from '../learningLabels';

export interface ConceptNodeData extends Record<string, unknown> { name: string; status: NodeStatus }

export function ConceptNode({ data, selected }: NodeProps): React.JSX.Element {
  const nodeData = data as ConceptNodeData;
  return (
    <div className={`concept-node status-${nodeData.status.toLowerCase()} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} aria-label="连接先修概念" />
      <div className="concept-title" title={nodeData.name}>{nodeData.name}</div>
      <div className="status-line"><span className="status-dot" />{STATUS_LABELS[nodeData.status]}</div>
      <Handle type="source" position={Position.Right} aria-label="连接后续概念" />
    </div>
  );
}
