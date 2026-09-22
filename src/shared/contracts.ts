import { z } from 'zod';
import { hasDirectedCycle } from './graphRules';

export const NODE_STATUSES = ['LOCKED', 'AVAILABLE', 'LEARNING', 'MASTERED', 'REVIEW_DUE'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];
export const LEARNING_PHASES = ['NOT_STARTED', 'LEARNING', 'MASTERED'] as const;
export type LearningPhase = (typeof LEARNING_PHASES)[number];
export const EVIDENCE_KINDS = ['STUDY_STARTED', 'SELF_ASSESSMENT', 'DIAGNOSTIC_RESULT', 'LEARNING_SESSION_COMPLETED', 'PRACTICE_RESULT'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const QUESTION_PURPOSES = ['DIAGNOSTIC', 'PRACTICE', 'BOTH'] as const;
export type QuestionPurpose = (typeof QUESTION_PURPOSES)[number];
export const DOCUMENT_FORMATS = ['PDF', 'EPUB', 'TEXT', 'MARKDOWN'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
export type SelfAssessmentRating = 1 | 2 | 3 | 4 | 5;
export const TUTOR_ACTIONS = ['TEACH', 'ASSESS', 'PRACTICE', 'REVIEW', 'REMEDIATE', 'ADVANCE'] as const;
export type TutorAction = (typeof TUTOR_ACTIONS)[number];
export const TUTOR_DECISION_RESPONSES = ['PENDING', 'ACCEPTED', 'DISMISSED'] as const;
export type TutorDecisionResponse = (typeof TUTOR_DECISION_RESPONSES)[number];
export const TUTOR_REASON_CODES = [
  'RESUME_DIAGNOSTIC',
  'REMEDIATE_FAILED_DIAGNOSTIC',
  'ASSESS_WITH_QUESTION_BANK',
  'CONTINUE_PRACTICE',
  'ADVANCE_AFTER_MASTERY',
  'START_FOUNDATION',
  'REVIEW_COMPLETE_GRAPH',
  'REVIEW_TO_UNLOCK',
  'RESUME_LEARNING_SESSION',
  'RESUME_PRACTICE',
] as const;
export type TutorReasonCode = (typeof TUTOR_REASON_CODES)[number];

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
export const tutorDecisionIdInputSchema = z.object({
  decisionId: z.string().uuid('学习建议 ID 无效'),
});
export const respondTutorDecisionInputSchema = z.object({
  decisionId: tutorDecisionIdInputSchema.shape.decisionId,
  response: z.enum(TUTOR_DECISION_RESPONSES),
});
export const learningSessionIdInputSchema = z.object({
  sessionId: z.string().uuid('学习会话 ID 无效'),
});
export const startLearningSessionInputSchema = z.object({
  graphId: graphIdInputSchema.shape.graphId,
  nodeId: nodeIdInputSchema.shape.nodeId,
  action: z.enum(['TEACH', 'ADVANCE']),
  sourceDecisionId: tutorDecisionIdInputSchema.shape.decisionId.optional(),
});
export const saveLearningSessionDraftInputSchema = z.object({
  sessionId: learningSessionIdInputSchema.shape.sessionId,
  notes: z.string().max(5_000, '会话笔记不能超过 5000 字'),
  stepIndex: z.number().int().min(0).max(2),
});
export const completeLearningSessionInputSchema = z.object({
  sessionId: learningSessionIdInputSchema.shape.sessionId,
  notes: z.string().trim().min(1, '请先用自己的话写下学习总结').max(5_000, '会话笔记不能超过 5000 字'),
});
export const practiceAttemptIdInputSchema = z.object({
  attemptId: z.string().uuid('练习记录 ID 无效'),
});
export const startPracticeInputSchema = z.object({
  graphId: graphIdInputSchema.shape.graphId,
  nodeId: nodeIdInputSchema.shape.nodeId,
  mode: z.enum(['PRACTICE', 'REMEDIATE', 'REVIEW']),
  sourceDecisionId: tutorDecisionIdInputSchema.shape.decisionId.optional(),
});
export const savePracticeAnswerInputSchema = z.object({
  attemptId: practiceAttemptIdInputSchema.shape.attemptId,
  attemptQuestionId: z.string().uuid('练习题目 ID 无效'),
  selectedOptionId: z.string().uuid('答案选项 ID 无效').nullable(),
});
export const documentIdInputSchema = z.object({
  documentId: z.string().uuid('资料 ID 无效'),
});
export const documentPreviewTokenInputSchema = z.object({
  previewToken: z.string().uuid('资料预览已失效'),
});
export const documentSectionListInputSchema = z.object({
  documentId: documentIdInputSchema.shape.documentId,
  offset: z.number().int('章节位置无效').min(0, '章节位置无效').max(5000, '章节位置无效'),
});
export const documentSectionGetInputSchema = z.object({
  documentId: documentIdInputSchema.shape.documentId,
  position: z.number().int('章节位置无效').min(0, '章节位置无效').max(4999, '章节位置无效'),
  offset: z.number().int('正文位置无效').min(0, '正文位置无效').max(10_000_000, '正文位置无效'),
});
export const documentSearchInputSchema = z.object({
  documentId: documentIdInputSchema.shape.documentId,
  query: z.string().trim().min(2, '请至少输入 2 个字符').max(80, '搜索词不能超过 80 个字符'),
});
export const confirmDocumentImportInputSchema = z.object({
  previewToken: documentPreviewTokenInputSchema.shape.previewToken,
  title: z.string().trim().min(1, '资料标题不能为空').max(300, '资料标题不能超过 300 字'),
  author: z.string().trim().max(300, '作者信息不能超过 300 字'),
  publisher: z.string().trim().max(300, '出版社信息不能超过 300 字'),
  language: z.string().trim().max(80, '语言信息不能超过 80 字'),
  identifier: z.string().trim().max(200, '标识符不能超过 200 字'),
});
export const CANDIDATE_STATUSES = ['PENDING', 'ACCEPTED', 'IGNORED'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];
export type CandidateOrigin = 'MANUAL' | 'AI';
export const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro'] as const;
export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number];
export const candidateConceptIdInputSchema = z.object({
  candidateId: z.string().uuid('候选概念 ID 无效'),
});
export const candidateRelationshipIdInputSchema = z.object({
  relationshipId: z.string().uuid('候选关系 ID 无效'),
});
export const candidateWorkspaceInputSchema = z.object({
  graphId: graphIdInputSchema.shape.graphId,
  documentId: documentIdInputSchema.shape.documentId.optional(),
});
export const createCandidateConceptInputSchema = z.object({
  graphId: graphIdInputSchema.shape.graphId,
  documentId: documentIdInputSchema.shape.documentId,
  sectionPosition: z.number().int().min(0).max(4_999),
  sourceStartOffset: z.number().int().min(0).max(9_999_999),
  sourceEndOffset: z.number().int().min(1).max(10_000_000),
  name: z.string().trim().min(1, '候选概念名称不能为空').max(160, '候选概念名称不能超过 160 字'),
  description: z.string().trim().max(10_000, '候选概念描述不能超过 10000 字'),
}).superRefine((input, context) => {
  const length = input.sourceEndOffset - input.sourceStartOffset;
  if (length < 1 || length > 2_000) {
    context.addIssue({ code: 'custom', message: '请选择 1–2000 个字符作为原文依据', path: ['sourceEndOffset'] });
  }
});
export const updateCandidateConceptInputSchema = z.object({
  candidateId: candidateConceptIdInputSchema.shape.candidateId,
  name: z.string().trim().min(1, '候选概念名称不能为空').max(160, '候选概念名称不能超过 160 字'),
  description: z.string().trim().max(10_000, '候选概念描述不能超过 10000 字'),
});
export const reviewCandidateConceptInputSchema = z.object({
  candidateId: candidateConceptIdInputSchema.shape.candidateId,
  status: z.enum(['PENDING', 'IGNORED']),
});
export const createCandidateRelationshipInputSchema = z.object({
  graphId: graphIdInputSchema.shape.graphId,
  sourceCandidateId: candidateConceptIdInputSchema.shape.candidateId,
  targetCandidateId: candidateConceptIdInputSchema.shape.candidateId,
}).refine((input) => input.sourceCandidateId !== input.targetCandidateId, {
  message: '先修概念和后续概念不能相同', path: ['targetCandidateId'],
});
export const saveAiSettingsInputSchema = z.object({
  model: z.enum(DEEPSEEK_MODELS),
  apiKey: z.string().trim().min(8, 'API Key 至少需要 8 个字符').max(512, 'API Key 过长').optional(),
});
export const previewAiCandidateGenerationInputSchema = z.object({
  graphId: graphIdInputSchema.shape.graphId,
  documentId: documentIdInputSchema.shape.documentId,
  sectionPositions: z.array(z.number().int().min(0).max(4_999))
    .min(1, '请至少选择一个章节')
    .max(80, '一次最多选择 80 个连续章节'),
}).superRefine((input, context) => {
  if (new Set(input.sectionPositions).size !== input.sectionPositions.length) {
    context.addIssue({ code: 'custom', message: '章节不能重复', path: ['sectionPositions'] });
  }
  if (input.sectionPositions.some((position, index) => index > 0 && position !== input.sectionPositions[index - 1] + 1)) {
    context.addIssue({ code: 'custom', message: '请选择连续的章节范围', path: ['sectionPositions'] });
  }
});
export const aiGenerationTokenInputSchema = z.object({
  previewToken: z.string().uuid('AI 生成预览已失效'),
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
  purpose: z.enum(QUESTION_PURPOSES).optional(),
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
export type RespondTutorDecisionInput = z.infer<typeof respondTutorDecisionInputSchema>;
export type StartLearningSessionInput = z.infer<typeof startLearningSessionInputSchema>;
export type SaveLearningSessionDraftInput = z.infer<typeof saveLearningSessionDraftInputSchema>;
export type CompleteLearningSessionInput = z.infer<typeof completeLearningSessionInputSchema>;
export type StartPracticeInput = z.infer<typeof startPracticeInputSchema>;
export type SavePracticeAnswerInput = z.infer<typeof savePracticeAnswerInputSchema>;
export type ConfirmDocumentImportInput = z.infer<typeof confirmDocumentImportInputSchema>;
export type CreateCandidateConceptInput = z.infer<typeof createCandidateConceptInputSchema>;
export type UpdateCandidateConceptInput = z.infer<typeof updateCandidateConceptInputSchema>;
export type ReviewCandidateConceptInput = z.infer<typeof reviewCandidateConceptInputSchema>;
export type CreateCandidateRelationshipInput = z.infer<typeof createCandidateRelationshipInputSchema>;
export type SaveAiSettingsInput = z.infer<typeof saveAiSettingsInputSchema>;
export type PreviewAiCandidateGenerationInput = z.infer<typeof previewAiCandidateGenerationInputSchema>;
export interface GraphSummary { id: string; name: string; createdAt: string; updatedAt: string }
export interface KnowledgeNodeView {
  id: string; graphId: string; name: string; description: string;
  position: { x: number; y: number }; status: NodeStatus;
  learningPhase: LearningPhase; statusReason: string;
  evidenceCount: number; lastEvidenceAt: string | null;
  latestEvidenceKind: EvidenceKind | null;
  mostRecentEvidenceKind: EvidenceKind | null;
  latestEvidenceScoreEarned: number | null;
  latestEvidenceScorePossible: number | null;
  diagnosticQuestionCount: number;
  practiceQuestionCount: number;
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
  learningSessionId: string | null;
  practiceAttemptId: string | null;
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
  purpose: QuestionPurpose;
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
export interface TutorDecisionContext {
  attemptId?: string;
  sessionId?: string;
  practiceAttemptId?: string;
}
export type LearningSessionAction = 'TEACH' | 'ADVANCE';
export type LearningSessionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export interface LearningSessionPrerequisiteView {
  nodeId: string;
  nodeName: string;
  status: NodeStatus;
}
export interface LearningSessionView {
  id: string;
  graphId: string;
  nodeId: string | null;
  nodeName: string;
  description: string;
  prerequisites: LearningSessionPrerequisiteView[];
  action: LearningSessionAction;
  status: LearningSessionStatus;
  notes: string;
  stepIndex: number;
  sourceDecisionId: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}
export interface CompleteLearningSessionResult {
  session: LearningSessionView;
  evidence: LearningEvidenceView;
  graph: KnowledgeGraphDocument;
}
export type PracticeMode = 'PRACTICE' | 'REMEDIATE' | 'REVIEW';
export type PracticeAttemptStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export interface PracticeQuestionView {
  attemptQuestionId: string;
  prompt: string;
  options: DiagnosticQuestionOptionView[];
}
export interface PracticeAnswerFeedbackView {
  attemptQuestionId: string;
  selectedOptionId: string | null;
  selectedOptionText: string | null;
  correctOptionId: string;
  correctOptionText: string;
  explanation: string;
  isCorrect: boolean;
}
export interface PracticeAttemptView {
  id: string;
  graphId: string;
  nodeId: string | null;
  nodeName: string;
  mode: PracticeMode;
  status: PracticeAttemptStatus;
  sourceDecisionId: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  questions: PracticeQuestionView[];
  answers: PracticeAnswerFeedbackView[];
}
export interface PracticeAttemptSummaryView {
  id: string;
  graphId: string;
  nodeId: string | null;
  nodeName: string;
  mode: PracticeMode;
  status: PracticeAttemptStatus;
  startedAt: string;
  completedAt: string | null;
  questionCount: number;
  answeredCount: number;
  correctCount: number | null;
}
export interface CompletePracticeResult {
  attempt: PracticeAttemptView;
  evidence: LearningEvidenceView;
  graph: KnowledgeGraphDocument;
}
export type DocumentImportWarningSeverity = 'INFO' | 'WARNING' | 'BLOCKING';
export interface DocumentImportWarningView {
  code: string;
  severity: DocumentImportWarningSeverity;
  message: string;
}
export interface DocumentSectionPreviewView {
  position: number;
  heading: string;
  locator: string;
  content: string;
  charCount: number;
  truncated: boolean;
}
export interface DocumentPreviewView {
  previewToken: string;
  sourceName: string;
  format: DocumentFormat;
  fileSize: number;
  modifiedAt: string;
  sha256: string;
  title: string;
  author: string;
  publisher: string;
  language: string;
  identifier: string;
  encoding: string | null;
  pageCount: number | null;
  sectionCount: number;
  charCount: number;
  warnings: DocumentImportWarningView[];
  sections: DocumentSectionPreviewView[];
  canImport: boolean;
  blockedReason: string | null;
  duplicateDocumentId: string | null;
  duplicateDocumentTitle: string | null;
}
export interface DocumentPreviewFailureView {
  sourceName: string;
  message: string;
}
export interface DocumentSelectionView {
  previews: DocumentPreviewView[];
  failures: DocumentPreviewFailureView[];
}
export interface ImportedDocumentSummaryView {
  id: string;
  title: string;
  author: string;
  publisher: string;
  language: string;
  identifier: string;
  format: DocumentFormat;
  sourceName: string;
  fileSize: number;
  sha256: string;
  encoding: string | null;
  pageCount: number | null;
  sectionCount: number;
  charCount: number;
  warningCount: number;
  importedAt: string;
}
export interface ImportedDocumentView extends ImportedDocumentSummaryView {
  modifiedAt: string;
  warnings: DocumentImportWarningView[];
}
export interface DocumentSectionSummaryView {
  position: number;
  heading: string;
  locator: string;
  charCount: number;
}
export interface DocumentSectionView extends DocumentSectionSummaryView {
  content: string;
  startOffset: number;
  endOffset: number;
  totalLength: number;
  previousOffset: number | null;
  nextOffset: number | null;
}
export interface DocumentSearchHitView extends DocumentSectionSummaryView {
  excerpt: string;
  matchOffset: number;
}
export interface DocumentSearchView {
  hits: DocumentSearchHitView[];
  hasMore: boolean;
}
export interface CandidateConceptView {
  id: string;
  graphId: string;
  documentId: string | null;
  documentTitle: string;
  documentSourceName: string;
  sectionPosition: number;
  sourceLocator: string;
  sourceStartOffset: number;
  sourceEndOffset: number;
  sourceQuote: string;
  name: string;
  description: string;
  origin: CandidateOrigin;
  sourceModel: string | null;
  status: CandidateStatus;
  acceptedNodeId: string | null;
  duplicateNodeId: string | null;
  duplicateNodeName: string | null;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}
export interface CandidateRelationshipView {
  id: string;
  graphId: string;
  sourceCandidateId: string;
  targetCandidateId: string;
  relationship: 'PREREQUISITE';
  status: CandidateStatus;
  acceptedEdgeId: string | null;
  createdAt: string;
}
export interface CandidateWorkspaceView {
  concepts: CandidateConceptView[];
  relationships: CandidateRelationshipView[];
  pendingConceptCount: number;
  pendingRelationshipCount: number;
  blockingIssues: string[];
}
export interface ApplyCandidateWorkspaceResult {
  graph: KnowledgeGraphDocument;
  acceptedConceptCount: number;
  acceptedRelationshipCount: number;
}
export interface AiSettingsView {
  provider: 'DEEPSEEK';
  baseUrl: 'https://api.deepseek.com';
  model: DeepSeekModel;
  configured: boolean;
  secureStorageAvailable: boolean;
}
export interface AiConnectionTestResult {
  ok: true;
  model: DeepSeekModel;
  latencyMs: number;
}
export interface AiGenerationSectionView {
  position: number;
  heading: string;
  locator: string;
  charCount: number;
}
export interface AiCandidateGenerationPreviewView {
  previewToken: string;
  graphId: string;
  documentId: string;
  documentTitle: string;
  documentSourceName: string;
  model: DeepSeekModel;
  sections: AiGenerationSectionView[];
  totalCharCount: number;
  batchCount: number;
  excerpt: string;
  expiresAt: string;
}
export interface AiCandidateGenerationResult {
  workspace: CandidateWorkspaceView;
  provider: 'DEEPSEEK';
  model: DeepSeekModel;
  conceptCount: number;
  relationshipCount: number;
  batchCount: number;
  mergeWarnings: string[];
  promptTokens: number | null;
  completionTokens: number | null;
}
export interface TutorDecisionView {
  id: string;
  graphId: string;
  targetNodeId: string | null;
  targetNodeName: string;
  action: TutorAction;
  reasonCode: TutorReasonCode;
  reason: string;
  evidence: string[];
  context: TutorDecisionContext;
  response: TutorDecisionResponse;
  isStale: boolean;
  sourceVersion: number;
  createdAt: string;
  updatedAt: string;
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
  tutor: {
    getRecommendation(graphId: string): Promise<TutorDecisionView | null>;
    listDecisions(graphId: string): Promise<TutorDecisionView[]>;
    respondDecision(input: RespondTutorDecisionInput): Promise<TutorDecisionView>;
  };
  sessions: {
    list(graphId: string): Promise<LearningSessionView[]>;
    getActive(graphId: string): Promise<LearningSessionView | null>;
    get(sessionId: string): Promise<LearningSessionView>;
    start(input: StartLearningSessionInput): Promise<LearningSessionView>;
    saveDraft(input: SaveLearningSessionDraftInput): Promise<LearningSessionView>;
    complete(input: CompleteLearningSessionInput): Promise<CompleteLearningSessionResult>;
    cancel(sessionId: string): Promise<LearningSessionView>;
  };
  practice: {
    list(graphId: string): Promise<PracticeAttemptSummaryView[]>;
    getActive(graphId: string): Promise<PracticeAttemptView | null>;
    get(attemptId: string): Promise<PracticeAttemptView>;
    start(input: StartPracticeInput): Promise<PracticeAttemptView>;
    saveAnswer(input: SavePracticeAnswerInput): Promise<PracticeAnswerFeedbackView>;
    complete(attemptId: string): Promise<CompletePracticeResult>;
    cancel(attemptId: string): Promise<PracticeAttemptView>;
  };
  documents: {
    list(): Promise<ImportedDocumentSummaryView[]>;
    get(documentId: string): Promise<ImportedDocumentView>;
    listSections(documentId: string, offset: number): Promise<DocumentSectionSummaryView[]>;
    getSection(documentId: string, position: number, offset: number): Promise<DocumentSectionView>;
    search(documentId: string, query: string): Promise<DocumentSearchView>;
    chooseFiles(): Promise<DocumentSelectionView | null>;
    confirmImport(input: ConfirmDocumentImportInput): Promise<ImportedDocumentView>;
    discardPreview(previewToken: string): Promise<void>;
    delete(documentId: string): Promise<void>;
  };
  candidates: {
    getWorkspace(graphId: string, documentId?: string): Promise<CandidateWorkspaceView>;
    createConcept(input: CreateCandidateConceptInput): Promise<CandidateWorkspaceView>;
    updateConcept(input: UpdateCandidateConceptInput): Promise<CandidateWorkspaceView>;
    reviewConcept(input: ReviewCandidateConceptInput): Promise<CandidateWorkspaceView>;
    createRelationship(input: CreateCandidateRelationshipInput): Promise<CandidateWorkspaceView>;
    deleteRelationship(relationshipId: string): Promise<CandidateWorkspaceView>;
    apply(graphId: string): Promise<ApplyCandidateWorkspaceResult>;
  };
  ai: {
    getSettings(): Promise<AiSettingsView>;
    saveSettings(input: SaveAiSettingsInput): Promise<AiSettingsView>;
    clearApiKey(): Promise<AiSettingsView>;
    testConnection(): Promise<AiConnectionTestResult>;
    previewCandidateGeneration(input: PreviewAiCandidateGenerationInput): Promise<AiCandidateGenerationPreviewView>;
    generateCandidates(previewToken: string): Promise<AiCandidateGenerationResult>;
    cancelCandidateGeneration(previewToken: string): Promise<void>;
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
  tutorRecommendationGet: 'tutor:recommendation-get', tutorDecisionList: 'tutor:decision-list',
  tutorDecisionRespond: 'tutor:decision-respond',
  learningSessionList: 'session:list', learningSessionActiveGet: 'session:active-get',
  learningSessionGet: 'session:get', learningSessionStart: 'session:start',
  learningSessionDraftSave: 'session:draft-save', learningSessionComplete: 'session:complete',
  learningSessionCancel: 'session:cancel',
  practiceAttemptList: 'practice:list', practiceAttemptActiveGet: 'practice:active-get',
  practiceAttemptGet: 'practice:get', practiceAttemptStart: 'practice:start',
  practiceAnswerSave: 'practice:answer-save', practiceAttemptComplete: 'practice:complete',
  practiceAttemptCancel: 'practice:cancel',
  documentList: 'document:list', documentGet: 'document:get',
  documentSectionList: 'document:section-list', documentSectionGet: 'document:section-get',
  documentSearch: 'document:search', documentChoose: 'document:choose',
  documentImportConfirm: 'document:import-confirm', documentPreviewDiscard: 'document:preview-discard',
  documentDelete: 'document:delete',
  candidateWorkspaceGet: 'candidate:workspace-get', candidateConceptCreate: 'candidate:concept-create',
  candidateConceptUpdate: 'candidate:concept-update', candidateConceptReview: 'candidate:concept-review',
  candidateRelationshipCreate: 'candidate:relationship-create',
  candidateRelationshipDelete: 'candidate:relationship-delete', candidateWorkspaceApply: 'candidate:workspace-apply',
  aiSettingsGet: 'ai:settings-get', aiSettingsSave: 'ai:settings-save', aiApiKeyClear: 'ai:api-key-clear',
  aiConnectionTest: 'ai:connection-test', aiCandidatePreview: 'ai:candidate-preview',
  aiCandidateGenerate: 'ai:candidate-generate', aiCandidateCancel: 'ai:candidate-cancel',
  setUnsavedChanges: 'lifecycle:set-unsaved-changes',
} as const;
