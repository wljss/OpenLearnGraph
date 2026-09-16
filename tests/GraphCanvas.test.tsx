import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraphDocument } from '../src/shared/contracts';
import { GraphCanvas } from '../src/renderer/features/knowledge-graph/GraphCanvas';
import { applyPersistentNodeChanges, type ConceptFlowNode } from '../src/renderer/features/knowledge-graph/graphChanges';

const graph: KnowledgeGraphDocument = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '测试图谱',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  nodes: [{
    id: '22222222-2222-4222-8222-222222222222',
    graphId: '11111111-1111-4111-8111-111111111111',
    name: '可见概念',
    description: '',
    position: { x: 120, y: 120 },
    status: 'AVAILABLE',
    learningPhase: 'NOT_STARTED',
    statusReason: '没有未完成的先修概念，可以开始学习。',
    evidenceCount: 0,
    lastEvidenceAt: null,
  latestEvidenceKind: null,
  mostRecentEvidenceKind: null,
    latestEvidenceScoreEarned: null,
    latestEvidenceScorePossible: null,
  diagnosticQuestionCount: 0,
  practiceQuestionCount: 0,
  }],
  edges: [],
};

const flowNodes: ConceptFlowNode[] = graph.nodes.map((node) => ({
  id: node.id,
  type: 'concept',
  position: node.position,
  data: { name: node.name, status: node.status },
}));

describe('GraphCanvas', () => {
  it('renders a supplied concept as visible before ResizeObserver measurement', () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <GraphCanvas
          graph={graph}
          selectedNodeId={null}
          onSelectedNodeIdChange={vi.fn()}
          onGraphChange={vi.fn()}
          onAddNode={vi.fn()}
          onMessage={vi.fn()}
          readOnly={false}
        />
      </div>,
    );

    expect(screen.getByText('可见概念')).toBeVisible();
    expect(screen.getByTestId(`rf__node-${graph.nodes[0].id}`)).toHaveStyle({ visibility: 'visible' });
  });

  it('offers a direct action when the graph has no concepts', () => {
    const onAddNode = vi.fn();
    render(
      <div style={{ width: 800, height: 600 }}>
        <GraphCanvas
          graph={{ ...graph, nodes: [] }}
          selectedNodeId={null}
          onSelectedNodeIdChange={vi.fn()}
          onGraphChange={vi.fn()}
          onAddNode={onAddNode}
          onMessage={vi.fn()}
          readOnly={false}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加第一个概念' }));
    expect(onAddNode).toHaveBeenCalledOnce();
  });

  it('ignores transient dimension changes instead of rebuilding domain nodes', () => {
    const result = applyPersistentNodeChanges(graph, flowNodes, [{
      id: flowNodes[0].id,
      type: 'dimensions',
      dimensions: { width: 172, height: 56 },
      setAttributes: true,
    }]);
    expect(result).toBeNull();
  });

  it('persists position changes', () => {
    const result = applyPersistentNodeChanges(graph, flowNodes, [{
      id: flowNodes[0].id,
      type: 'position',
      position: { x: 300, y: 240 },
    }]);
    expect(result?.nodes[0].position).toEqual({ x: 300, y: 240 });
  });
});
