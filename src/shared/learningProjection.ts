import type { KnowledgeEdgeView, KnowledgeGraphDocument, LearningPhase, NodeStatus } from './contracts';

interface LearningProjectionNode {
  id: string;
  name: string;
  learningPhase: LearningPhase;
}

export interface LearningStatusProjection {
  status: NodeStatus;
  statusReason: string;
}

export function projectLearningStatuses(
  nodes: LearningProjectionNode[],
  edges: Pick<KnowledgeEdgeView, 'sourceNodeId' | 'targetNodeId'>[],
): Map<string, LearningStatusProjection> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const prerequisitesByNode = new Map<string, LearningProjectionNode[]>();
  for (const edge of edges) {
    const prerequisite = nodesById.get(edge.sourceNodeId);
    if (!prerequisite || !nodesById.has(edge.targetNodeId)) continue;
    const prerequisites = prerequisitesByNode.get(edge.targetNodeId) ?? [];
    prerequisites.push(prerequisite);
    prerequisitesByNode.set(edge.targetNodeId, prerequisites);
  }

  const result = new Map<string, LearningStatusProjection>();
  for (const node of nodes) {
    if (node.learningPhase === 'MASTERED') {
      result.set(node.id, {
        status: 'MASTERED',
        statusReason: '最近一次自评表明你已能独立运用这个概念。',
      });
      continue;
    }

    const prerequisites = prerequisitesByNode.get(node.id) ?? [];
    const unmet = prerequisites.filter((item) => item.learningPhase !== 'MASTERED');
    if (unmet.length) {
      result.set(node.id, {
        status: 'LOCKED',
        statusReason: `还需掌握：${unmet.map((item) => item.name).join('、')}。`,
      });
      continue;
    }
    if (node.learningPhase === 'LEARNING') {
      result.set(node.id, {
        status: 'LEARNING',
        statusReason: '你已经开始学习；继续记录练习或自评证据。',
      });
      continue;
    }
    result.set(node.id, {
      status: 'AVAILABLE',
      statusReason: prerequisites.length
        ? '所有先修概念均已掌握，可以开始学习。'
        : '没有未完成的先修概念，可以开始学习。',
    });
  }
  return result;
}

export function projectGraphLearning(graph: KnowledgeGraphDocument): KnowledgeGraphDocument {
  const projection = projectLearningStatuses(graph.nodes, graph.edges);
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      ...projection.get(node.id),
    })),
  };
}
