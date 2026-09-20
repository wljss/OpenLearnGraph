import type { ZodError } from 'zod';
import {
  candidateRelationshipIdInputSchema,
  candidateWorkspaceInputSchema,
  createCandidateConceptInputSchema,
  createCandidateRelationshipInputSchema,
  graphIdInputSchema,
  reviewCandidateConceptInputSchema,
  updateCandidateConceptInputSchema,
  type ApplyCandidateWorkspaceResult,
  type CandidateWorkspaceView,
} from '../../shared/contracts';
import type { CandidateRepository } from '../repositories/candidateRepository';

function parseOrThrow<T>(result: { success: true; data: T } | { success: false; error: ZodError }): T {
  if (result.success) return result.data;
  throw new Error(result.error.issues[0]?.message ?? '候选图谱数据无效');
}

export class CandidateService {
  constructor(private readonly repository: CandidateRepository) {}

  getWorkspace(untrustedGraphId: unknown, untrustedDocumentId?: unknown): CandidateWorkspaceView {
    const input = parseOrThrow(candidateWorkspaceInputSchema.safeParse({
      graphId: untrustedGraphId,
      documentId: untrustedDocumentId,
    }));
    if (!this.repository.graphExists(input.graphId)) throw new Error('目标知识图谱不存在');
    return this.repository.workspace(input.graphId, input.documentId);
  }

  createConcept(untrustedInput: unknown): CandidateWorkspaceView {
    return this.repository.createConcept(parseOrThrow(createCandidateConceptInputSchema.safeParse(untrustedInput)));
  }

  updateConcept(untrustedInput: unknown): CandidateWorkspaceView {
    return this.repository.updateConcept(parseOrThrow(updateCandidateConceptInputSchema.safeParse(untrustedInput)));
  }

  reviewConcept(untrustedInput: unknown): CandidateWorkspaceView {
    const input = parseOrThrow(reviewCandidateConceptInputSchema.safeParse(untrustedInput));
    return this.repository.reviewConcept(input.candidateId, input.status);
  }

  createRelationship(untrustedInput: unknown): CandidateWorkspaceView {
    return this.repository.createRelationship(parseOrThrow(
      createCandidateRelationshipInputSchema.safeParse(untrustedInput),
    ));
  }

  deleteRelationship(untrustedRelationshipId: unknown): CandidateWorkspaceView {
    const input = parseOrThrow(candidateRelationshipIdInputSchema.safeParse({
      relationshipId: untrustedRelationshipId,
    }));
    return this.repository.deleteRelationship(input.relationshipId);
  }

  apply(untrustedGraphId: unknown): ApplyCandidateWorkspaceResult {
    const input = parseOrThrow(graphIdInputSchema.safeParse({ graphId: untrustedGraphId }));
    return this.repository.apply(input.graphId);
  }
}
