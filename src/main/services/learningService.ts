import {
  nodeIdInputSchema,
  recordLearningEvidenceInputSchema,
  type LearningEvidenceView,
  type RecordLearningEvidenceResult,
} from '../../shared/contracts';
import type { GraphRepository } from '../repositories/graphRepository';
import type { LearningRepository } from '../repositories/learningRepository';

export class LearningService {
  constructor(
    private readonly repository: LearningRepository,
    private readonly graphRepository: GraphRepository,
  ) {}

  listEvidence(untrustedNodeId: unknown): LearningEvidenceView[] {
    const parsed = nodeIdInputSchema.safeParse({ nodeId: untrustedNodeId });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '概念 ID 无效');
    if (!this.repository.findGraphIdForNode(parsed.data.nodeId)) throw new Error('要查看的概念不存在');
    return this.repository.listEvidence(parsed.data.nodeId);
  }

  recordEvidence(untrustedInput: unknown): RecordLearningEvidenceResult {
    const parsed = recordLearningEvidenceInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '学习记录无效');
    const input = parsed.data;
    const graphId = this.repository.findGraphIdForNode(input.nodeId);
    if (!graphId) throw new Error('要记录学习状态的概念不存在');
    const graph = this.graphRepository.load(graphId);
    const node = graph?.nodes.find((candidate) => candidate.id === input.nodeId);
    if (!graph || !node) throw new Error('要记录学习状态的概念不存在');
    if (input.kind === 'STUDY_STARTED' && node.status === 'LOCKED') {
      throw new Error(node.statusReason);
    }
    if (input.kind === 'STUDY_STARTED' && node.status === 'MASTERED') {
      throw new Error('该概念已经掌握；如需更新状态，请记录新的自评。');
    }
    if (input.kind === 'STUDY_STARTED' && node.status === 'LEARNING') {
      throw new Error('该概念已经处于学习中。');
    }

    const evidence = this.repository.recordEvidence(input);
    return {
      evidence,
      graph: this.graphRepository.load(graphId) as NonNullable<typeof graph>,
    };
  }
}
