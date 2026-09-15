import { z } from 'zod';
import { hasDirectedCycle } from './graphRules';

export const NODE_STATUSES = ['LOCKED', 'AVAILABLE', 'LEARNING', 'MASTERED', 'REVIEW_DUE'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];
export const LEARNING_PHASES = ['NOT_STARTED', 'LEARNING', 'MASTERED'] as const;
export type LearningPhase = (typeof LEARNING_PHASES)[number];
export const EVIDENCE_KINDS = ['STUDY_STARTED', 'SELF_ASSESSMENT', 'DIAGNOSTIC_RESULT'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type SelfAssessmentRating = 1 | 2 | 3 | 4 | 5;

export const graphIdInputSchema = z.object({ graphId: z.string().uuid() });
export const nodeIdInputSchema = z.object({
  nodeId: z.string().uuid('概念 ID 无效'),
});
export const questionIdInputSchema = z.object({
  questionId: z.string().uuid('诊断题 ID 无效'),
});
export const attemptIdInputSchema = z.object({
  attemptId: z.string().uuid('诊断记录 ID 无效'),
});
export const startDiagnosticInputSchema = z.object({
  graphId: graphIdInputSchema.shape.graphId,
  nodeIds: z.array(nodeIdInputSchema.shape.nodeId)
    .min(1, '请至少选择一个要诊断的概念')
    .max(500, '一次诊断最多选择 500 个概念'),
}).superRefine((input, context) => {
  if (new Set(input.nodeIds).size !== input.nodeIds.length) {
    context.addIssue({ code: 'custom', message: '诊断概念不能重复', path: ['nodeIds'] });
  }
});
export const saveDiagnosticAnswerInputSchema = z.object({
  attemptId: attemptIdInputSchema.shape.attemptId,
  attemptQuestionId: z.string().uuid('诊断题目 ID 无效'),
  selectedOptionId: z.string().uuid('答案选项 ID 无效').nullable(),
});
export const createGraphInputSchema = z.object({
  name: z.string().trim().min(1, '图谱名称不能为空').max(120),
});
export const graphNodeInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, '概念名称不能为空').max(160),
  description: z.string().max(10_000),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
});
export const graphEdgeInputSchema = z.object({
  id: z.string().uuid(),
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  relationship: z.literal('PREREQUISITE'),
});
export const unsavedChangesInputSchema = z.boolean();
export const recordLearningEvidenceInputSchema = z.discriminatedUnion('kind', [
  z.object({
    nodeId: nodeIdInputSchema.shape.nodeId,
    kind: z.literal('STUDY_STARTED'),
  }),
  z.object({
    nodeId: nodeIdInputSchema.shape.nodeId,
    kind: z.literal('SELF_ASSESSMENT'),
    rating: z.number().int().min(1).max(5),
    note: z.string().trim().max(2_000, '学习备注不能超过 2000 字'),
  }),
]);
export const assessmentQuestionOptionInputSchema = z.object({
  id: z.string().uuid('选项 ID 无效').optional(),
  text: z.string().trim().min(1, '选项内容不能为空').max(500, '选项内容不能超过 500 字'),
  isCorrect: z.boolean(),
});
export const saveAssessmentQuestionInputSchema = z.object({
  id: z.string().uuid('诊断题 ID 无效').optional(),
  nodeId: nodeIdInputSchema.shape.nodeId,
  prompt: z.string().trim().min(1, '题目内容不能为空').max(2_000, '题目内容不能超过 2000 字'),
  explanation: z.string().trim().max(5_000, '答案解析不能超过 5000 字'),
  options: z.array(assessmentQuestionOptionInputSchema)
    .min(2, '每道题至少需要 2 个选项')
    .max(6, '每道题最多只能有 6 个选项'),
}).superRefine((question, context) => {
  if (question.options.filter((option) => option.isCorrect).length !== 1) {
    context.addIssue({ code: 'custom', message: '每道题必须且只能有一个正确答案', path: ['options'] });
  }
  const normalizedOptions = question.options.map((option) => option.text.toLocaleLowerCase());
  if (new Set(normalizedOptions).size !== normalizedOptions.length) {
    context.addIssue({ code: 'custom', message: '同一道题的选项不能重复', path: ['options'] });
  }
});
export const completeDiagnosticInputSchema = z.object({
  attemptId: z.string().uuid('诊断记录 ID 无效'),
  answers: z.array(z.object({
    attemptQuestionId: z.string().uuid('诊断题目 ID 无效'),
    selectedOptionId: z.string().uuid('答案选项 ID 无效').nullable(),
  })).min(1, '至少需要提交一道题的答案').max(500),
}).superRefine((submission, context) => {
  const questionIds = submission.answers.map((answer) => answer.attemptQuestionId);
  if (new Set(questionIds).size !== questionIds.length) {
    context.addIssue({ code: 'custom', message: '同一道题不能重复提交答案', path: ['answers'] });
  }
});
export const saveGraphInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, '图谱名称不能为空').max(120),
  nodes: z.array(graphNodeInputSchema).max(5_000),
  edges: z.array(graphEdgeInputSchema).max(20_000),
}).superRefine((graph, context) => {
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) context.addIssue({ code: 'custom', message: '节点 ID 不能重复', path: ['nodes'] });
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) context.addIssue({ code: 'custom', message: '边 ID 不能重复', path: ['edges'] });
    edgeIds.add(edge.id);
    if (edge.sourceNodeId === edge.targetNodeId) context.addIssue({ code: 'custom', message: '不能创建自循环先修关系', path: ['edges'] });
    if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) context.addIssue({ code: 'custom', message: '先修关系不能引用不存在的节点', path: ['edges'] });
    const pair = `${edge.sourceNodeId}:${edge.targetNodeId}:${edge.relationship}`;
    if (pairs.has(pair)) context.addIssue({ code: 'custom', message: '不能创建重复的先修关系', path: ['edges'] });
    pairs.add(pair);
  }
  if (hasDirectedCycle(graph.edges)) {
    context.addIssue({ code: 'custom', message: '先修关系不能形成循环', path: ['edges'] });
  }
});

