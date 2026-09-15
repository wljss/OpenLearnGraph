import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AssessmentQuestionView,
  CompleteDiagnosticInput,
  DiagnosticAttemptView,
  DiagnosticNodeResult,
  DiagnosticQuestionResult,
  LearningEvidenceView,
  SaveAssessmentQuestionInput,
} from '../../shared/contracts';

interface QuestionRow {
  id: string;
  node_id: string;
  prompt: string;
  explanation: string;
  created_at: string;
  updated_at: string;
}

interface OptionRow {
  id: string;
  question_id: string;
  text: string;
  is_correct: number;
}

interface DiagnosticSourceRow extends QuestionRow {
  node_name: string;
}

interface AttemptRow {
  id: string;
  graph_id: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  started_at: string;
}

interface AttemptQuestionRow {
  id: string;
  node_id: string;
  node_name_snapshot: string;
  prompt_snapshot: string;
  explanation_snapshot: string;
  options_snapshot: string;
}

interface StateRow {
  phase: 'NOT_STARTED' | 'LEARNING' | 'MASTERED';
  started_at: string | null;
  mastered_at: string | null;
}

interface SnapshotOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface CompletedDiagnosticData {
  attemptId: string;
  graphId: string;
  completedAt: string;
  correctCount: number;
  questionCount: number;
  nodeResults: DiagnosticNodeResult[];
  questionResults: DiagnosticQuestionResult[];
  evidence: LearningEvidenceView[];
}

function parseSnapshotOptions(value: string): SnapshotOption[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length < 2 || !parsed.every((option) => (
    typeof option === 'object'
    && option !== null
    && typeof option.id === 'string'
    && typeof option.text === 'string'
    && typeof option.isCorrect === 'boolean'
  ))) {
    throw new Error('诊断记录中的题目快照已损坏');
  }
  const options = parsed as SnapshotOption[];
  if (options.filter((option) => option.isCorrect).length !== 1) {
    throw new Error('诊断记录中的正确答案无效');
  }
  return options;
}

export class AssessmentRepository {
  constructor(private readonly database: DatabaseSync) {}

  findNodeIdForQuestion(questionId: string): string | null {
    const row = this.database.prepare(
      'SELECT node_id FROM assessment_questions WHERE id = ?',
    ).get(questionId) as { node_id: string } | undefined;
    return row?.node_id ?? null;
  }

  listQuestions(nodeId: string): AssessmentQuestionView[] {
    const questionRows = this.database.prepare(
      `SELECT id, node_id, prompt, explanation, created_at, updated_at
       FROM assessment_questions
       WHERE node_id = ?
       ORDER BY created_at, rowid`,
    ).all(nodeId) as unknown as QuestionRow[];
    const listOptions = this.database.prepare(
      `SELECT id, question_id, text, is_correct
       FROM assessment_options
       WHERE question_id = ?
       ORDER BY position`,
    );
    return questionRows.map((question) => {
      const options = listOptions.all(question.id) as unknown as OptionRow[];
      return {
        id: question.id,
        nodeId: question.node_id,
        prompt: question.prompt,
        explanation: question.explanation,
        options: options.map((option) => ({
          id: option.id,
          text: option.text,
          isCorrect: Boolean(option.is_correct),
        })),
        createdAt: question.created_at,
        updatedAt: question.updated_at,
      };
    });
  }

