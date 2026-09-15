import { createHash } from 'node:crypto';
import {
  graphIdInputSchema,
  respondTutorDecisionInputSchema,
  type DiagnosticAttemptSummaryView,
  type KnowledgeGraphDocument,
  type TutorDecisionView,
} from '../../shared/contracts';
import { planNextLearningAction, type ActiveDiagnosticContext } from '../../shared/tutorPlanner';
import type { AssessmentRepository } from '../repositories/assessmentRepository';
import type { GraphRepository } from '../repositories/graphRepository';
import type { TutorRepository } from '../repositories/tutorRepository';

function validationError(result: { success: false; error: { issues: Array<{ message: string }> } }): Error {
  return new Error(result.error.issues[0]?.message ?? '学习建议数据无效');
}

function activeAttemptIds(attempts: DiagnosticAttemptSummaryView[]): string[] {
  return attempts
    .filter((attempt) => attempt.status === 'IN_PROGRESS')
    .map((attempt) => attempt.id)
    .sort();
}

export function buildTutorStateFingerprint(
  graph: KnowledgeGraphDocument,
  activeIds: string[],
): string {
  const state = {
    graphId: graph.id,
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      description: node.description,
      status: node.status,
      learningPhase: node.learningPhase,
      evidenceCount: node.evidenceCount,
      latestEvidenceKind: node.latestEvidenceKind,
      latestEvidenceScoreEarned: node.latestEvidenceScoreEarned,
      latestEvidenceScorePossible: node.latestEvidenceScorePossible,
      diagnosticQuestionCount: node.diagnosticQuestionCount,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    edges: graph.edges.map((edge) => ({
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      relationship: edge.relationship,
    })).sort((left, right) => (
      `${left.sourceNodeId}:${left.targetNodeId}`.localeCompare(`${right.sourceNodeId}:${right.targetNodeId}`)
    )),
    activeDiagnosticIds: [...activeIds].sort(),
  };
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

export class TutorService {
  constructor(
    private readonly repository: TutorRepository,
    private readonly graphRepository: GraphRepository,
    private readonly assessmentRepository: AssessmentRepository,
  ) {}

  private readGraphState(graphId: string): {
    graph: KnowledgeGraphDocument;
    activeDiagnostic: ActiveDiagnosticContext | null;
    fingerprint: string;
  } {
    const graph = this.graphRepository.load(graphId);
    if (!graph) throw new Error('要生成学习建议的知识图谱不存在');
    const attempts = this.assessmentRepository.listDiagnosticAttempts(graphId);
    const ids = activeAttemptIds(attempts);
    let activeDiagnostic: ActiveDiagnosticContext | null = null;
    if (ids[0]) {
      const attempt = this.assessmentRepository.resumeDiagnostic(ids[0]);
      const answered = new Set(attempt.answers.map((answer) => answer.attemptQuestionId));
      const targetQuestion = attempt.questions.find((question) => !answered.has(question.attemptQuestionId))
        ?? attempt.questions[0];
      activeDiagnostic = {
        attemptId: attempt.id,
        targetNodeId: targetQuestion?.nodeId ?? null,
      };
    }
    return {
      graph,
      activeDiagnostic,
      fingerprint: buildTutorStateFingerprint(graph, ids),
    };
  }

  getRecommendation(untrustedGraphId: unknown): TutorDecisionView | null {
    const parsed = graphIdInputSchema.safeParse({ graphId: untrustedGraphId });
    if (!parsed.success) throw validationError(parsed);
    const state = this.readGraphState(parsed.data.graphId);
    this.repository.markOtherStatesStale(parsed.data.graphId, state.fingerprint);
    const existing = this.repository.findCurrentByFingerprint(parsed.data.graphId, state.fingerprint);
    if (existing) return existing;
    const plan = planNextLearningAction(state.graph, state.activeDiagnostic);
    return plan ? this.repository.create(parsed.data.graphId, state.fingerprint, plan) : null;
  }

  listDecisions(untrustedGraphId: unknown): TutorDecisionView[] {
    const parsed = graphIdInputSchema.safeParse({ graphId: untrustedGraphId });
    if (!parsed.success) throw validationError(parsed);
    if (!this.graphRepository.load(parsed.data.graphId)) throw new Error('要查看学习建议的知识图谱不存在');
    return this.repository.list(parsed.data.graphId);
  }

  respondDecision(untrustedInput: unknown): TutorDecisionView {
    const parsed = respondTutorDecisionInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw validationError(parsed);
    const decision = this.repository.find(parsed.data.decisionId);
    if (!decision) throw new Error('要操作的学习建议不存在');
    if (decision.isStale) throw new Error('这条学习建议已失效，请查看最新建议');
    const state = this.readGraphState(decision.graphId);
    const storedFingerprint = this.repository.getStateFingerprint(decision.id);
    if (storedFingerprint !== state.fingerprint) {
      this.repository.markStale(decision.id);
      throw new Error('学习状态已经改变，这条建议不再适用，请查看最新建议');
    }
    return this.repository.respond(decision.id, parsed.data.response);
  }
}
