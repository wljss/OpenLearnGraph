import { describe, expect, it } from 'vitest';
import type { KnowledgeNodeView } from '../src/shared/contracts';
import { graphProgressPercent, summarizeGraphProgress } from '../src/shared/graphProgress';

function node(overrides: Partial<KnowledgeNodeView>): KnowledgeNodeView {
  return {
    id: crypto.randomUUID(),
    graphId: '11111111-1111-4111-8111-111111111111',
    name: '概念',
    description: '',
    position: { x: 0, y: 0 },
    status: 'AVAILABLE',
    learningPhase: 'NOT_STARTED',
    statusReason: '',
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

describe('graph progress summary', () => {
  it('separates objective mastery, self-assessed mastery, and diagnostic readiness', () => {
    const progress = summarizeGraphProgress([
      node({ status: 'MASTERED', learningPhase: 'MASTERED', latestEvidenceKind: 'DIAGNOSTIC_RESULT', diagnosticQuestionCount: 2 }),
      node({ status: 'MASTERED', learningPhase: 'MASTERED', latestEvidenceKind: 'SELF_ASSESSMENT' }),
      node({ status: 'LEARNING', learningPhase: 'LEARNING', latestEvidenceKind: 'PRACTICE_RESULT', diagnosticQuestionCount: 3 }),
      node({ status: 'AVAILABLE' }),
      node({ status: 'LOCKED' }),
    ]);

    expect(progress).toEqual({
      totalConceptCount: 5,
      masteredCount: 2,
      objectivelyMasteredCount: 1,
      selfAssessedMasteredCount: 1,
      learningCount: 1,
      availableCount: 1,
      lockedCount: 1,
      reviewDueCount: 0,
      diagnosticReadyCount: 2,
    });
    expect(graphProgressPercent(progress)).toBe(40);
  });

  it('does not turn practice evidence or question coverage into mastery progress', () => {
    const progress = summarizeGraphProgress([
      node({ status: 'LEARNING', learningPhase: 'LEARNING', latestEvidenceKind: 'PRACTICE_RESULT', diagnosticQuestionCount: 4 }),
    ]);

    expect(progress.masteredCount).toBe(0);
    expect(progress.diagnosticReadyCount).toBe(1);
    expect(graphProgressPercent(progress)).toBe(0);
  });
});
