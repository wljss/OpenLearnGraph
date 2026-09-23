import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  CreateOnboardingSampleResult,
  OnboardingStateView,
  OnboardingStatus,
} from '../../shared/contracts';
import type { GraphRepository } from './graphRepository';

interface OnboardingRow {
  status: OnboardingStatus;
  sample_graph_id: string | null;
  updated_at: string;
}

const SAMPLE_NODES = [
  {
    name: '数据集划分',
    description: '把已有数据分成训练集和测试集。训练集用于学习模型参数；测试集只用于检查模型面对未见数据时的表现。',
    x: 80,
    questions: [
      ['训练集的主要作用是什么？', '用于学习模型参数', ['只用于最终展示', '用于学习模型参数', '保证模型永远正确'], '训练集提供模型拟合规律所需的数据。'],
      ['为什么测试集不应参与模型训练？', '为了独立评估泛化能力', ['为了减少文件大小', '为了独立评估泛化能力', '因为测试集没有特征'], '隔离测试集可以更可信地检查模型对未见数据的表现。'],
    ],
  },
  {
    name: '线性回归',
    description: '线性回归用特征的加权和预测连续数值，并通过最小化预测值与真实值之间的误差来学习权重。',
    x: 350,
    questions: [
      ['线性回归通常用于预测哪类结果？', '连续数值', ['连续数值', '固定的文件格式', '无序文本段落'], '线性回归的输出通常是连续数值。'],
      ['训练线性回归时常见的目标是什么？', '减小预测误差', ['增加特征数量', '减小预测误差', '让所有权重相同'], '训练过程通过优化参数来减小预测值与真实值之间的差异。'],
    ],
  },
  {
    name: '模型评估',
    description: '模型评估使用未参与训练的数据和合适的指标，判断模型是否真正学到了可泛化的规律，而不是只记住训练样本。',
    x: 620,
    questions: [
      ['训练集表现很好、测试集表现很差，通常说明什么？', '可能发生过拟合', ['可能发生过拟合', '模型一定泛化良好', '测试集已经参与训练'], '训练与测试表现差距过大是过拟合的常见信号。'],
      ['评估回归模型时可以使用哪个指标？', '平均绝对误差', ['分类标签名称', '平均绝对误差', '文件页数'], '平均绝对误差可以衡量连续预测值与真实值的平均偏差。'],
    ],
  },
] as const;

export class OnboardingRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly graphRepository: GraphRepository,
  ) {}

  getState(): OnboardingStateView {
    const row = this.database.prepare(
      'SELECT status, sample_graph_id, updated_at FROM onboarding_state WHERE id = 1',
    ).get() as unknown as OnboardingRow | undefined;
    if (!row) throw new Error('上手引导状态不存在');
    const checks = this.database.prepare(`
      SELECT
        EXISTS (SELECT 1 FROM knowledge_graphs) AS has_graph,
        EXISTS (SELECT 1 FROM knowledge_nodes) AS has_concept,
        EXISTS (SELECT 1 FROM knowledge_edges) AS has_relationship,
        EXISTS (SELECT 1 FROM learning_evidence WHERE kind = 'LEARNING_SESSION_COMPLETED') AS has_learning_session,
        EXISTS (SELECT 1 FROM learning_evidence WHERE kind = 'PRACTICE_RESULT') AS has_practice,
        EXISTS (SELECT 1 FROM learning_evidence WHERE kind = 'DIAGNOSTIC_RESULT') AS has_diagnostic
    `).get() as unknown as Record<string, number>;
    return {
      status: row.status,
      sampleGraphId: row.sample_graph_id,
      checklist: {
        hasGraph: Boolean(checks.has_graph),
        hasConcept: Boolean(checks.has_concept),
        hasRelationship: Boolean(checks.has_relationship),
        hasLearningSession: Boolean(checks.has_learning_session),
        hasPractice: Boolean(checks.has_practice),
        hasDiagnostic: Boolean(checks.has_diagnostic),
      },
      updatedAt: row.updated_at,
    };
  }

  updateStatus(status: Exclude<OnboardingStatus, 'NOT_STARTED'>): OnboardingStateView {
    const now = new Date().toISOString();
    this.database.prepare(`
      UPDATE onboarding_state
      SET status = ?,
          started_at = CASE WHEN ? = 'IN_PROGRESS' THEN COALESCE(started_at, ?) ELSE started_at END,
          completed_at = CASE WHEN ? = 'COMPLETED' THEN ? ELSE completed_at END,
          updated_at = ?
      WHERE id = 1
    `).run(status, status, now, status, now, now);
    return this.getState();
  }

  createSample(): CreateOnboardingSampleResult {
    const current = this.getState();
    if (current.sampleGraphId) {
      const existing = this.graphRepository.load(current.sampleGraphId);
      if (existing) return { state: current, graph: existing };
    }

    const graphId = randomUUID();
    const nodeIds = SAMPLE_NODES.map(() => randomUUID());
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.prepare(
        'INSERT INTO knowledge_graphs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      ).run(graphId, '示例：机器学习入门', now, now);
      const insertNode = this.database.prepare(`
        INSERT INTO knowledge_nodes
          (id, graph_id, name, description, position_x, position_y, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      SAMPLE_NODES.forEach((node, index) => {
        insertNode.run(nodeIds[index], graphId, node.name, node.description, node.x, 210, now, now);
      });
      const insertEdge = this.database.prepare(`
        INSERT INTO knowledge_edges
          (id, graph_id, source_node_id, target_node_id, relationship, created_at)
        VALUES (?, ?, ?, ?, 'PREREQUISITE', ?)
      `);
      insertEdge.run(randomUUID(), graphId, nodeIds[0], nodeIds[1], now);
      insertEdge.run(randomUUID(), graphId, nodeIds[1], nodeIds[2], now);

      const insertQuestion = this.database.prepare(`
        INSERT INTO assessment_questions
          (id, node_id, prompt, explanation, purpose, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'BOTH', ?, ?)
      `);
      const insertOption = this.database.prepare(`
        INSERT INTO assessment_options (id, question_id, text, is_correct, position)
        VALUES (?, ?, ?, ?, ?)
      `);
      SAMPLE_NODES.forEach((node, nodeIndex) => {
        node.questions.forEach(([prompt, correctAnswer, options, explanation]) => {
          const questionId = randomUUID();
          insertQuestion.run(questionId, nodeIds[nodeIndex], prompt, explanation, now, now);
          options.forEach((option, optionIndex) => {
            insertOption.run(randomUUID(), questionId, option, option === correctAnswer ? 1 : 0, optionIndex);
          });
        });
      });
      this.database.prepare(`
        UPDATE onboarding_state
        SET status = 'IN_PROGRESS', sample_graph_id = ?, started_at = COALESCE(started_at, ?), updated_at = ?
        WHERE id = 1
      `).run(graphId, now, now);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    const graph = this.graphRepository.load(graphId);
    if (!graph) throw new Error('示例图谱创建后无法读取');
    return { state: this.getState(), graph };
  }

  deleteSample(): OnboardingStateView {
    const current = this.getState();
    if (!current.sampleGraphId) return current;
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.prepare('DELETE FROM knowledge_graphs WHERE id = ?').run(current.sampleGraphId);
      this.database.prepare(
        'UPDATE onboarding_state SET sample_graph_id = NULL, updated_at = ? WHERE id = 1',
      ).run(now);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    return this.getState();
  }
}
