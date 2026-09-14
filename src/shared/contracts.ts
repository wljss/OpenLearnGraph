import { z } from 'zod';

export const NODE_STATUSES = ['LOCKED', 'AVAILABLE', 'LEARNING', 'MASTERED', 'REVIEW_DUE'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const graphIdInputSchema = z.object({ graphId: z.string().uuid() });
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
});

export type CreateGraphInput = z.infer<typeof createGraphInputSchema>;
export type SaveGraphInput = z.infer<typeof saveGraphInputSchema>;
export interface GraphSummary { id: string; name: string; createdAt: string; updatedAt: string }
export interface KnowledgeNodeView {
  id: string; graphId: string; name: string; description: string;
  position: { x: number; y: number }; status: NodeStatus;
}
export interface KnowledgeEdgeView {
  id: string; graphId: string; sourceNodeId: string; targetNodeId: string;
  relationship: 'PREREQUISITE';
}
export interface KnowledgeGraphDocument extends GraphSummary {
  nodes: KnowledgeNodeView[]; edges: KnowledgeEdgeView[];
}
export interface OpenLearnGraphApi {
  graphs: {
    list(): Promise<GraphSummary[]>;
    create(input: CreateGraphInput): Promise<KnowledgeGraphDocument>;
    load(graphId: string): Promise<KnowledgeGraphDocument | null>;
    save(input: SaveGraphInput): Promise<KnowledgeGraphDocument>;
  };
}
export const IPC_CHANNELS = {
  graphList: 'graph:list', graphCreate: 'graph:create', graphLoad: 'graph:load', graphSave: 'graph:save',
} as const;