  saveQuestion(input: SaveAssessmentQuestionInput): AssessmentQuestionView {
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      if (input.id) {
        const update = this.database.prepare(
          `UPDATE assessment_questions
           SET prompt = ?, explanation = ?, updated_at = ?
           WHERE id = ? AND node_id = ?`,
        ).run(input.prompt, input.explanation, now, id, input.nodeId);
        if (Number(update.changes) !== 1) throw new Error('要修改的诊断题不存在');
        this.database.prepare('DELETE FROM assessment_options WHERE question_id = ?').run(id);
      } else {
        this.database.prepare(
          `INSERT INTO assessment_questions
           (id, node_id, prompt, explanation, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, input.nodeId, input.prompt, input.explanation, now, now);
      }
      const insertOption = this.database.prepare(
        `INSERT INTO assessment_options
         (id, question_id, text, is_correct, position)
         VALUES (?, ?, ?, ?, ?)`,
      );
      input.options.forEach((option, position) => {
        insertOption.run(randomUUID(), id, option.text, option.isCorrect ? 1 : 0, position);
      });
      this.database.prepare(
        `UPDATE knowledge_graphs
         SET updated_at = ?
         WHERE id = (SELECT graph_id FROM knowledge_nodes WHERE id = ?)`,
      ).run(now, input.nodeId);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    const saved = this.listQuestions(input.nodeId).find((question) => question.id === id);
    if (!saved) throw new Error('诊断题保存后无法重新读取');
    return saved;
  }

  deleteQuestion(questionId: string): void {
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const node = this.database.prepare(
        'SELECT node_id FROM assessment_questions WHERE id = ?',
      ).get(questionId) as { node_id: string } | undefined;
      if (!node) throw new Error('要删除的诊断题不存在');
      this.database.prepare('DELETE FROM assessment_questions WHERE id = ?').run(questionId);
      this.database.prepare(
        `UPDATE knowledge_graphs
         SET updated_at = ?
         WHERE id = (SELECT graph_id FROM knowledge_nodes WHERE id = ?)`,
      ).run(now, node.node_id);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  startDiagnostic(graphId: string): DiagnosticAttemptView {
    const rows = this.database.prepare(
      `SELECT q.id, q.node_id, q.prompt, q.explanation, q.created_at, q.updated_at,
              n.name AS node_name
       FROM assessment_questions q
       JOIN knowledge_nodes n ON n.id = q.node_id
       WHERE n.graph_id = ?
         AND (SELECT COUNT(*) FROM assessment_questions covered WHERE covered.node_id = n.id) >= 2
       ORDER BY n.created_at, q.created_at, q.rowid`,
    ).all(graphId) as unknown as DiagnosticSourceRow[];
    if (!rows.length) throw new Error('至少需要为一个概念准备 2 道诊断题');
    if (rows.length > 500) throw new Error('一次诊断最多支持 500 道题，请精简题库后重试');

    const attemptId = randomUUID();
    const startedAt = new Date().toISOString();
    const listOptions = this.database.prepare(
      `SELECT id, question_id, text, is_correct
       FROM assessment_options
       WHERE question_id = ?
       ORDER BY position`,
    );
    const attemptQuestions: DiagnosticAttemptView['questions'] = [];
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.prepare(
        `INSERT INTO assessment_attempts
         (id, graph_id, kind, status, started_at, completed_at)
         VALUES (?, ?, 'DIAGNOSTIC', 'IN_PROGRESS', ?, NULL)`,
      ).run(attemptId, graphId, startedAt);
      const insertSnapshot = this.database.prepare(
        `INSERT INTO assessment_attempt_questions
         (id, attempt_id, question_id, node_id, position, node_name_snapshot,
          prompt_snapshot, explanation_snapshot, options_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      rows.forEach((question, position) => {
        const optionRows = listOptions.all(question.id) as unknown as OptionRow[];
        const options: SnapshotOption[] = optionRows.map((option) => ({
          id: option.id,
          text: option.text,
          isCorrect: Boolean(option.is_correct),
        }));
        if (options.length < 2 || options.filter((option) => option.isCorrect).length !== 1) {
          throw new Error(`诊断题“${question.prompt}”的选项配置无效`);
        }
        const attemptQuestionId = randomUUID();
        insertSnapshot.run(
          attemptQuestionId,
          attemptId,
          question.id,
          question.node_id,
          position,
          question.node_name,
          question.prompt,
          question.explanation,
          JSON.stringify(options),
        );
        attemptQuestions.push({
          attemptQuestionId,
          nodeId: question.node_id,
          nodeName: question.node_name,
          prompt: question.prompt,
          options: options.map(({ id, text }) => ({ id, text })),
        });
      });
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    return { id: attemptId, graphId, startedAt, questions: attemptQuestions };
  }

  cancelDiagnostic(attemptId: string): void {
    const cancelledAt = new Date().toISOString();
    const update = this.database.prepare(
      `UPDATE assessment_attempts
       SET status = 'CANCELLED', completed_at = ?
       WHERE id = ? AND status = 'IN_PROGRESS'`,
    ).run(cancelledAt, attemptId);
    if (Number(update.changes) !== 1) throw new Error('这次诊断已经结束，无法取消');
  }

  completeDiagnostic(input: CompleteDiagnosticInput): CompletedDiagnosticData {
    const attempt = this.database.prepare(
      `SELECT id, graph_id, status, started_at
       FROM assessment_attempts WHERE id = ?`,
    ).get(input.attemptId) as AttemptRow | undefined;
    if (!attempt) throw new Error('要提交的诊断不存在');
    if (attempt.status !== 'IN_PROGRESS') throw new Error('这次诊断已经提交，不能重复作答');
    const questions = this.database.prepare(
      `SELECT id, node_id, node_name_snapshot, prompt_snapshot,
              explanation_snapshot, options_snapshot
       FROM assessment_attempt_questions
       WHERE attempt_id = ?
       ORDER BY position`,
    ).all(input.attemptId) as unknown as AttemptQuestionRow[];
    if (input.answers.length !== questions.length) throw new Error('请回答全部题目后再提交诊断');
    const answersByQuestion = new Map(input.answers.map((answer) => [answer.attemptQuestionId, answer]));
    if (questions.some((question) => !answersByQuestion.has(question.id))) {
      throw new Error('提交的答案与本次诊断题目不匹配');
    }

    const prepared = questions.map((question) => {
      const options = parseSnapshotOptions(question.options_snapshot);
      const answer = answersByQuestion.get(question.id) as CompleteDiagnosticInput['answers'][number];
      const selected = answer.selectedOptionId === null
        ? null
        : options.find((option) => option.id === answer.selectedOptionId);
      if (answer.selectedOptionId !== null && !selected) throw new Error('提交的答案选项不属于对应题目');
      const correct = options.find((option) => option.isCorrect) as SnapshotOption;
      return { question, answer, selected, correct, isCorrect: selected?.id === correct.id };
    });

    const completedAt = new Date().toISOString();
    const nodeAggregates = new Map<string, { nodeName: string; correct: number; total: number }>();
    for (const item of prepared) {
      const aggregate = nodeAggregates.get(item.question.node_id) ?? {
        nodeName: item.question.node_name_snapshot,
        correct: 0,
        total: 0,
      };
      aggregate.total += 1;
      if (item.isCorrect) aggregate.correct += 1;
      nodeAggregates.set(item.question.node_id, aggregate);
    }

    const evidence: LearningEvidenceView[] = [];
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const insertResponse = this.database.prepare(
        `INSERT INTO assessment_responses
         (id, attempt_question_id, selected_option_id, is_correct, answered_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const item of prepared) {
        insertResponse.run(
          randomUUID(),
          item.question.id,
          item.answer.selectedOptionId,
          item.isCorrect ? 1 : 0,
          completedAt,
        );
      }

      const readState = this.database.prepare(
        `SELECT phase, started_at, mastered_at
         FROM learner_node_states WHERE node_id = ?`,
      );
      const insertEvidence = this.database.prepare(
        `INSERT INTO learning_evidence
         (id, node_id, kind, rating, score_earned, score_possible,
          assessment_attempt_id, note, occurred_at)
         VALUES (?, ?, 'DIAGNOSTIC_RESULT', NULL, ?, ?, ?, '', ?)`,
      );
      const upsertState = this.database.prepare(
        `INSERT INTO learner_node_states
         (node_id, phase, started_at, mastered_at, updated_at, latest_evidence_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET
           phase = excluded.phase,
           started_at = COALESCE(learner_node_states.started_at, excluded.started_at),
           mastered_at = excluded.mastered_at,
           updated_at = excluded.updated_at,
           latest_evidence_id = excluded.latest_evidence_id`,
      );
      for (const [nodeId, aggregate] of nodeAggregates) {
        const id = randomUUID();
        const passed = aggregate.total >= 2 && aggregate.correct / aggregate.total >= 0.8;
        const existing = readState.get(nodeId) as StateRow | undefined;
        const phase = passed ? 'MASTERED' : 'LEARNING';
        const startedAt = existing?.started_at ?? completedAt;
        const masteredAt = passed
          ? (existing?.phase === 'MASTERED' ? existing.mastered_at ?? completedAt : completedAt)
          : null;
        insertEvidence.run(id, nodeId, aggregate.correct, aggregate.total, input.attemptId, completedAt);
        upsertState.run(nodeId, phase, startedAt, masteredAt, completedAt, id);
        evidence.push({
          id,
          nodeId,
          kind: 'DIAGNOSTIC_RESULT',
          rating: null,
          note: '',
          occurredAt: completedAt,
          scoreEarned: aggregate.correct,
          scorePossible: aggregate.total,
          assessmentAttemptId: input.attemptId,
        });
      }
      const complete = this.database.prepare(
        `UPDATE assessment_attempts
         SET status = 'COMPLETED', completed_at = ?
         WHERE id = ? AND status = 'IN_PROGRESS'`,
      ).run(completedAt, input.attemptId);
      if (Number(complete.changes) !== 1) throw new Error('诊断状态已发生变化，请勿重复提交');
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }

    const nodeResults: DiagnosticNodeResult[] = Array.from(nodeAggregates, ([nodeId, aggregate]) => ({
      nodeId,
      nodeName: aggregate.nodeName,
      correctCount: aggregate.correct,
      questionCount: aggregate.total,
      passed: aggregate.total >= 2 && aggregate.correct / aggregate.total >= 0.8,
    }));
    const questionResults: DiagnosticQuestionResult[] = prepared.map((item) => ({
      attemptQuestionId: item.question.id,
      nodeId: item.question.node_id,
      nodeName: item.question.node_name_snapshot,
      prompt: item.question.prompt_snapshot,
      selectedOptionText: item.selected?.text ?? null,
      correctOptionText: item.correct.text,
      explanation: item.question.explanation_snapshot,
      isCorrect: item.isCorrect,
    }));
    return {
      attemptId: input.attemptId,
      graphId: attempt.graph_id,
      completedAt,
      correctCount: questionResults.filter((result) => result.isCorrect).length,
      questionCount: questionResults.length,
      nodeResults,
      questionResults,
      evidence,
    };
  }
}
