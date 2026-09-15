import { useCallback, useMemo, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow,
  applyEdgeChanges,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from '@xyflow/react';
import type { KnowledgeGraphDocument } from '../../../shared/contracts';
import { wouldCreateDirectedCycle } from '../../../shared/graphRules';
import { ConceptNode, type ConceptNodeData } from '../../components/ConceptNode';
import { STATUS_LABELS } from '../../learningLabels';
import { applyPersistentNodeChanges } from './graphChanges';

interface GraphCanvasProps {
  graph: KnowledgeGraphDocument;
  selectedNodeId: string | null;
  onSelectedNodeIdChange: (id: string | null) => void;
  onGraphChange: (graph: KnowledgeGraphDocument) => void;
  onAddNode: () => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
  readOnly: boolean;
}
const nodeTypes = { concept: ConceptNode };

export function GraphCanvas({ graph, selectedNodeId, onSelectedNodeIdChange, onGraphChange, onAddNode, onMessage, readOnly }: GraphCanvasProps): React.JSX.Element {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const nodes = useMemo<Node<ConceptNodeData>[]>(() => graph.nodes.map((node) => ({
    id: node.id, type: 'concept', position: node.position, selected: node.id === selectedNodeId,
    initialWidth: 172, initialHeight: 56, deletable: false,
    ariaLabel: `${node.name}，状态：${STATUS_LABELS[node.status]}`,
    data: { name: node.name, status: node.status },
  })), [graph.nodes, selectedNodeId]);
  const edges = useMemo<Edge[]>(() => {
    const nodeNames = new Map(graph.nodes.map((node) => [node.id, node.name]));
    return graph.edges.map((edge) => ({
      id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId,
      selected: edge.id === selectedEdgeId,
      deletable: !readOnly,
      ariaLabel: `${nodeNames.get(edge.sourceNodeId) ?? '概念'} 是 ${nodeNames.get(edge.targetNodeId) ?? '概念'} 的先修概念`,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#708090' },
      style: { stroke: '#708090', strokeWidth: 2 },
    }));
  }, [graph.edges, graph.nodes, readOnly, selectedEdgeId]);

  const onNodesChange = useCallback((changes: NodeChange<Node<ConceptNodeData>>[]) => {
    if (readOnly) return;
    const changedGraph = applyPersistentNodeChanges(graph, nodes, changes);
    if (changedGraph) onGraphChange(changedGraph);
  }, [graph, nodes, onGraphChange, readOnly]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    if (readOnly) return;
    const removals = changes.filter((change) => change.type === 'remove');
    if (removals.length === 0) return;
    const remaining = new Set(applyEdgeChanges(removals, edges).map((edge) => edge.id));
    onGraphChange({ ...graph, edges: graph.edges.filter((edge) => remaining.has(edge.id)) });
  }, [edges, graph, onGraphChange, readOnly]);

  const onConnect = useCallback((connection: Connection) => {
    if (readOnly) return;
    const source = connection.source;
    const target = connection.target;
    if (!source || !target) return;
    if (source === target) { onMessage('不能把概念设为自己的先修条件。', 'error'); return; }
    if (graph.edges.some((edge) => edge.sourceNodeId === source && edge.targetNodeId === target)) {
      onMessage('这条先修关系已经存在。', 'error'); return;
    }
    if (wouldCreateDirectedCycle(graph.edges, source, target)) {
      onMessage('这条关系会形成循环。先修概念必须保持明确的学习顺序。', 'error'); return;
    }
    onGraphChange({ ...graph, edges: [...graph.edges, {
      id: crypto.randomUUID(), graphId: graph.id, sourceNodeId: source,
      targetNodeId: target, relationship: 'PREREQUISITE',
    }] });
    onMessage('已添加先修关系，保存后写入本地数据库。', 'success');
  }, [graph, onGraphChange, onMessage, readOnly]);

  const deleteSelectedEdge = (): void => {
    if (!selectedEdgeId || readOnly) return;
    onGraphChange({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selectedEdgeId) });
    setSelectedEdgeId(null);
    onMessage('已删除先修关系，保存后生效。', 'success');
  };

  return (
    <section className="graph-stage" aria-label="知识图谱画布">
      {graph.nodes.length === 0 ? (
        <div className="graph-empty-state">
          <div className="graph-empty-icon" aria-hidden="true">＋</div>
          <h2>从第一个概念开始</h2>
          <p>添加你想学习的知识点，再用箭头整理它们的先修顺序。</p>
          <button className="primary-button" type="button" disabled={readOnly} onClick={onAddNode}>添加第一个概念</button>
        </div>
      ) : (
        <div className="graph-help">
          从节点右侧拖到另一节点左侧，以创建“先修于”关系
          {selectedEdgeId && <button className="danger-link" type="button" disabled={readOnly} onClick={deleteSelectedEdge}>删除选中的关系</button>}
        </div>
      )}
      <ReactFlow
        key={graph.id} nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        onNodeClick={(_event, node) => { onSelectedNodeIdChange(node.id); setSelectedEdgeId(null); }}
        onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); onSelectedNodeIdChange(null); }}
        onPaneClick={() => { onSelectedNodeIdChange(null); setSelectedEdgeId(null); }}
        nodesDraggable={!readOnly} nodesConnectable={!readOnly} edgesReconnectable={false}
        elementsSelectable={!readOnly}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']} fitView fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
        minZoom={0.2} maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#c8d0d8" />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => ({
            LOCKED: '#87908e',
            AVAILABLE: '#4f7f73',
            LEARNING: '#367aaf',
            MASTERED: '#2d8a5f',
            REVIEW_DUE: '#c17b30',
          })[(node.data as ConceptNodeData).status]}
          maskColor="rgba(240, 243, 246, 0.72)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
