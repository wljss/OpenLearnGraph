import { type ZodError } from 'zod';
import { createGraphInputSchema, graphIdInputSchema, saveGraphInputSchema, type GraphSummary, type KnowledgeGraphDocument } from '../../shared/contracts';
import type { GraphRepository } from '../repositories/graphRepository';

function friendlyValidationMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return '输入内容无效';

  const [section, index] = issue.path;
  if (section === 'nodes' && typeof index === 'number') {
    return `第 ${index + 1} 个概念：${issue.message}`;
  }
  if (section === 'edges' && typeof index === 'number') {
    return `第 ${index + 1} 条先修关系：${issue.message}`;
  }
  return issue.message;
}

function parseOrThrow<T>(result: { success: true; data: T } | { success: false; error: ZodError }): T {
  if (result.success) return result.data;
  throw new Error(friendlyValidationMessage(result.error));
}

export class GraphService {
  constructor(private readonly repository: GraphRepository) {}
  list(): GraphSummary[] { return this.repository.list(); }
  create(untrustedInput: unknown): KnowledgeGraphDocument {
    return this.repository.create(parseOrThrow(createGraphInputSchema.safeParse(untrustedInput)).name);
  }
  load(untrustedGraphId: unknown): KnowledgeGraphDocument | null {
    const { graphId } = parseOrThrow(graphIdInputSchema.safeParse({ graphId: untrustedGraphId }));
    return this.repository.load(graphId);
  }
  save(untrustedInput: unknown): KnowledgeGraphDocument {
    return this.repository.save(parseOrThrow(saveGraphInputSchema.safeParse(untrustedInput)));
  }
}
