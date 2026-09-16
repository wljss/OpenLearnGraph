import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  LearningEvidenceView,
  LearningPhase,
  PracticeAnswerFeedbackView,
  PracticeAttemptSummaryView,
  PracticeAttemptView,
  PracticeMode,
  SavePracticeAnswerInput,
} from '../../shared/contracts';

interface PracticeAttemptRow {
  id: string;
  graph_id: string;
  node_id: string | null;
  source_decision_id: string | null;
  node_name_snapshot: string;
  mode: PracticeMode;
  status: PracticeAttemptView['status'];
  started_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface PracticeQuestionRow {
  id: string;
  prompt_snapshot: string;
  explanation_snapshot: string;
  options_snapshot: string;
}

interface SourceQuestionRow {
  id: string;
  prompt: string;
  explanation: string;
}

interface OptionRow {
  id: string;
  text: string;
  is_correct: number;
}

interface ResponseRow {
  attempt_question_id: string;
  selected_option_id: string | null;
  is_correct: number;
}

interface SnapshotOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

interface StateRow {
  phase: LearningPhase;
  started_at: string | null;
  latest_evidence_kind: string | null;
}

export interface NewPracticeData {
  graphId: string;
  nodeId: string;
  nodeName: string;
  mode: PracticeMode;
  sourceDecisionId?: string;
}

function parseOptions(value: string): SnapshotOption[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length < 2 || !parsed.every((option) => (
    typeof option === 'object'
    && option !== null
    && typeof option.id === 'string'
    && typeof option.text === 'string'
    && typeof option.isCorrect === 'boolean'
  ))) throw new Error('练习记录中的题目快照已损坏');
  const options = parsed as SnapshotOption[];
  if (options.filter((option) => option.isCorrect).length !== 1) {
    throw new Error('练习记录中的正确答案无效');
  }
  return options;
}

function answerFeedback(
  question: PracticeQuestionRow,
  response: ResponseRow,
): PracticeAnswerFeedbackView {
  const options = parseOptions(question.options_snapshot);
  const selected = response.selected_option_id === null
    ? null
    : options.find((option) => option.id === response.selected_option_id);
  if (response.selected_option_id !== null && !selected) throw new Error('练习记录中的答案选项无效');
  const correct = options.find((option) => option.isCorrect) as SnapshotOption;
  return {
    attemptQuestionId: question.id,
    selectedOptionId: response.selected_option_id,
    selectedOptionText: selected?.text ?? null,
    correctOptionId: correct.id,
    correctOptionText: correct.text,
    explanation: question.explanation_snapshot,
    isCorrect: Boolean(response.is_correct),
  };
}

const ATTEMPT_COLUMNS = `id, graph_id, node_id, source_decision_id, node_name_snapshot,
  mode, status, started_at, updated_at, completed_at`;

export class PracticeRepository {
  constructor(private readonly database: DatabaseSync) {}

  private readAttempt(attemptId: string): PracticeAttemptRow | null {
    const row = this.database.prepare(
      `SELECT ${ATTEMPT_COLUMNS} FROM practice_attempts WHERE id = ?`,
    ).get(attemptId) as PracticeAttemptRow | undefined;
    return row ?? null;
  }

  private listQuestions(attemptId: string): PracticeQuestionRow[] {
    return this.database.prepare(
      `SELECT id, prompt_snapshot, explanation_snapshot, options_snapshot
       FROM practice_attempt_questions
       WHERE attempt_id = ?
       ORDER BY position`,
    ).all(attemptId) as unknown as PracticeQuestionRow[];
  }

  private listResponses(attemptId: string): ResponseRow[] {
    return this.database.prepare(
      `SELECT r.attempt_question_id, r.selected_option_id, r.is_correct
       FROM practice_responses r
       JOIN practice_attempt_questions q ON q.id = r.attempt_question_id
       WHERE q.attempt_id = ?`,
    ).all(attemptId) as unknown as ResponseRow[];
  }

