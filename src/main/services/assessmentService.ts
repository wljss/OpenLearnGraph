import {
  attemptIdInputSchema,
  completeDiagnosticInputSchema,
  graphIdInputSchema,
  nodeIdInputSchema,
  questionIdInputSchema,
  saveAssessmentQuestionInputSchema,
  type AssessmentQuestionView,
  type CompleteDiagnosticResult,
  type DiagnosticAttemptView,
} from '../../shared/contracts';
import type { AssessmentRepository } from '../repositories/assessmentRepository';
import type { GraphRepository } from '../repositories/graphRepository';
import type { LearningRepository } from '../repositories/learningRepository';

function validationError(result: { success: false; error: { issues: Array<{ message: string }> } }): Error {
  return new Error(result.error.issues[0]?.message ?? '诊断数据无效');
}

export class AssessmentService {
  constructor(
    private readonly repository: AssessmentRepository,
    private readonly graphRepository: GraphRepository,
    private readonly learningRepository: LearningRepository,
  ) {}

  listQuestions(untrustedNodeId: unknown): AssessmentQuestionView[] {
    const parsed = nodeIdInputSchema.safeParse({ nodeId: untrustedNodeId });
    if (!parsed.success) throw validationError(parsed);
    if (!this.learningRepository.findGraphIdForNode(parsed.data.nodeId)) throw new Error('要查看题库的概念不存在');
    return this.repository.listQuestions(parsed.data.nodeId);
  }

  saveQuestion(untrustedInput: unknown): AssessmentQuestionView {
    const parsed = saveAssessmentQuestionInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw validationError(parsed);
    if (!this.learningRepository.findGraphIdForNode(parsed.data.nodeId)) throw new Error('要添加诊断题的概念不存在');
    if (parsed.data.id) {
      const existingNodeId = this.repository.findNodeIdForQuestion(parsed.data.id);
      if (!existingNodeId) throw new Error('要修改的诊断题不存在');
      if (existingNodeId !== parsed.data.nodeId) throw new Error('诊断题不属于当前概念');
    }
    return this.repository.saveQuestion(parsed.data);
  }

  deleteQuestion(untrustedQuestionId: unknown): void {
    const parsed = questionIdInputSchema.safeParse({ questionId: untrustedQuestionId });
    if (!parsed.success) throw validationError(parsed);
    if (!this.repository.findNodeIdForQuestion(parsed.data.questionId)) throw new Error('要删除的诊断题不存在');
    this.repository.deleteQuestion(parsed.data.questionId);
  }

  startDiagnostic(untrustedGraphId: unknown): DiagnosticAttemptView {
    const parsed = graphIdInputSchema.safeParse({ graphId: untrustedGraphId });
    if (!parsed.success) throw validationError(parsed);
    if (!this.graphRepository.load(parsed.data.graphId)) throw new Error('要诊断的知识图谱不存在');
    return this.repository.startDiagnostic(parsed.data.graphId);
  }

  cancelDiagnostic(untrustedAttemptId: unknown): void {
    const parsed = attemptIdInputSchema.safeParse({ attemptId: untrustedAttemptId });
    if (!parsed.success) throw validationError(parsed);
    this.repository.cancelDiagnostic(parsed.data.attemptId);
  }

  completeDiagnostic(untrustedInput: unknown): CompleteDiagnosticResult {
    const parsed = completeDiagnosticInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw validationError(parsed);
    const completed = this.repository.completeDiagnostic(parsed.data);
    const graph = this.graphRepository.load(completed.graphId);
    if (!graph) throw new Error('诊断完成后无法重新读取知识图谱');
    return { ...completed, graph };
  }
}