export type CreateGraphInput = z.infer<typeof createGraphInputSchema>;
export type SaveGraphInput = z.infer<typeof saveGraphInputSchema>;
export type RecordLearningEvidenceInput = z.infer<typeof recordLearningEvidenceInputSchema>;
export type SaveAssessmentQuestionInput = z.infer<typeof saveAssessmentQuestionInputSchema>;
export type StartDiagnosticInput = z.infer<typeof startDiagnosticInputSchema>;
export type SaveDiagnosticAnswerInput = z.infer<typeof saveDiagnosticAnswerInputSchema>;
export type CompleteDiagnosticInput = z.infer<typeof completeDiagnosticInputSchema>;
export interface GraphSummary { id: string; name: string; createdAt: string; updatedAt: string }
export interface KnowledgeNodeView {
  id: string; graphId: string; name: string; description: string;
  position: { x: number; y: number }; status: NodeStatus;
  learningPhase: LearningPhase; statusReason: string;
  evidenceCount: number; lastEvidenceAt: string | null;
  latestEvidenceKind: EvidenceKind | null;
  latestEvidenceScoreEarned: number | null;
  latestEvidenceScorePossible: number | null;
  diagnosticQuestionCount: number;
}
export interface KnowledgeEdgeView {
  id: string; graphId: string; sourceNodeId: string; targetNodeId: string;
  relationship: 'PREREQUISITE';
}
export interface KnowledgeGraphDocument extends GraphSummary {
  nodes: KnowledgeNodeView[]; edges: KnowledgeEdgeView[];
}
export interface LearningEvidenceView {
  id: string;
  nodeId: string;
  kind: EvidenceKind;
  rating: SelfAssessmentRating | null;
  note: string;
  occurredAt: string;
  scoreEarned: number | null;
  scorePossible: number | null;
  assessmentAttemptId: string | null;
}
export interface RecordLearningEvidenceResult {
  graph: KnowledgeGraphDocument;
  evidence: LearningEvidenceView;
}
export interface AssessmentQuestionOptionView {
  id: string;
  text: string;
  isCorrect: boolean;
}
export interface AssessmentQuestionView {
  id: string;
  nodeId: string;
  prompt: string;
  explanation: string;
  options: AssessmentQuestionOptionView[];
  createdAt: string;
  updatedAt: string;
}
export interface DiagnosticQuestionOptionView {
  id: string;
  text: string;
}
export interface DiagnosticQuestionView {
  attemptQuestionId: string;
  nodeId: string;
  nodeName: string;
  prompt: string;
  options: DiagnosticQuestionOptionView[];
}
export interface DiagnosticAttemptView {
  id: string;
  graphId: string;
  startedAt: string;
  questions: DiagnosticQuestionView[];
}
export type DiagnosticAttemptStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export interface DiagnosticAttemptSummaryView {
  id: string;
  graphId: string;
  status: DiagnosticAttemptStatus;
  startedAt: string;
  completedAt: string | null;
  questionCount: number;
  answeredCount: number;
  correctCount: number | null;
  nodeCount: number;
}
export interface DiagnosticDraftAnswerView {
  attemptQuestionId: string;
  selectedOptionId: string | null;
}
export interface ResumableDiagnosticAttemptView extends DiagnosticAttemptView {
  answers: DiagnosticDraftAnswerView[];
}
export interface DiagnosticQuestionResult {
  attemptQuestionId: string;
  nodeId: string;
  nodeName: string;
  prompt: string;
  selectedOptionText: string | null;
  correctOptionText: string;
  explanation: string;
  isCorrect: boolean;
}
export interface DiagnosticNodeResult {
  nodeId: string;
  nodeName: string;
  correctCount: number;
  questionCount: number;
  passed: boolean;
}
export interface DiagnosticReviewView {
  attemptId: string;
  startedAt: string;
  completedAt: string;
  correctCount: number;
  questionCount: number;
  nodeResults: DiagnosticNodeResult[];
  questionResults: DiagnosticQuestionResult[];
}
export interface CompleteDiagnosticResult extends DiagnosticReviewView {
  evidence: LearningEvidenceView[];
  graph: KnowledgeGraphDocument;
}
export interface OpenLearnGraphApi {
  graphs: {
    list(): Promise<GraphSummary[]>;
    create(input: CreateGraphInput): Promise<KnowledgeGraphDocument>;
    load(graphId: string): Promise<KnowledgeGraphDocument | null>;
    save(input: SaveGraphInput): Promise<KnowledgeGraphDocument>;
  };
  learning: {
    listEvidence(nodeId: string): Promise<LearningEvidenceView[]>;
    recordEvidence(input: RecordLearningEvidenceInput): Promise<RecordLearningEvidenceResult>;
  };
  assessments: {
    listQuestions(nodeId: string): Promise<AssessmentQuestionView[]>;
    saveQuestion(input: SaveAssessmentQuestionInput): Promise<AssessmentQuestionView>;
    deleteQuestion(questionId: string): Promise<void>;
    listDiagnosticAttempts(graphId: string): Promise<DiagnosticAttemptSummaryView[]>;
    startDiagnostic(input: StartDiagnosticInput): Promise<DiagnosticAttemptView>;
    resumeDiagnostic(attemptId: string): Promise<ResumableDiagnosticAttemptView>;
    saveDiagnosticAnswer(input: SaveDiagnosticAnswerInput): Promise<void>;
    cancelDiagnostic(attemptId: string): Promise<void>;
    getDiagnosticResult(attemptId: string): Promise<DiagnosticReviewView>;
    completeDiagnostic(input: CompleteDiagnosticInput): Promise<CompleteDiagnosticResult>;
  };
  lifecycle: {
    setUnsavedChanges(hasUnsavedChanges: boolean): void;
  };
}
export const IPC_CHANNELS = {
  graphList: 'graph:list', graphCreate: 'graph:create', graphLoad: 'graph:load', graphSave: 'graph:save',
  learningEvidenceList: 'learning:evidence-list', learningEvidenceRecord: 'learning:evidence-record',
  assessmentQuestionList: 'assessment:question-list', assessmentQuestionSave: 'assessment:question-save',
  assessmentQuestionDelete: 'assessment:question-delete', diagnosticStart: 'assessment:diagnostic-start',
  diagnosticAttemptList: 'assessment:diagnostic-attempt-list', diagnosticResume: 'assessment:diagnostic-resume',
  diagnosticAnswerSave: 'assessment:diagnostic-answer-save', diagnosticCancel: 'assessment:diagnostic-cancel',
  diagnosticResultGet: 'assessment:diagnostic-result-get', diagnosticComplete: 'assessment:diagnostic-complete',
  setUnsavedChanges: 'lifecycle:set-unsaved-changes',
} as const;
