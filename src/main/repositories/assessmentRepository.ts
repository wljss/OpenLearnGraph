import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AssessmentQuestionView,
  CompleteDiagnosticInput,
  DiagnosticAttemptSummaryView,
  DiagnosticAttemptView,
  DiagnosticNodeResult,
  DiagnosticQuestionResult,
  DiagnosticReviewView,
  LearningEvidenceView,
  ResumableDiagnosticAttemptView,
  SaveAssessmentQuestionInput,
  SaveDiagnosticAnswerInput,
  StartDiagnosticInput,
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
  completed_at: string | null;
}

interface AttemptSummaryRow extends AttemptRow {
  question_count: number;
  answered_count: number;
  correct_count: number | null;
  node_count: number;
}

interface AttemptQuestionRow {
  id: string;
  node_id: string;
  node_name_snapshot: string;
  prompt_snapshot: string;
  explanation_snapshot: string;
  options_snapshot: string;
}

interface ResponseRow {
  attempt_question_id: string;
  selected_option_id: string | null;
  is_correct: number;
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

export interface CompletedDiagnosticData extends DiagnosticReviewView {
  graphId: string;
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

function toQuestionView(question: AttemptQuestionRow): DiagnosticAttemptView['questions'][number] {
  return {
    attemptQuestionId: question.id,
    nodeId: question.node_id,
    nodeName: question.node_name_snapshot,
    prompt: question.prompt_snapshot,
    options: parseSnapshotOptions(question.options_snapshot).map(({ id, text }) => ({ id, text })),
  };
}

function buildReview(
  attempt: AttemptRow,
  questions: AttemptQuestionRow[],
  responses: ResponseRow[],
): DiagnosticReviewView {
  if (!attempt.completed_at) throw new Error('诊断记录缺少完成时间');
  const responsesByQuestion = new Map(responses.map((response) => [response.attempt_question_id, response]));
  if (questions.some((question) => !responsesByQuestion.has(question.id))) {
    throw new Error('诊断记录中的作答不完整');
  }

  const nodeAggregates = new Map<string, { nodeName: string; correct: number; total: number }>();
  const questionResults: DiagnosticQuestionResult[] = questions.map((question) => {
    const options = parseSnapshotOptions(question.options_snapshot);
    const response = responsesByQuestion.get(question.id) as ResponseRow;
    const selected = response.selected_option_id === null
      ? null
      : options.find((option) => option.id === response.selected_option_id);
    if (response.selected_option_id !== null && !selected) {
      throw new Error('诊断记录中的答案选项无效');
    }
    const correct = options.find((option) => option.isCorrect) as SnapshotOption;
    const isCorrect = selected?.id === correct.id;
    const aggregate = nodeAggregates.get(question.node_id) ?? {
      nodeName: question.node_name_snapshot,
      correct: 0,
      total: 0,
    };
    aggregate.total += 1;
    if (isCorrect) aggregate.correct += 1;
    nodeAggregates.set(question.node_id, aggregate);
    return {
      attemptQuestionId: question.id,
      nodeId: question.node_id,
      nodeName: question.node_name_snapshot,
      prompt: question.prompt_snapshot,
      selectedOptionText: selected?.text ?? null,
      correctOptionText: correct.text,
      explanation: question.explanation_snapshot,
      isCorrect,
    };
  });

  const nodeResults: DiagnosticNodeResult[] = Array.from(nodeAggregates, ([nodeId, aggregate]) => ({
    nodeId,
    nodeName: aggregate.nodeName,
    correctCount: aggregate.correct,
    questionCount: aggregate.total,
    passed: aggregate.total >= 2 && aggregate.correct / aggregate.total >= 0.8,
  }));
  return {
    attemptId: attempt.id,
    startedAt: attempt.started_at,
    completedAt: attempt.completed_at,
    correctCount: questionResults.filter((result) => result.isCorrect).length,
    questionCount: questionResults.length,
    nodeResults,
    questionResults,
  };
}

export class AssessmentRepository {
  constructor(private readonly database: DatabaseSync) {}

  private readAttempt(attemptId: string): AttemptRow | null {
    const row = this.database.prepare(
      `SELECT id, graph_id, status, started_at, completed_at
       FROM assessment_attempts WHERE id = ?`,
    ).get(attemptId) as AttemptRow | undefined;
    return row ?? null;
  }

