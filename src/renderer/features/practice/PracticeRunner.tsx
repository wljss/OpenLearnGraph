import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  KnowledgeGraphDocument,
  PracticeAttemptSummaryView,
  PracticeAttemptView,
  PracticeMode,
} from '../../../shared/contracts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorMessage } from '../../errorMessage';

export interface PracticeLaunch {
  attemptId?: string;
  nodeId?: string;
  mode?: PracticeMode;
  sourceDecisionId?: string;
}

interface PracticeRunnerProps {
  graph: KnowledgeGraphDocument;
  launch: PracticeLaunch;
  onClose: () => void;
  onGraphUpdated: (graph: KnowledgeGraphDocument) => void;
  onPracticeChanged: () => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

const MODE_LABELS: Record<PracticeMode, string> = {
  PRACTICE: '形成性练习',
  REMEDIATE: '针对性补强',
  REVIEW: '回顾练习',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function statusLabel(status: PracticeAttemptView['status']): string {
  if (status === 'IN_PROGRESS') return '进行中';
  if (status === 'COMPLETED') return '已完成';
  return '已取消';
}

export function PracticeRunner({
  graph,
  launch,
  onClose,
  onGraphUpdated,
  onPracticeChanged,
  onMessage,
}: PracticeRunnerProps): React.JSX.Element {
  const [attempt, setAttempt] = useState<PracticeAttemptView | null>(null);
  const [history, setHistory] = useState<PracticeAttemptSummaryView[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cancelConfirmation, setCancelConfirmation] = useState(false);

  const applyAttempt = useCallback((next: PracticeAttemptView): void => {
    setAttempt(next);
    const answered = new Set(next.answers.map((answer) => answer.attemptQuestionId));
    const firstUnanswered = next.questions.findIndex((question) => !answered.has(question.attemptQuestionId));
    setCurrentIndex(firstUnanswered >= 0 ? firstUnanswered : Math.max(0, next.questions.length - 1));
  }, []);

  const refreshHistory = useCallback(async (): Promise<void> => {
    setHistory(await window.openLearnGraph.practice.list(graph.id));
  }, [graph.id]);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        let next: PracticeAttemptView | null;
        if (launch.attemptId) {
          next = await window.openLearnGraph.practice.get(launch.attemptId);
        } else if (launch.nodeId && launch.mode) {
          next = await window.openLearnGraph.practice.start({
            graphId: graph.id,
            nodeId: launch.nodeId,
            mode: launch.mode,
            ...(launch.sourceDecisionId ? { sourceDecisionId: launch.sourceDecisionId } : {}),
          });
          onPracticeChanged();
        } else {
          next = await window.openLearnGraph.practice.getActive(graph.id);
        }
        const items = await window.openLearnGraph.practice.list(graph.id);
        if (active) {
          if (next) applyAttempt(next);
          setHistory(items);
        }
      } catch (error) {
        if (active) onMessage(`练习打开失败：${errorMessage(error)}`, 'error');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [applyAttempt, graph.id, launch.attemptId, launch.mode, launch.nodeId, launch.sourceDecisionId, onMessage, onPracticeChanged]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || cancelConfirmation || busy) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, cancelConfirmation, onClose]);

  const currentQuestion = attempt?.questions[currentIndex] ?? null;
  const currentAnswer = useMemo(() => (
    currentQuestion
      ? attempt?.answers.find((answer) => answer.attemptQuestionId === currentQuestion.attemptQuestionId) ?? null
      : null
  ), [attempt?.answers, currentQuestion]);
  const correctCount = attempt?.answers.filter((answer) => answer.isCorrect).length ?? 0;

  const answerQuestion = async (selectedOptionId: string | null): Promise<void> => {
    if (!attempt || !currentQuestion || currentAnswer || busy) return;
    setBusy(true);
    try {
      const answer = await window.openLearnGraph.practice.saveAnswer({
        attemptId: attempt.id,
        attemptQuestionId: currentQuestion.attemptQuestionId,
        selectedOptionId,
      });
      setAttempt((current) => current ? {
        ...current,
        answers: [...current.answers.filter((item) => item.attemptQuestionId !== answer.attemptQuestionId), answer],
      } : current);
      onMessage(answer.isCorrect ? '回答正确。先阅读解析，再继续下一题。' : '答案已保存。请查看正确答案和解析。', answer.isCorrect ? 'success' : 'info');
    } catch (error) {
      onMessage(`练习答案保存失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const completePractice = async (): Promise<void> => {
    if (!attempt || attempt.answers.length !== attempt.questions.length) return;
    setBusy(true);
    try {
      const result = await window.openLearnGraph.practice.complete(attempt.id);
      applyAttempt(result.attempt);
      onGraphUpdated(result.graph);
      onPracticeChanged();
      await refreshHistory().catch(() => undefined);
      onMessage('练习已完成并写入形成性证据；掌握状态仍由自评或客观诊断确认。', 'success');
    } catch (error) {
      onMessage(`练习完成失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelPractice = async (): Promise<void> => {
    if (!attempt) return;
    setCancelConfirmation(false);
    setBusy(true);
    try {
      const cancelled = await window.openLearnGraph.practice.cancel(attempt.id);
      applyAttempt(cancelled);
      onPracticeChanged();
      await refreshHistory().catch(() => undefined);
      onMessage('练习已取消，没有生成学习证据。');
    } catch (error) {
      onMessage(`练习取消失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (item: PracticeAttemptSummaryView): Promise<void> => {
    setBusy(true);
    try {
      applyAttempt(await window.openLearnGraph.practice.get(item.id));
    } catch (error) {
      onMessage(`练习记录打开失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className="dialog-backdrop assessment-backdrop"
        role="presentation"
        onMouseDown={() => {
          if (!busy && !cancelConfirmation) onClose();
        }}
      >
        <section
          className={`practice-runner ${attempt?.status === 'IN_PROGRESS'
            ? 'practice-runner-active'
            : attempt ? 'practice-runner-result' : 'practice-runner-history'}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="practice-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {loading ? <p className="session-loading">正在恢复练习……</p> : attempt ? (
            <>
              <header className="assessment-modal-header practice-header">
                <div>
                  <span className="modal-kicker">{MODE_LABELS[attempt.mode]} · {statusLabel(attempt.status)}</span>
                  <h2 id="practice-title">{attempt.nodeName}</h2>
                  <p>开始于 {formatDate(attempt.startedAt)} · 题目按开始时的快照保存</p>
                </div>
                <div className="session-header-actions">
                  {attempt.status === 'IN_PROGRESS' && (
                    <button className="text-danger-button" type="button" disabled={busy} onClick={() => setCancelConfirmation(true)}>放弃</button>
                  )}
                  <button className="modal-close" type="button" aria-label="关闭练习" disabled={busy} onClick={onClose}>×</button>
                </div>
              </header>

              {attempt.status === 'IN_PROGRESS' && currentQuestion ? (
                <div className="practice-active-view">
                  <div className="practice-progress-row">
                    <strong>第 {currentIndex + 1} / {attempt.questions.length} 题</strong>
                    <span>{attempt.answers.length} 题已作答 · {correctCount} 题正确</span>
                  </div>
                  <div className="diagnostic-progress-track" role="progressbar" aria-label="练习进度" aria-valuemin={1} aria-valuemax={attempt.questions.length} aria-valuenow={currentIndex + 1}>
                    <span style={{ width: `${((currentIndex + 1) / attempt.questions.length) * 100}%` }} />
                  </div>
                  <main className="practice-question">
                    <span className="session-section-label">先独立作答，再查看反馈</span>
                    <h3>{currentQuestion.prompt}</h3>
                    <div className="practice-options" role="group" aria-label="练习答案选项">
                      {currentQuestion.options.map((option) => {
                        const selected = currentAnswer?.selectedOptionId === option.id;
                        const correct = currentAnswer?.correctOptionId === option.id;
                        const className = currentAnswer
                          ? correct ? 'correct' : selected ? 'incorrect' : ''
                          : '';
                        return (
                          <button
                            key={option.id}
                            className={className}
                            type="button"
                            disabled={busy || Boolean(currentAnswer)}
                            onClick={() => void answerQuestion(option.id)}
                          >
                            <span>{correct ? '✓' : selected ? '×' : ''}</span>{option.text}
                          </button>
                        );
                      })}
                      <button
                        className={currentAnswer?.selectedOptionId === null ? 'incorrect unknown' : 'unknown'}
                        type="button"
                        disabled={busy || Boolean(currentAnswer)}
                        onClick={() => void answerQuestion(null)}
                      >我不知道</button>
                    </div>
                    {currentAnswer && (
                      <section className={`practice-feedback ${currentAnswer.isCorrect ? 'correct' : 'incorrect'}`} aria-live="polite">
                        <strong>{currentAnswer.isCorrect ? '回答正确' : '这次没有答对'}</strong>
                        {!currentAnswer.isCorrect && <p>正确答案：{currentAnswer.correctOptionText}</p>}
                        {currentAnswer.explanation
                          ? <p>解析：{currentAnswer.explanation}</p>
                          : <p>这道题暂时没有解析，可以在题库中补充。</p>}
                      </section>
                    )}
                  </main>
                  <footer className="practice-footer">
                    <span>每次作答都会立即保存在本机，答案提交后不能修改。</span>
                    <div>
                      {currentIndex > 0 && <button className="secondary-button" type="button" disabled={busy} onClick={() => setCurrentIndex(currentIndex - 1)}>上一题</button>}
                      {currentIndex < attempt.questions.length - 1 ? (
                        <button className="primary-button" type="button" disabled={busy || !currentAnswer} onClick={() => setCurrentIndex(currentIndex + 1)}>下一题</button>
                      ) : (
                        <button className="primary-button" type="button" disabled={busy || attempt.answers.length !== attempt.questions.length} onClick={() => void completePractice()}>{busy ? '正在完成…' : '完成练习'}</button>
                      )}
                    </div>
                  </footer>
                </div>
              ) : (
                <div className="practice-review-view">
                  <span className={`session-status-badge status-${attempt.status.toLowerCase()}`}>{statusLabel(attempt.status)}</span>
                  {attempt.status === 'COMPLETED' ? (
                    <>
                      <div className="completion-feedback-card">
                        <span aria-hidden="true">✓</span>
                        <div>
                          <small>练习里程碑</small>
                          <strong>完成 {MODE_LABELS[attempt.mode]} · 答对 {correctCount}/{attempt.questions.length} 题</strong>
                          <p>这次结果已作为形成性证据保存，但不会直接改变掌握结论。</p>
                          <em>{attempt.mode === 'REMEDIATE' ? '下一步：重新诊断这个概念，确认薄弱点是否真正改善。' : '下一步：回看错题后进行客观诊断，确认是否真正掌握。'}</em>
                        </div>
                      </div>
                      <h3>答对 {correctCount} / {attempt.questions.length} 题</h3>
                      <p>这是一条形成性练习证据，不会直接把概念标记为已掌握。</p>
                      <ol>{attempt.questions.map((question, index) => {
                        const answer = attempt.answers.find((item) => item.attemptQuestionId === question.attemptQuestionId);
                        return <li key={question.attemptQuestionId} className={answer?.isCorrect ? 'correct' : 'incorrect'}><span>{answer?.isCorrect ? '✓' : '×'}</span><strong>{index + 1}. {question.prompt}</strong></li>;
                      })}</ol>
                    </>
                  ) : <p>这次练习已取消，已作答内容保留在历史中，但没有生成学习证据。</p>}
                  <button className="secondary-button" type="button" onClick={() => setAttempt(null)}>返回练习记录</button>
                </div>
              )}
            </>
          ) : (
            <div className="practice-center">
              <header className="assessment-modal-header">
                <div>
                  <span className="modal-kicker">练习中心</span>
                  <h2 id="practice-title">继续练习或回看结果</h2>
                  <p>练习提供即时反馈，不替代客观诊断。</p>
                </div>
                <button className="modal-close" type="button" aria-label="关闭练习中心" onClick={onClose}>×</button>
              </header>
              <section className="practice-history" aria-labelledby="practice-history-title">
                <div><strong id="practice-history-title">最近 100 次练习</strong><span>{history.length} 条记录</span></div>
                {history.length ? <ol>{history.map((item) => (
                  <li key={item.id}>
                    <button type="button" disabled={busy} onClick={() => void openHistory(item)}>
                      <span className={`session-status-badge status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span>
                      <div><strong>{item.nodeName}</strong><small>{MODE_LABELS[item.mode]} · {formatDate(item.startedAt)} · {item.answeredCount}/{item.questionCount} 题</small></div>
                      <span aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}</ol> : <p className="assessment-empty-copy">还没有练习记录。请先为概念准备练习题，再从概念详情或下一步建议开始。</p>}
              </section>
            </div>
          )}
        </section>
      </div>

      {cancelConfirmation && attempt && (
        <ConfirmDialog
          title="放弃这次练习？"
          description="已作答内容会保留在取消记录中，但不会生成学习证据，也不会改变概念状态。"
          confirmLabel="放弃练习"
          destructive
          onCancel={() => setCancelConfirmation(false)}
          onConfirm={() => void cancelPractice()}
        />
      )}
    </>
  );
}
