// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { KnowledgeGraphDocument, KnowledgeNodeView } from '../src/shared/contracts';
import { planNextLearningAction } from '../src/shared/tutorPlanner';

const graphId = '11111111-1111-4111-8111-111111111111';

function node(id: string, name: string, overrides: Partial<KnowledgeNodeView> = {}): KnowledgeNodeView {
  return {
    id,
    graphId,
    name,
    description: '',
    position: { x: 0, y: 0 },
    status: 'AVAILABLE',
    learningPhase: 'NOT_STARTED',
    statusReason: '可以开始学习。',
    evidenceCount: 0,
    lastEvidenceAt: null,
    latestEvidenceKind: null,
    mostRecentEvidenceKind: null,
    latestEvidenceScoreEarned: null,
    latestEvidenceScorePossible: null,
    diagnosticQuestionCount: 0,
    practiceQuestionCount: 0,
    ...overrides,
  };
}

function graph(nodes: KnowledgeNodeView[]): KnowledgeGraphDocument {
  return {
    id: graphId,
    name: '测试图谱',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    nodes,
    edges: [],
  };
}

describe('deterministic tutor planner', () => {
  it('does not invent a recommendation for an empty graph or a locked concept', () => {
    expect(planNextLearningAction(graph([]))).toBeNull();
    expect(planNextLearningAction(graph([
      node('22222222-2222-4222-8222-222222222222', '锁定概念', { status: 'LOCKED' }),
    ]))).toBeNull();
  });

  it('prioritizes objective remediation and exposes the supporting score', () => {
    const result = planNextLearningAction(graph([
      node('22222222-2222-4222-8222-222222222222', '薄弱概念', {
        status: 'LEARNING',
        learningPhase: 'LEARNING',
        latestEvidenceKind: 'DIAGNOSTIC_RESULT',
        latestEvidenceScoreEarned: 1,
        latestEvidenceScorePossible: 2,
        practiceQuestionCount: 1,
      }),
    ]));
    expect(result).toMatchObject({ action: 'REMEDIATE', reasonCode: 'REMEDIATE_FAILED_DIAGNOSTIC' });
    expect(result?.evidence[0]).toContain('1/2');
  });

  it('recommends assessment when coverage exists and review after the graph is mastered', () => {
    expect(planNextLearningAction(graph([
      node('22222222-2222-4222-8222-222222222222', '待诊断', { diagnosticQuestionCount: 2 }),
    ]))).toMatchObject({ action: 'ASSESS', reasonCode: 'ASSESS_WITH_QUESTION_BANK' });

    expect(planNextLearningAction(graph([
      node('22222222-2222-4222-8222-222222222222', '已掌握', {
        status: 'MASTERED',
        learningPhase: 'MASTERED',
        evidenceCount: 1,
        practiceQuestionCount: 1,
      }),
    ]))).toMatchObject({ action: 'REVIEW', reasonCode: 'REVIEW_COMPLETE_GRAPH' });
  });

  it('resumes an active diagnostic without targeting a newly locked node', () => {
    const lockedId = '22222222-2222-4222-8222-222222222222';
    const attemptId = '33333333-3333-4333-8333-333333333333';
    expect(planNextLearningAction(graph([node(lockedId, '已锁定', { status: 'LOCKED' })]), {
      attemptId,
      targetNodeId: lockedId,
    })).toMatchObject({
      action: 'ASSESS',
      targetNodeId: null,
      context: { attemptId },
    });
  });

  it('resumes a persisted learning session before planning a new action', () => {
    const nodeId = '22222222-2222-4222-8222-222222222222';
    const sessionId = '44444444-4444-4444-8444-444444444444';
    expect(planNextLearningAction(
      graph([node(nodeId, '基础概念')]),
      null,
      { sessionId, targetNodeId: nodeId, targetNodeName: '基础概念', action: 'TEACH' },
    )).toMatchObject({
      action: 'TEACH',
      reasonCode: 'RESUME_LEARNING_SESSION',
      context: { sessionId },
    });
  });

  it('resumes a persisted practice before planning a new action', () => {
    const nodeId = '22222222-2222-4222-8222-222222222222';
    const attemptId = '55555555-5555-4555-8555-555555555555';
    expect(planNextLearningAction(
      graph([node(nodeId, '基础概念', { practiceQuestionCount: 1 })]),
      null,
      null,
      { attemptId, targetNodeId: nodeId, targetNodeName: '基础概念', mode: 'PRACTICE' },
    )).toMatchObject({
      action: 'PRACTICE',
      reasonCode: 'RESUME_PRACTICE',
      context: { practiceAttemptId: attemptId },
    });
  });

  it('explains that completed formative practice should be followed by objective diagnosis', () => {
    const result = planNextLearningAction(graph([
      node('22222222-2222-4222-8222-222222222222', '已练习概念', {
        status: 'LEARNING',
        learningPhase: 'LEARNING',
        latestEvidenceKind: 'PRACTICE_RESULT',
        mostRecentEvidenceKind: 'PRACTICE_RESULT',
        diagnosticQuestionCount: 2,
        practiceQuestionCount: 2,
      }),
    ]));
    expect(result).toMatchObject({ action: 'ASSESS', reasonCode: 'ASSESS_WITH_QUESTION_BANK' });
    expect(result?.reason).toContain('完成形成性练习');
    expect(result?.evidence[0]).toContain('形成性练习');
  });
});