  private listAttemptQuestions(attemptId: string): AttemptQuestionRow[] {
    return this.database.prepare(
      `SELECT id, node_id, node_name_snapshot, prompt_snapshot,
              explanation_snapshot, options_snapshot
       FROM assessment_attempt_questions
       WHERE attempt_id = ?
       ORDER BY position`,
    ).all(attemptId) as unknown as AttemptQuestionRow[];
  }

  private listResponses(attemptId: string): ResponseRow[] {
    return this.database.prepare(
      `SELECT r.attempt_question_id, r.selected_option_id, r.is_correct
       FROM assessment_responses r
       JOIN assessment_attempt_questions q ON q.id = r.attempt_question_id
       WHERE q.attempt_id = ?`,
    ).all(attemptId) as unknown as ResponseRow[];
  }

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

  listDiagnosticAttempts(graphId: string): DiagnosticAttemptSummaryView[] {
    const rows = this.database.prepare(
      `SELECT a.id, a.graph_id, a.status, a.started_at, a.completed_at,
              COUNT(DISTINCT q.id) AS question_count,
              COUNT(r.attempt_question_id) AS answered_count,
              CASE WHEN a.status = 'COMPLETED'
                THEN COALESCE(SUM(CASE WHEN r.is_correct = 1 THEN 1 ELSE 0 END), 0)
                ELSE NULL
              END AS correct_count,
              COUNT(DISTINCT q.node_id) AS node_count
       FROM assessment_attempts a
       LEFT JOIN assessment_attempt_questions q ON q.attempt_id = a.id
       LEFT JOIN assessment_responses r ON r.attempt_question_id = q.id
       WHERE a.graph_id = ?
       GROUP BY a.id
       ORDER BY a.started_at DESC, a.rowid DESC
       LIMIT 100`,
    ).all(graphId) as unknown as AttemptSummaryRow[];
    return rows.map((row) => ({
      id: row.id,
      graphId: row.graph_id,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      questionCount: Number(row.question_count),
      answeredCount: Number(row.answered_count),
      correctCount: row.status === 'COMPLETED' ? Number(row.correct_count ?? 0) : null,
      nodeCount: Number(row.node_count),
    }));
  }

  startDiagnostic(input: StartDiagnosticInput): DiagnosticAttemptView {
    const activeLearningSession = this.database.prepare(
      `SELECT id FROM learning_sessions
       WHERE graph_id = ? AND status = 'IN_PROGRESS'
       LIMIT 1`,
    ).get(input.graphId) as { id: string } | undefined;
    if (activeLearningSession) throw new Error('当前图谱有未完成的学习会话，请先继续或放弃后再开始诊断');

    const active = this.database.prepare(
      `SELECT id FROM assessment_attempts
       WHERE graph_id = ? AND status = 'IN_PROGRESS'
       LIMIT 1`,
    ).get(input.graphId) as { id: string } | undefined;
    if (active) throw new Error('当前图谱有未完成的诊断，请先继续或放弃后再开始');

    const placeholders = input.nodeIds.map(() => '?').join(', ');
    const coverage = this.database.prepare(
      `SELECT n.id, COUNT(q.id) AS question_count
       FROM knowledge_nodes n
       LEFT JOIN assessment_questions q ON q.node_id = n.id
       WHERE n.graph_id = ? AND n.id IN (${placeholders})
       GROUP BY n.id`,
    ).all(input.graphId, ...input.nodeIds) as unknown as Array<{ id: string; question_count: number }>;
    if (coverage.length !== input.nodeIds.length) throw new Error('所选诊断概念不属于当前图谱');
    if (coverage.some((node) => Number(node.question_count) < 2)) {
      throw new Error('每个所选概念至少需要 2 道诊断题');
    }

    const rows = this.database.prepare(
      `SELECT q.id, q.node_id, q.prompt, q.explanation, q.created_at, q.updated_at,
              n.name AS node_name
       FROM assessment_questions q
       JOIN knowledge_nodes n ON n.id = q.node_id
       WHERE n.graph_id = ? AND n.id IN (${placeholders})
       ORDER BY n.created_at, q.created_at, q.rowid`,
    ).all(input.graphId, ...input.nodeIds) as unknown as DiagnosticSourceRow[];
    if (!rows.length) throw new Error('至少需要为一个概念准备 2 道诊断题');
    if (rows.length > 500) throw new Error('一次诊断最多支持 500 道题，请减少所选概念后重试');

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
      ).run(attemptId, input.graphId, startedAt);
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
    return { id: attemptId, graphId: input.graphId, startedAt, questions: attemptQuestions };
  }

