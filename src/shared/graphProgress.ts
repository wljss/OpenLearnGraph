import type { GraphProgressSummary, KnowledgeNodeView } from './contracts';

type ProgressNode = Pick<
  KnowledgeNodeView,
  'status' | 'latestEvidenceKind' | 'diagnosticQuestionCount'
>;

export function summarizeGraphProgress(nodes: ProgressNode[]): GraphProgressSummary {
  const summary: GraphProgressSummary = {
    totalConceptCount: nodes.length,
    masteredCount: 0,
    objectivelyMasteredCount: 0,
    selfAssessedMasteredCount: 0,
    learningCount: 0,
    availableCount: 0,
    lockedCount: 0,
    reviewDueCount: 0,
    diagnosticReadyCount: 0,
  };

  for (const node of nodes) {
    if (node.diagnosticQuestionCount >= 2) summary.diagnosticReadyCount += 1;
    if (node.status === 'MASTERED') {
      summary.masteredCount += 1;
      if (node.latestEvidenceKind === 'DIAGNOSTIC_RESULT') summary.objectivelyMasteredCount += 1;
      if (node.latestEvidenceKind === 'SELF_ASSESSMENT') summary.selfAssessedMasteredCount += 1;
    } else if (node.status === 'LEARNING') {
      summary.learningCount += 1;
    } else if (node.status === 'AVAILABLE') {
      summary.availableCount += 1;
    } else if (node.status === 'LOCKED') {
      summary.lockedCount += 1;
    } else if (node.status === 'REVIEW_DUE') {
      summary.reviewDueCount += 1;
    }
  }

  return summary;
}

export function graphProgressPercent(progress: GraphProgressSummary): number {
  if (!progress.totalConceptCount) return 0;
  return Math.round((progress.masteredCount / progress.totalConceptCount) * 100);
}
