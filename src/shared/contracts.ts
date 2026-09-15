import { z } from 'zod';
import { hasDirectedCycle } from './graphRules';

export const NODE_STATUSES = ['LOCKED', 'AVAILABLE', 'LEARNING', 'MASTERED', 'REVIEW_DUE'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];
export const LEARNING_PHASES = ['NOT_STARTED', 'LEARNING', 'MASTERED'] as const;
export type LearningPhase = (typeof LEARNING_PHASES)[number];
export const EVIDENCE_KINDS = ['STUDY_STARTED', 'SELF_ASSESSMENT'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type SelfAssessmentRating = 1 | 2 | 3 | 4 | 5;

export const graphIdInputSchema = z.object({ graphId: z.string().uuid() });
export const nodeIdInputSchema = z.object({
  nodeId: z.string().uuid('概念 ID 无效'),
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
export interface GraphSummary { id: string; name: string; createdAt: string; updatedAt: string }
export interface KnowledgeNodeView {
  id: string; graphId: string; name: string; description: string;
  position: { x: number; y: number }; status: NodeStatus;
  learningPhase: LearningPhase; statusReason: string;
  evidenceCount: number; lastEvidenceAt: string | null;
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
}
export interface RecordLearningEvidenceResult {
  graph: KnowledgeGraphDocument;
  evidence: LearningEvidenceView;
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
  lifecycle: {
    setUnsavedChanges(hasUnsavedChanges: boolean): void;
  };
}
export const IPC_CHANNELS = {
  graphList: 'graph:list', graphCreate: 'graph:create', graphLoad: 'graph:load', graphSave: 'graph:save',
  learningEvidenceList: 'learning:evidence-list', learningEvidenceRecord: 'learning:evidence-record',
  setUnsavedChanges: 'lifecycle:set-unsaved-changes',
} as const;