  list(graphId: string): PracticeAttemptSummaryView[] {
    const rows = this.database.prepare(
      `SELECT a.id, a.graph_id, a.node_id, a.node_name_snapshot, a.mode, a.status,
              a.started_at, a.completed_at,
              COUNT(DISTINCT q.id) AS question_count,
              COUNT(r.attempt_question_id) AS answered_count,
              CASE WHEN a.status = 'COMPLETED'
                THEN COALESCE(SUM(CASE WHEN r.is_correct = 1 THEN 1 ELSE 0 END), 0)
                ELSE NULL
              END AS correct_count
       FROM practice_attempts a
       LEFT JOIN practice_attempt_questions q ON q.attempt_id = a.id
       LEFT JOIN practice_responses r ON r.attempt_question_id = q.id
       WHERE a.graph_id = ?
       GROUP BY a.id
       ORDER BY a.started_at DESC, a.rowid DESC
       LIMIT 100`,
    ).all(graphId) as unknown as Array<PracticeAttemptRow & {
      question_count: number;
      answered_count: number;
      correct_count: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      graphId: row.graph_id,
      nodeId: row.node_id,
      nodeName: row.node_name_snapshot,
      mode: row.mode,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      questionCount: Number(row.question_count),
      answeredCount: Number(row.answered_count),
      correctCount: row.status === 'COMPLETED' ? Number(row.correct_count ?? 0) : null,
    }));
  }

  find(attemptId: string): PracticeAttemptView | null {
    const attempt = this.readAttempt(attemptId);
    if (!attempt) return null;
    const questions = this.listQuestions(attemptId);
    const responses = new Map(this.listResponses(attemptId).map((response) => [response.attempt_question_id, response]));
    return {
      id: attempt.id,
      graphId: attempt.graph_id,
      nodeId: attempt.node_id,
      nodeName: attempt.node_name_snapshot,
      mode: attempt.mode,
      status: attempt.status,
      sourceDecisionId: attempt.source_decision_id,
      startedAt: attempt.started_at,
      updatedAt: attempt.updated_at,
      completedAt: attempt.completed_at,
      questions: questions.map((question) => ({
        attemptQuestionId: question.id,
        prompt: question.prompt_snapshot,
        options: parseOptions(question.options_snapshot).map(({ id, text }) => ({ id, text })),
      })),
      answers: questions.flatMap((question) => {
        const response = responses.get(question.id);
        return response ? [answerFeedback(question, response)] : [];
      }),
    };
  }

  findActive(graphId: string): PracticeAttemptView | null {
    const row = this.database.prepare(
      `SELECT id FROM practice_attempts
       WHERE graph_id = ? AND status = 'IN_PROGRESS'
       LIMIT 1`,
    ).get(graphId) as { id: string } | undefined;
    return row ? this.find(row.id) : null;
  }

  create(data: NewPracticeData): PracticeAttemptView {
    const sourceQuestions = this.database.prepare(
      `SELECT id, prompt, explanation
       FROM assessment_questions
       WHERE node_id = ? AND purpose IN ('PRACTICE', 'BOTH')
       ORDER BY created_at, rowid`,
    ).all(data.nodeId) as unknown as SourceQuestionRow[];
    if (!sourceQuestions.length) throw new Error('这个概念还没有练习题，请先添加用途为“练习”或“通用”的题目');
    if (sourceQuestions.length > 100) throw new Error('一次练习最多支持 100 道题，请精简题库后重试');

    const listOptions = this.database.prepare(
      `SELECT id, text, is_correct
       FROM assessment_options
       WHERE question_id = ?
       ORDER BY position`,
    );
    const attemptId = randomUUID();
    const now = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.prepare(
        `INSERT INTO practice_attempts
         (id, graph_id, node_id, source_decision_id, node_name_snapshot, mode,
          status, started_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, NULL)`,
      ).run(
        attemptId,
        data.graphId,
        data.nodeId,
        data.sourceDecisionId ?? null,
        data.nodeName,
        data.mode,
        now,
        now,
      );
      const insertQuestion = this.database.prepare(
        `INSERT INTO practice_attempt_questions
         (id, attempt_id, question_id, position, prompt_snapshot,
          explanation_snapshot, options_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      sourceQuestions.forEach((question, position) => {
        const options = (listOptions.all(question.id) as unknown as OptionRow[]).map((option) => ({
          id: option.id,
          text: option.text,
          isCorrect: Boolean(option.is_correct),
        }));
        if (options.length < 2 || options.filter((option) => option.isCorrect).length !== 1) {
          throw new Error(`练习题“${question.prompt}”的选项配置无效`);
        }
        insertQuestion.run(
          randomUUID(),
          attemptId,
          question.id,
          position,
          question.prompt,
          question.explanation,
          JSON.stringify(options),
        );
      });
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    return this.find(attemptId) as PracticeAttemptView;
  }

  saveAnswer(input: SavePracticeAnswerInput): PracticeAnswerFeedbackView {
    const question = this.database.prepare(
      `SELECT q.id, q.prompt_snapshot, q.explanation_snapshot, q.options_snapshot, a.status
       FROM practice_attempt_questions q
       JOIN practice_attempts a ON a.id = q.attempt_id
       WHERE a.id = ? AND q.id = ?`,
    ).get(input.attemptId, input.attemptQuestionId) as (PracticeQuestionRow & {
      status: PracticeAttemptView['status'];
    }) | undefined;
    if (!question) throw new Error('练习题目不属于这次练习');
    if (question.status !== 'IN_PROGRESS') throw new Error('这次练习已经结束，无法继续作答');
    const options = parseOptions(question.options_snapshot);
    const selected = input.selectedOptionId === null
      ? null
      : options.find((option) => option.id === input.selectedOptionId);
    if (input.selectedOptionId !== null && !selected) throw new Error('答案选项不属于对应练习题');

    const existing = this.database.prepare(
      `SELECT attempt_question_id, selected_option_id, is_correct
       FROM practice_responses WHERE attempt_question_id = ?`,
    ).get(input.attemptQuestionId) as ResponseRow | undefined;
    if (existing) {
      if (existing.selected_option_id !== input.selectedOptionId) throw new Error('这道练习题已经作答，答案不能修改');
      return answerFeedback(question, existing);
    }

    const correct = options.find((option) => option.isCorrect) as SnapshotOption;
    const now = new Date().toISOString();
    const response: ResponseRow = {
      attempt_question_id: input.attemptQuestionId,
      selected_option_id: input.selectedOptionId,
      is_correct: selected?.id === correct.id ? 1 : 0,
    };
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      this.database.prepare(
        `INSERT INTO practice_responses
         (id, attempt_question_id, selected_option_id, is_correct, answered_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(randomUUID(), input.attemptQuestionId, input.selectedOptionId, response.is_correct, now);
      this.database.prepare(
        'UPDATE practice_attempts SET updated_at = ? WHERE id = ?',
      ).run(now, input.attemptId);
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
    return answerFeedback(question, response);
  }

  cancel(attemptId: string): PracticeAttemptView {
    const now = new Date().toISOString();
    const update = this.database.prepare(
      `UPDATE practice_attempts
       SET status = 'CANCELLED', updated_at = ?, completed_at = ?
       WHERE id = ? AND status = 'IN_PROGRESS'`,
    ).run(now, now, attemptId);
    if (Number(update.changes) !== 1) throw new Error('这次练习已经结束，无法放弃');
    return this.find(attemptId) as PracticeAttemptView;
  }

  complete(attemptId: string): { attempt: PracticeAttemptView; evidence: LearningEvidenceView } {
    const attempt = this.find(attemptId);
    if (!attempt || attempt.status !== 'IN_PROGRESS' || !attempt.nodeId) {
      throw new Error('这次练习已无法完成');
    }
    if (!attempt.questions.length || attempt.answers.length !== attempt.questions.length) {
      throw new Error('请完成全部练习题后再结束练习');
    }
    const correctCount = attempt.answers.filter((answer) => answer.isCorrect).length;
    const evidenceId = randomUUID();
    const now = new Date().toISOString();
    const note = attempt.mode === 'REMEDIATE'
      ? '完成针对性补强练习'
      : attempt.mode === 'REVIEW' ? '完成回顾练习' : '完成形成性练习';

    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const state = this.database.prepare(
        `SELECT s.phase, s.started_at, e.kind AS latest_evidence_kind
         FROM learner_node_states s
         LEFT JOIN learning_evidence e ON e.id = s.latest_evidence_id
         WHERE s.node_id = ?`,
      ).get(attempt.nodeId) as StateRow | undefined;
      this.database.prepare(
        `INSERT INTO learning_evidence
         (id, node_id, kind, rating, score_earned, score_possible,
          assessment_attempt_id, learning_session_id, practice_attempt_id, note, occurred_at)
         VALUES (?, ?, 'PRACTICE_RESULT', NULL, ?, ?, NULL, NULL, ?, ?, ?)`,
      ).run(evidenceId, attempt.nodeId, correctCount, attempt.questions.length, attempt.id, note, now);

      const preservesMastery = state?.phase === 'MASTERED';
      const preservesDiagnostic = state?.latest_evidence_kind === 'DIAGNOSTIC_RESULT';
      if (!preservesMastery && !preservesDiagnostic) {
        this.database.prepare(
          `INSERT INTO learner_node_states
           (node_id, phase, started_at, mastered_at, updated_at, latest_evidence_id)
           VALUES (?, 'LEARNING', ?, NULL, ?, ?)
           ON CONFLICT(node_id) DO UPDATE SET
             phase = 'LEARNING',
             started_at = COALESCE(learner_node_states.started_at, excluded.started_at),
             mastered_at = NULL,
             updated_at = excluded.updated_at,
             latest_evidence_id = excluded.latest_evidence_id`,
        ).run(attempt.nodeId, state?.started_at ?? now, now, evidenceId);
      }
      const update = this.database.prepare(
        `UPDATE practice_attempts
         SET status = 'COMPLETED', updated_at = ?, completed_at = ?
         WHERE id = ? AND status = 'IN_PROGRESS'`,
      ).run(now, now, attempt.id);
      if (Number(update.changes) !== 1) throw new Error('练习状态已发生变化，请勿重复完成');
      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }

    return {
      attempt: this.find(attempt.id) as PracticeAttemptView,
      evidence: {
        id: evidenceId,
        nodeId: attempt.nodeId,
        kind: 'PRACTICE_RESULT',
        rating: null,
        note,
        occurredAt: now,
        scoreEarned: correctCount,
        scorePossible: attempt.questions.length,
        assessmentAttemptId: null,
        learningSessionId: null,
        practiceAttemptId: attempt.id,
      },
    };
  }
}
