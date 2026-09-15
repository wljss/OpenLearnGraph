// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hasDirectedCycle, wouldCreateDirectedCycle } from '../src/shared/graphRules';
import { projectLearningStatuses } from '../src/shared/learningProjection';

describe('learning status projection', () => {
  const nodes = [
    { id: 'a', name: '基础', learningPhase: 'NOT_STARTED' as const },
    { id: 'b', name: '进阶', learningPhase: 'NOT_STARTED' as const },
  ];
  const edges = [{ sourceNodeId: 'a', targetNodeId: 'b' }];

  it('locks unmet dependents and explains the prerequisite', () => {
    const result = projectLearningStatuses(nodes, edges);
    expect(result.get('a')).toMatchObject({ status: 'AVAILABLE' });
    expect(result.get('b')).toEqual({ status: 'LOCKED', statusReason: '还需掌握：基础。' });
  });

  it('unlocks dependents when prerequisites are mastered', () => {
    const result = projectLearningStatuses([{ ...nodes[0], learningPhase: 'MASTERED' }, nodes[1]], edges);
    expect(result.get('a')?.status).toBe('MASTERED');
    expect(result.get('b')?.status).toBe('AVAILABLE');
  });

  it('keeps non-mastered learning evidence locked behind unmet prerequisites', () => {
    const result = projectLearningStatuses([nodes[0], { ...nodes[1], learningPhase: 'LEARNING' }], edges);
    expect(result.get('b')).toEqual({ status: 'LOCKED', statusReason: '还需掌握：基础。' });
  });
});

describe('directed graph rules', () => {
  it('detects both existing and proposed cycles', () => {
    const edges = [{ sourceNodeId: 'a', targetNodeId: 'b' }];
    expect(hasDirectedCycle(edges)).toBe(false);
    expect(wouldCreateDirectedCycle(edges, 'b', 'a')).toBe(true);
  });
});
