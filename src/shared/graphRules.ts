interface DirectedEdge {
  sourceNodeId: string;
  targetNodeId: string;
}

export function hasDirectedCycle(edges: DirectedEdge[]): boolean {
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.sourceNodeId) ?? [];
    targets.push(edge.targetNodeId);
    outgoing.set(edge.sourceNodeId, targets);
    indegree.set(edge.sourceNodeId, indegree.get(edge.sourceNodeId) ?? 0);
    indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) ?? 0) + 1);
  }

  const ready = Array.from(indegree.entries())
    .filter(([, count]) => count === 0)
    .map(([nodeId]) => nodeId);
  let visitedCount = 0;
  while (ready.length) {
    const nodeId = ready.pop() as string;
    visitedCount += 1;
    for (const targetId of outgoing.get(nodeId) ?? []) {
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) ready.push(targetId);
    }
  }

  return visitedCount !== indegree.size;
}

export function wouldCreateDirectedCycle(
  edges: DirectedEdge[],
  sourceNodeId: string,
  targetNodeId: string,
): boolean {
  return hasDirectedCycle([...edges, { sourceNodeId, targetNodeId }]);
}
