import { useCallback, useMemo, useState } from 'react';
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow,
  applyEdgeChanges,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from '@xyflow/react';
import type { KnowledgeGraphDocument } from '../../../shared/contracts';
import { ConceptNode, type ConceptNodeData } from '../../components/ConceptNode';
import { applyPersistentNodeChanges } from './graphChanges';

interface GraphCanvasProps {
  graph: KnowledgeGraphDocument;
  selectedNodeId: string | null;
  onSelectedNodeIdChange: (id: string | null) => void;
  onGraphChange: (graph: KnowledgeGraphDocument) => void;
  onMessage: (message: string) => void;
}
const nodeTypes = { concept: ConceptNode };

export function GraphCanvas({ graph, selectedNodeId, onSelectedNodeIdChange, onGraphChange, onMessage }: GraphCanvasProps): React.JSX.Element {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const nodes = useMemo<Node<ConceptNodeData>[]>(() => graph.nodes.map((node) => ({
    id: node.id, type: 'concept', position: node.position, selected: node.id === selectedNodeId,
    initialWidth: 172, initialHeight: 56,
    data: { name: node.name, status: node.status },
  })), [graph.nodes, selectedNodeId]);
  const edges = useMemo<Edge[]>(() => graph.edges.map((edge) => ({
    id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId,
    selected: edge.id === selectedEdgeId,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#708090' },
    style: { stroke: '#708090', strokeWidth: 2 },
  })), [graph.edges, selectedEdgeId]);

  const onNodesChange = useCallback((changes: NodeChange<Node<ConceptNodeData>>[]) => {
    const changedGraph = applyPersistentNodeChanges(graph, nodes, changes);
    if (changedGraph) onGraphChange(changedGraph);
  }, [graph, nodes, onGraphChange]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    const removals = changes.filter((change) => change.type === 'remove');
    if (removals.length === 0) return;
    const remaining = new Set(applyEdgeChanges(removals, edges).map((edge) => edge.id));
    onGraphChange({ ...graph, edges: graph.edges.filter((edge) => remaining.has(edge.id)) });
  }, [edges, graph, onGraphChange]);

  const onConnect = useCallback((connection: Connection) => {
    const source = connection.source;
    const target = connection.target;
    if (!source || !target) return;
    if (source === target) { onMessage('不能把概念设为自己的先修条件。'); return; }
    if (graph.edges.some((edge) => edge.sourceNodeId === source && edge.targetNodeId === target)) {
      onMessage('这条先修关系已经存在。'); return;
    }
    onGraphChange({ ...graph, edges: [...graph.edges, {
      id: crypto.randomUUID(), graphId: graph.id, sourceNodeId: source,
      targetNodeId: target, relationship: 'PREREQUISITE',
    }] });
    onMessage('已添加先修关系，保存后写入本地数据库。');
  }, [graph, onGraphChange, onMessage]);

  const deleteSelectedEdge = (): void => {
    if (!selectedEdgeId) return;
    onGraphChange({ ...graph, edges: graph.edges.filter((edge) => edge.id !== selectedEdgeId) });
    setSelectedEdgeId(null);
    onMessage('已删除先修关系，保存后生效。');
  };

  return (
    <section className="graph-stage" aria-label="知识图谱画布">
      <div className="graph-help">
        从节点右侧拖到另一节点左侧，以创建“先修于”关系
        {selectedEdgeId && <button className="danger-link" type="button" onClick={deleteSelectedEdge}>删除选中的关系</button>}
      </div>
      <ReactFlow
        key={graph.id} nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
        onNodeClick={(_event, node) => { onSelectedNodeIdChange(node.id); setSelectedEdgeId(null); }}
        onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); onSelectedNodeIdChange(null); }}
        onPaneClick={() => { onSelectedNodeIdChange(null); setSelectedEdgeId(null); }}
        deleteKeyCode={['Backspace', 'Delete']} fitView fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
        minZoom={0.2} maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#c8d0d8" />
        <MiniMap pannable zoomable nodeColor="#4f7f73" maskColor="rgba(240, 243, 246, 0.72)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
