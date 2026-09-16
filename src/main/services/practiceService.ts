import {
  graphIdInputSchema,
  practiceAttemptIdInputSchema,
  savePracticeAnswerInputSchema,
  startPracticeInputSchema,
  type CompletePracticeResult,
  type PracticeAnswerFeedbackView,
  type PracticeAttemptSummaryView,
  type PracticeAttemptView,
} from '../../shared/contracts';
import type { AssessmentRepository } from '../repositories/assessmentRepository';
import type { GraphRepository } from '../repositories/graphRepository';
import type { PracticeRepository } from '../repositories/practiceRepository';
import type { SessionRepository } from '../repositories/sessionRepository';
import type { TutorRepository } from '../repositories/tutorRepository';

function validationError(result: { success: false; error: { issues: Array<{ message: string }> } }): Error {
  return new Error(result.error.issues[0]?.message ?? '练习数据无效');
}

export class PracticeService {
  constructor(
    private readonly repository: PracticeRepository,
    private readonly graphRepository: GraphRepository,
    private readonly assessmentRepository: AssessmentRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly tutorRepository: TutorRepository,
  ) {}

  list(untrustedGraphId: unknown): PracticeAttemptSummaryView[] {
    const parsed = graphIdInputSchema.safeParse({ graphId: untrustedGraphId });
    if (!parsed.success) throw validationError(parsed);
    if (!this.graphRepository.load(parsed.data.graphId)) throw new Error('要查看练习记录的知识图谱不存在');
    return this.repository.list(parsed.data.graphId);
  }

  getActive(untrustedGraphId: unknown): PracticeAttemptView | null {
    const parsed = graphIdInputSchema.safeParse({ graphId: untrustedGraphId });
    if (!parsed.success) throw validationError(parsed);
    if (!this.graphRepository.load(parsed.data.graphId)) throw new Error('要查看练习记录的知识图谱不存在');
    return this.repository.findActive(parsed.data.graphId);
  }

  get(untrustedAttemptId: unknown): PracticeAttemptView {
    const parsed = practiceAttemptIdInputSchema.safeParse({ attemptId: untrustedAttemptId });
    if (!parsed.success) throw validationError(parsed);
    const attempt = this.repository.find(parsed.data.attemptId);
    if (!attempt) throw new Error('要查看的练习记录不存在');
    return attempt;
  }

  start(untrustedInput: unknown): PracticeAttemptView {
    const parsed = startPracticeInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw validationError(parsed);
    const input = parsed.data;
    const graph = this.graphRepository.load(input.graphId);
    const node = graph?.nodes.find((candidate) => candidate.id === input.nodeId);
    if (!graph || !node) throw new Error('要练习的概念不属于当前知识图谱');

    const active = this.repository.findActive(input.graphId);
    if (active) {
      if (active.nodeId === input.nodeId && active.mode === input.mode) return active;
      throw new Error(`当前图谱已有“${active.nodeName}”练习，请先继续或放弃该练习`);
    }
    if (this.sessionRepository.findActive(input.graphId)) {
      throw new Error('当前图谱有未完成的学习会话，请先继续或放弃学习会话');
    }
    if (this.assessmentRepository.listDiagnosticAttempts(input.graphId)
      .some((attempt) => attempt.status === 'IN_PROGRESS')) {
      throw new Error('当前图谱有未完成的诊断，请先继续或放弃诊断');
    }
    if (node.status === 'LOCKED') throw new Error(node.statusReason);
    if (node.practiceQuestionCount < 1) {
      throw new Error('这个概念还没有练习题，请先添加用途为“练习”或“通用”的题目');
    }
    const objectiveFailed = node.latestEvidenceKind === 'DIAGNOSTIC_RESULT'
      && node.latestEvidenceScoreEarned !== null
      && node.latestEvidenceScorePossible !== null
      && node.latestEvidenceScorePossible > 0
      && node.latestEvidenceScoreEarned / node.latestEvidenceScorePossible < 0.8;
    if (input.mode === 'REMEDIATE' && !objectiveFailed) {
      throw new Error('只有最近一次客观诊断未通过的概念才能开始针对性补强');
    }
    if (input.mode === 'REVIEW' && node.status !== 'MASTERED') {
      throw new Error('只有已经掌握的概念才能开始回顾练习');
    }
    if (input.mode === 'PRACTICE' && node.status === 'MASTERED') {
      throw new Error('该概念已经掌握，请改用回顾练习');
    }

    if (input.sourceDecisionId) {
      const decision = this.tutorRepository.find(input.sourceDecisionId);
      if (!decision
        || decision.isStale
        || decision.response !== 'ACCEPTED'
        || decision.graphId !== input.graphId
        || decision.targetNodeId !== input.nodeId
        || decision.action !== input.mode) {
        throw new Error('来源学习建议无效或已发生变化，请重新查看最新建议');
      }
    }
    return this.repository.create({
      graphId: input.graphId,
      nodeId: input.nodeId,
      nodeName: node.name,
      mode: input.mode,
      sourceDecisionId: input.sourceDecisionId,
    });
  }

  saveAnswer(untrustedInput: unknown): PracticeAnswerFeedbackView {
    const parsed = savePracticeAnswerInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw validationError(parsed);
    if (!this.repository.find(parsed.data.attemptId)) throw new Error('要作答的练习不存在');
    return this.repository.saveAnswer(parsed.data);
  }

  cancel(untrustedAttemptId: unknown): PracticeAttemptView {
    const parsed = practiceAttemptIdInputSchema.safeParse({ attemptId: untrustedAttemptId });
    if (!parsed.success) throw validationError(parsed);
    if (!this.repository.find(parsed.data.attemptId)) throw new Error('要放弃的练习不存在');
    return this.repository.cancel(parsed.data.attemptId);
  }

  complete(untrustedAttemptId: unknown): CompletePracticeResult {
    const parsed = practiceAttemptIdInputSchema.safeParse({ attemptId: untrustedAttemptId });
    if (!parsed.success) throw validationError(parsed);
    const attempt = this.repository.find(parsed.data.attemptId);
    if (!attempt) throw new Error('要完成的练习不存在');
    if (attempt.status !== 'IN_PROGRESS') throw new Error('这次练习已经结束，无法重复完成');
    if (!attempt.nodeId) throw new Error('原概念已被删除，这次练习只能保留为历史记录');
    const graph = this.graphRepository.load(attempt.graphId);
    const node = graph?.nodes.find((candidate) => candidate.id === attempt.nodeId);
    if (!graph || !node) throw new Error('原概念已被删除，这次练习只能保留为历史记录');
    if (node.status === 'LOCKED') throw new Error(`当前概念已被锁定：${node.statusReason}`);
    const completed = this.repository.complete(attempt.id);
    return {
      ...completed,
      graph: this.graphRepository.load(attempt.graphId) as NonNullable<typeof graph>,
    };
  }
}
