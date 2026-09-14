import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react';
import type { KnowledgeGraphDocument } from '../../../shared/contracts';
import type { ConceptNodeData } from '../../components/ConceptNode';

export type ConceptFlowNode = Node<ConceptNodeData>;

/**
 * React Flow also emits transient dimensions and selection changes. Those belong
 * to its internal store and must not rebuild our domain nodes, or measurements
 * are discarded and custom nodes remain hidden.
 */
export function applyPersistentNodeChanges(
  graph: KnowledgeGraphDocument,
  flowNodes: ConceptFlowNode[],
  changes: NodeChange<ConceptFlowNode>[],
): KnowledgeGraphDocument | null {
  const persistentChanges = changes.filter(
    (change) => change.type === 'position' || change.type === 'remove',
  );
  if (persistentChanges.length === 0) return null;

  const changedNodes = applyNodeChanges(persistentChanges, flowNodes);
  const changedById = new Map(changedNodes.map((node) => [node.id, node]));
  const remainingIds = new Set(changedById.keys());

  return {
    ...graph,
    nodes: graph.nodes
      .filter((node) => remainingIds.has(node.id))
      .map((node) => ({
        ...node,
        position: changedById.get(node.id)?.position ?? node.position,
      })),
    edges: graph.edges.filter(
      (edge) => remainingIds.has(edge.sourceNodeId) && remainingIds.has(edge.targetNodeId),
    ),
  };
}