  resumeDiagnostic(attemptId: string): ResumableDiagnosticAttemptView {
    const attempt = this.readAttempt(attemptId);
    if (!attempt) throw new Error('要继续的诊断不存在');
    if (attempt.status !== 'IN_PROGRESS') throw new Error('这次诊断已经结束，无法继续');
    const questions = this.listAttemptQuestions(attemptId);
    if (!questions.length) throw new Error('这次诊断没有可继续作答的题目');
    const responses = this.listResponses(attemptId);
    return {
      id: attempt.id,
      graphId: attempt.graph_id,
      startedAt: attempt.started_at,
      questions: questions.map(toQuestionView),
      answers: responses.map((response) => ({
        attemptQuestionId: response.attempt_question_id,
        selectedOptionId: response.selected_option_id,
      })),
    };
  }

  saveDiagnosticAnswer(input: SaveDiagnosticAnswerInput): void {
    const row = this.database.prepare(
      `SELECT a.status, q.options_snapshot
       FROM assessment_attempts a
       JOIN assessment_attempt_questions q ON q.attempt_id = a.id
       WHERE a.id = ? AND q.id = ?`,
    ).get(input.attemptId, input.attemptQuestionId) as {
      status: AttemptRow['status'];
      options_snapshot: string;
    } | undefined;
    if (!row) throw new Error('作答题目不属于这次诊断');
    if (row.status !== 'IN_PROGRESS') throw new Error('这次诊断已经结束，无法修改答案');
    const options = parseSnapshotOptions(row.options_snapshot);
    const selected = input.selectedOptionId === null
      ? null
      : options.find((option) => option.id === input.selectedOptionId);
    if (input.selectedOptionId !== null && !selected) throw new Error('答案选项不属于对应题目');
    const correct = options.find((option) => option.isCorrect) as SnapshotOption;
    const answeredAt = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO assessment_responses
       (id, attempt_question_id, selected_option_id, is_correct, answered_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(attempt_question_id) DO UPDATE SET
         selected_option_id = excluded.selected_option_id,
         is_correct = excluded.is_correct,
         answered_at = excluded.answered_at`,
    ).run(
      randomUUID(),
      input.attemptQuestionId,
      input.selectedOptionId,
      selected?.id === correct.id ? 1 : 0,
      answeredAt,
    );
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

  getDiagnosticResult(attemptId: string): DiagnosticReviewView {
    const attempt = this.readAttempt(attemptId);
    if (!attempt) throw new Error('要查看的诊断不存在');
    if (attempt.status !== 'COMPLETED') throw new Error('只有已完成的诊断可以查看结果');
    return buildReview(attempt, this.listAttemptQuestions(attemptId), this.listResponses(attemptId));
  }

  completeDiagnostic(input: CompleteDiagnosticInput): CompletedDiagnosticData {
    const attempt = this.readAttempt(input.attemptId);
    if (!attempt) throw new Error('要提交的诊断不存在');
    if (attempt.status !== 'IN_PROGRESS') throw new Error('这次诊断已经提交，不能重复作答');
    const questions = this.listAttemptQuestions(input.attemptId);
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
      return { question, answer, isCorrect: selected?.id === correct.id };
    });

    const completedAt = new Date().toISOString();
    const nodeAggregates = new Map<string, { correct: number; total: number }>();
    for (const item of prepared) {
      const aggregate = nodeAggregates.get(item.question.node_id) ?? { correct: 0, total: 0 };
      aggregate.total += 1;
      if (item.isCorrect) aggregate.correct += 1;
      nodeAggregates.set(item.question.node_id, aggregate);
    }

    const evidence: LearningEvidenceView[] = [];
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const upsertResponse = this.database.prepare(
        `INSERT INTO assessment_responses
         (id, attempt_question_id, selected_option_id, is_correct, answered_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(attempt_question_id) DO UPDATE SET
           selected_option_id = excluded.selected_option_id,
           is_correct = excluded.is_correct,
           answered_at = excluded.answered_at`,
      );
      for (const item of prepared) {
        upsertResponse.run(
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
          learningSessionId: null,
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

    const review = buildReview(
      { ...attempt, status: 'COMPLETED', completed_at: completedAt },
      questions,
      this.listResponses(input.attemptId),
    );
    return { ...review, graphId: attempt.graph_id, evidence };
  }
}
