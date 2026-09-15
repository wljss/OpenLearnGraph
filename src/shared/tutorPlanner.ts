import type {
  KnowledgeGraphDocument,
  TutorAction,
  TutorDecisionContext,
  TutorReasonCode,
} from './contracts';

export interface ActiveDiagnosticContext {
  attemptId: string;
  targetNodeId: string | null;
}

export interface TutorPlan {
  targetNodeId: string | null;
  targetNodeName: string;
  action: TutorAction;
  reasonCode: TutorReasonCode;
  reason: string;
  evidence: string[];
  context: TutorDecisionContext;
}

function objectiveDiagnostic(node: KnowledgeGraphDocument['nodes'][number]): boolean {
  return node.latestEvidenceKind === 'DIAGNOSTIC_RESULT'
    && node.latestEvidenceScoreEarned !== null
    && node.latestEvidenceScorePossible !== null
    && node.latestEvidenceScorePossible > 0;
}

function diagnosticPassed(node: KnowledgeGraphDocument['nodes'][number]): boolean {
  return objectiveDiagnostic(node)
    && (node.latestEvidenceScoreEarned as number) / (node.latestEvidenceScorePossible as number) >= 0.8;
}

function scoreEvidence(node: KnowledgeGraphDocument['nodes'][number]): string {
  return `最近一次诊断：${node.latestEvidenceScoreEarned}/${node.latestEvidenceScorePossible} 题正确`;
}

function planForNode(
  node: KnowledgeGraphDocument['nodes'][number],
  action: TutorAction,
  reasonCode: TutorReasonCode,
  reason: string,
  evidence: string[],
): TutorPlan {
  return {
    targetNodeId: node.id,
    targetNodeName: node.name,
    action,
    reasonCode,
    reason,
    evidence,
    context: {},
  };
}

/**
 * A deliberately small and deterministic policy. It only interprets persisted
 * learner evidence; executing a plan is left to the user and renderer.
 */
export function planNextLearningAction(
  graph: KnowledgeGraphDocument,
  activeDiagnostic: ActiveDiagnosticContext | null = null,
): TutorPlan | null {
  if (!graph.nodes.length) return null;

  if (activeDiagnostic) {
    const target = graph.nodes.find((node) => (
      node.id === activeDiagnostic.targetNodeId && node.status !== 'LOCKED'
    ));
    return {
      targetNodeId: target?.id ?? null,
      targetNodeName: target?.name ?? '未完成的诊断',
      action: 'ASSESS',
      reasonCode: 'RESUME_DIAGNOSTIC',
      reason: '你有一项尚未完成的诊断，继续作答可以保留上下文并避免重复开始。',
      evidence: ['检测到未完成的诊断记录', '已作答内容保存在本机'],
      context: { attemptId: activeDiagnostic.attemptId },
    };
  }

  const actionable = graph.nodes.filter((node) => node.status !== 'LOCKED');
  const failedDiagnostic = actionable.find((node) => objectiveDiagnostic(node) && !diagnosticPassed(node));
  if (failedDiagnostic) {
    return planForNode(
      failedDiagnostic,
      'REMEDIATE',
      'REMEDIATE_FAILED_DIAGNOSTIC',
      '最近一次客观诊断尚未达到 80% 的掌握标准，建议先回到这个薄弱点进行针对性巩固。',
      [scoreEvidence(failedDiagnostic), failedDiagnostic.statusReason],
    );
  }

  const learning = actionable.find((node) => node.status === 'LEARNING');
  if (learning) {
    if (!objectiveDiagnostic(learning) && learning.diagnosticQuestionCount >= 2) {
      return planForNode(
        learning,
        'ASSESS',
        'ASSESS_WITH_QUESTION_BANK',
        '你已经开始学习，并且题库覆盖充足；现在可以用一次客观诊断检查掌握情况。',
        [`已有 ${learning.diagnosticQuestionCount} 道诊断题`, learning.statusReason],
      );
    }
    return planForNode(
      learning,
      'PRACTICE',
      'CONTINUE_PRACTICE',
      '这个概念仍处于学习中，建议继续练习并在准备好后记录新的学习证据。',
      [learning.statusReason, `已有 ${learning.evidenceCount} 条学习证据`],
    );
  }

  const available = actionable.find((node) => node.status === 'AVAILABLE');
  if (available) {
    if (!objectiveDiagnostic(available) && available.diagnosticQuestionCount >= 2) {
      return planForNode(
        available,
        'ASSESS',
        'ASSESS_WITH_QUESTION_BANK',
        '这个概念已经解锁且题库覆盖充足，可以先诊断再决定学习深度。',
        [`已有 ${available.diagnosticQuestionCount} 道诊断题`, available.statusReason],
      );
    }
    const hasMasteredNode = graph.nodes.some((node) => node.status === 'MASTERED');
    return planForNode(
      available,
      hasMasteredNode ? 'ADVANCE' : 'TEACH',
      hasMasteredNode ? 'ADVANCE_AFTER_MASTERY' : 'START_FOUNDATION',
      hasMasteredNode
        ? '先修条件已经满足，可以进入下一个已解锁的概念。'
        : '这是当前可直接开始的基础概念，适合作为学习起点。',
      [available.statusReason, `当前有 ${available.diagnosticQuestionCount} 道诊断题`],
    );
  }

  const reviewTarget = graph.nodes.find((node) => node.status === 'REVIEW_DUE')
    ?? graph.nodes.find((node) => node.status === 'MASTERED');
  if (reviewTarget) {
    const allMastered = graph.nodes.every((node) => node.status === 'MASTERED');
    return planForNode(
      reviewTarget,
      'REVIEW',
      allMastered ? 'REVIEW_COMPLETE_GRAPH' : 'REVIEW_TO_UNLOCK',
      allMastered
        ? '当前图谱中的概念均已掌握，可以通过回顾来保持知识结构清晰。'
        : '当前没有新的可学习概念，建议先回顾已掌握内容并检查先修关系。',
      [reviewTarget.statusReason, `已有 ${reviewTarget.evidenceCount} 条学习证据`],
    );
  }

  // A valid acyclic graph should always have an actionable root. Returning no
  // recommendation is safer than directing the learner to a locked concept.
  return null;
}
