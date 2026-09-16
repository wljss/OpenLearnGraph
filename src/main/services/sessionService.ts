import {
  completeLearningSessionInputSchema,
  graphIdInputSchema,
  learningSessionIdInputSchema,
  saveLearningSessionDraftInputSchema,
  startLearningSessionInputSchema,
  type CompleteLearningSessionResult,
  type LearningSessionView,
} from '../../shared/contracts';
import type { AssessmentRepository } from '../repositories/assessmentRepository';
import type { GraphRepository } from '../repositories/graphRepository';
import type { SessionRepository } from '../repositories/sessionRepository';
import type { TutorRepository } from '../repositories/tutorRepository';

function validationError(result: { success: false; error: { issues: Array<{ message: string }> } }): Error {
  return new Error(result.error.issues[0]?.message ?? '学习会话数据无效');
}

export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly graphRepository: GraphRepository,
    private readonly assessmentRepository: AssessmentRepository,
    private readonly tutorRepository: TutorRepository,
  ) {}

  list(untrustedGraphId: unknown): LearningSessionView[] {
    const parsed = graphIdInputSchema.safeParse({ graphId: untrustedGraphId });
    if (!parsed.success) throw validationError(parsed);
    if (!this.graphRepository.load(parsed.data.graphId)) throw new Error('要查看学习会话的知识图谱不存在');
    return this.repository.list(parsed.data.graphId);
  }

  getActive(untrustedGraphId: unknown): LearningSessionView | null {
    const parsed = graphIdInputSchema.safeParse({ graphId: untrustedGraphId });
    if (!parsed.success) throw validationError(parsed);
    if (!this.graphRepository.load(parsed.data.graphId)) throw new Error('要查看学习会话的知识图谱不存在');
    return this.repository.findActive(parsed.data.graphId);
  }

  get(untrustedSessionId: unknown): LearningSessionView {
    const parsed = learningSessionIdInputSchema.safeParse({ sessionId: untrustedSessionId });
    if (!parsed.success) throw validationError(parsed);
    const session = this.repository.find(parsed.data.sessionId);
    if (!session) throw new Error('要查看的学习会话不存在');
    return session;
  }

  start(untrustedInput: unknown): LearningSessionView {
    const parsed = startLearningSessionInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw validationError(parsed);
    const input = parsed.data;
    const graph = this.graphRepository.load(input.graphId);
    const node = graph?.nodes.find((candidate) => candidate.id === input.nodeId);
    if (!graph || !node) throw new Error('要学习的概念不属于当前知识图谱');

    const active = this.repository.findActive(input.graphId);
    if (active) {
      if (active.nodeId === input.nodeId) return active;
      throw new Error(`当前图谱已有“${active.nodeName}”学习会话，请先继续或放弃该会话`);
    }
    if (this.assessmentRepository.listDiagnosticAttempts(input.graphId)
      .some((attempt) => attempt.status === 'IN_PROGRESS')) {
      throw new Error('当前图谱有未完成的诊断，请先继续或放弃诊断');
    }
    if (node.status === 'LOCKED') throw new Error(node.statusReason);
    if (node.status === 'MASTERED') throw new Error('该概念已经掌握，无需开始新的教学会话');
    const description = node.description.trim();
    if (!description) throw new Error('这个概念还没有学习内容，请先补充并保存概念描述');

    if (input.sourceDecisionId) {
      const decision = this.tutorRepository.find(input.sourceDecisionId);
      if (!decision
        || decision.isStale
        || decision.response !== 'ACCEPTED'
        || decision.graphId !== input.graphId
        || decision.targetNodeId !== input.nodeId
        || decision.action !== input.action) {
        throw new Error('来源学习建议无效或已发生变化，请重新查看最新建议');
      }
    }

    const prerequisites = graph.edges
      .filter((edge) => edge.targetNodeId === node.id)
      .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.sourceNodeId))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .map((candidate) => ({
        nodeId: candidate.id,
        nodeName: candidate.name,
        status: candidate.status,
      }));
    return this.repository.create({
      graphId: input.graphId,
      nodeId: input.nodeId,
      nodeName: node.name,
      description,
      prerequisites,
      action: input.action,
      sourceDecisionId: input.sourceDecisionId,
    });
  }

  saveDraft(untrustedInput: unknown): LearningSessionView {
    const parsed = saveLearningSessionDraftInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw validationError(parsed);
    if (!this.repository.find(parsed.data.sessionId)) throw new Error('要保存的学习会话不存在');
    return this.repository.saveDraft(parsed.data);
  }

  cancel(untrustedSessionId: unknown): LearningSessionView {
    const parsed = learningSessionIdInputSchema.safeParse({ sessionId: untrustedSessionId });
    if (!parsed.success) throw validationError(parsed);
    if (!this.repository.find(parsed.data.sessionId)) throw new Error('要放弃的学习会话不存在');
    return this.repository.cancel(parsed.data.sessionId);
  }

  complete(untrustedInput: unknown): CompleteLearningSessionResult {
    const parsed = completeLearningSessionInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw validationError(parsed);
    const session = this.repository.find(parsed.data.sessionId);
    if (!session) throw new Error('要完成的学习会话不存在');
    if (session.status !== 'IN_PROGRESS') throw new Error('这次学习会话已经结束，无法重复完成');
    if (!session.nodeId) throw new Error('原概念已被删除，这次学习会话只能保留为历史记录');
    const graph = this.graphRepository.load(session.graphId);
    const node = graph?.nodes.find((candidate) => candidate.id === session.nodeId);
    if (!graph || !node) throw new Error('原概念已被删除，这次学习会话只能保留为历史记录');
    if (node.status === 'LOCKED') throw new Error(`当前概念已被锁定：${node.statusReason}`);
    const result = this.repository.complete(session.id, parsed.data.notes);
    return {
      ...result,
      graph: this.graphRepository.load(session.graphId) as NonNullable<typeof graph>,
    };
  }
}
