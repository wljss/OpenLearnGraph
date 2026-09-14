import { createGraphInputSchema, graphIdInputSchema, saveGraphInputSchema, type GraphSummary, type KnowledgeGraphDocument } from '../../shared/contracts';
import type { GraphRepository } from '../repositories/graphRepository';

export class GraphService {
  constructor(private readonly repository: GraphRepository) {}
  list(): GraphSummary[] { return this.repository.list(); }
  create(untrustedInput: unknown): KnowledgeGraphDocument {
    return this.repository.create(createGraphInputSchema.parse(untrustedInput).name);
  }
  load(untrustedGraphId: unknown): KnowledgeGraphDocument | null {
    const { graphId } = graphIdInputSchema.parse({ graphId: untrustedGraphId });
    return this.repository.load(graphId);
  }
  save(untrustedInput: unknown): KnowledgeGraphDocument {
    return this.repository.save(saveGraphInputSchema.parse(untrustedInput));
  }
}
