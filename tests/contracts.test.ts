// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { recordLearningEvidenceInputSchema, saveGraphInputSchema } from '../src/shared/contracts';

const graphId = '11111111-1111-4111-8111-111111111111';
const firstNodeId = '22222222-2222-4222-8222-222222222222';
const secondNodeId = '33333333-3333-4333-8333-333333333333';
function validGraph() {
  return {
    id: graphId, name: '线性代数',
    nodes: [
      { id: firstNodeId, name: '向量', description: '', position: { x: 0, y: 0 } },
      { id: secondNodeId, name: '矩阵', description: '', position: { x: 200, y: 0 } },
    ],
    edges: [{ id: '44444444-4444-4444-8444-444444444444', sourceNodeId: firstNodeId, targetNodeId: secondNodeId, relationship: 'PREREQUISITE' as const }],
  };
}
describe('saveGraphInputSchema', () => {
  it('accepts a valid graph', () => expect(saveGraphInputSchema.safeParse(validGraph()).success).toBe(true));
  it('rejects blank names', () => {
    const graph = validGraph(); graph.nodes[0].name = '   ';
    expect(saveGraphInputSchema.safeParse(graph).success).toBe(false);
  });
  it('rejects self, duplicate and dangling prerequisite edges', () => {
    const self = validGraph(); self.edges[0].targetNodeId = firstNodeId;
    expect(saveGraphInputSchema.safeParse(self).success).toBe(false);
    const duplicate = validGraph(); duplicate.edges.push({ ...duplicate.edges[0], id: '55555555-5555-4555-8555-555555555555' });
    expect(saveGraphInputSchema.safeParse(duplicate).success).toBe(false);
    const dangling = validGraph(); dangling.edges[0].targetNodeId = '66666666-6666-4666-8666-666666666666';
    expect(saveGraphInputSchema.safeParse(dangling).success).toBe(false);
  });
  it('rejects prerequisite cycles', () => {
    const cyclic = validGraph();
    cyclic.edges.push({
      id: '55555555-5555-4555-8555-555555555555',
      sourceNodeId: secondNodeId,
      targetNodeId: firstNodeId,
      relationship: 'PREREQUISITE',
    });
    const result = saveGraphInputSchema.safeParse(cyclic);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.message.includes('循环'))).toBe(true);
  });
});

describe('recordLearningEvidenceInputSchema', () => {
  it('accepts study starts and bounded self assessments', () => {
    expect(recordLearningEvidenceInputSchema.safeParse({ nodeId: firstNodeId, kind: 'STUDY_STARTED' }).success).toBe(true);
    expect(recordLearningEvidenceInputSchema.safeParse({
      nodeId: firstNodeId, kind: 'SELF_ASSESSMENT', rating: 4, note: '可以独立完成',
    }).success).toBe(true);
  });

  it('rejects out-of-range ratings and oversized notes', () => {
    expect(recordLearningEvidenceInputSchema.safeParse({
      nodeId: firstNodeId, kind: 'SELF_ASSESSMENT', rating: 6, note: '',
    }).success).toBe(false);
    expect(recordLearningEvidenceInputSchema.safeParse({
      nodeId: firstNodeId, kind: 'SELF_ASSESSMENT', rating: 3, note: 'x'.repeat(2_001),
    }).success).toBe(false);
  });
});
