import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DiagnosticAttemptSummaryView,
  DiagnosticAttemptView,
  DiagnosticReviewView,
  KnowledgeGraphDocument,
} from '../../../shared/contracts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorMessage } from '../../errorMessage';

interface DiagnosticRunnerProps {
  graph: KnowledgeGraphDocument;
  initialNodeIds?: string[];
  onClose: () => void;
  onGraphUpdated: (graph: KnowledgeGraphDocument) => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

interface CancelConfirmation {
  attemptId: string;
}

interface DiagnosticImpact {
  newlyMasteredCount: number;
  unlockedCount: number;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusLabel(status: DiagnosticAttemptSummaryView['status']): string {
  if (status === 'IN_PROGRESS') return '未完成';
  if (status === 'COMPLETED') return '已完成';
  return '已取消';
}

export function DiagnosticRunner({
  graph,
  initialNodeIds = [],
  onClose,
  onGraphUpdated,
  onMessage,
}: DiagnosticRunnerProps): React.JSX.Element {
  const eligibleNodes = useMemo(
    () => graph.nodes.filter((node) => node.diagnosticQuestionCount >= 2),
    [graph.nodes],
  );
  const weakNodeIds = useMemo(() => new Set(
    eligibleNodes
      .filter((node) => node.latestEvidenceKind === 'DIAGNOSTIC_RESULT' && node.learningPhase !== 'MASTERED')
      .map((node) => node.id),
  ), [eligibleNodes]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    () => {
      const eligibleIds = new Set(eligibleNodes.map((node) => node.id));
      const requested = initialNodeIds.filter((nodeId) => eligibleIds.has(nodeId));
      return new Set(requested.length ? requested : eligibleIds);
    },
  );
  const [attempts, setAttempts] = useState<DiagnosticAttemptSummaryView[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [tab, setTab] = useState<'setup' | 'history'>('setup');
  const [attempt, setAttempt] = useState<DiagnosticAttemptView | null>(null);
  const [review, setReview] = useState<DiagnosticReviewView | null>(null);
  const [impact, setImpact] = useState<DiagnosticImpact | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, string | null>>(new Map());
  const [busy, setBusy] = useState(false);
  const [answerSaving, setAnswerSaving] = useState(false);
  const [cancelConfirmation, setCancelConfirmation] = useState<CancelConfirmation | null>(null);

  const refreshAttempts = useCallback(async (): Promise<void> => {
    const items = await window.openLearnGraph.assessments.listDiagnosticAttempts(graph.id);
    setAttempts(items);
  }, [graph.id]);

  useEffect(() => {
    let active = true;
    void window.openLearnGraph.assessments.listDiagnosticAttempts(graph.id).then((items) => {
      if (active) setAttempts(items);
    }).catch((error: unknown) => {
      if (active) onMessage(`诊断历史加载失败：${errorMessage(error)}`, 'error');
    }).finally(() => {
      if (active) setHistoryLoading(false);
    });
    return () => { active = false; };
  }, [graph.id, onMessage]);

  const selectedNodes = eligibleNodes.filter((node) => selectedNodeIds.has(node.id));
  const selectedQuestionCount = selectedNodes.reduce((total, node) => total + node.diagnosticQuestionCount, 0);
  const activeAttempts = attempts.filter((item) => item.status === 'IN_PROGRESS');
  const currentQuestion = attempt?.questions[currentIndex] ?? null;
  const interactionBusy = busy || answerSaving;

  const requestClose = useCallback(() => {
    if (interactionBusy) return;
    if (attempt && !review) {
      onMessage(`诊断进度已保存：${answers.size}/${attempt.questions.length} 题已作答，可稍后继续。`, 'success');
    }
    onClose();
  }, [answers.size, attempt, interactionBusy, onClose, onMessage, review]);

  const answerCurrent = useCallback(async (selectedOptionId: string | null): Promise<void> => {
    if (!attempt || !currentQuestion || interactionBusy) return;
    const questionId = currentQuestion.attemptQuestionId;
    const hadPrevious = answers.has(questionId);
    const previous = answers.get(questionId) ?? null;
    setAnswers((current) => new Map(current).set(questionId, selectedOptionId));
    setAnswerSaving(true);
    try {
      await window.openLearnGraph.assessments.saveDiagnosticAnswer({
        attemptId: attempt.id,
        attemptQuestionId: questionId,
        selectedOptionId,
      });
    } catch (error) {
      setAnswers((current) => {
        const next = new Map(current);
        if (hadPrevious) next.set(questionId, previous);
        else next.delete(questionId);
        return next;
      });
      onMessage(`答案保存失败，请重新选择：${errorMessage(error)}`, 'error');
    } finally {
      setAnswerSaving(false);
    }
  }, [answers, attempt, currentQuestion, interactionBusy, onMessage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !cancelConfirmation) {
        event.preventDefault();
        requestClose();
        return;
      }
      if (!currentQuestion || interactionBusy || cancelConfirmation) return;
      if (/^[1-6]$/.test(event.key)) {
        const option = currentQuestion.options[Number(event.key) - 1];
        if (option) void answerCurrent(option.id);
      } else if (event.key === '0') {
        void answerCurrent(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [answerCurrent, cancelConfirmation, currentQuestion, interactionBusy, requestClose]);

  const startDiagnostic = async (): Promise<void> => {
    if (!selectedNodeIds.size) return;
    setBusy(true);
    try {
      const started = await window.openLearnGraph.assessments.startDiagnostic({
        graphId: graph.id,
        nodeIds: Array.from(selectedNodeIds),
      });
      setAttempt(started);
      setAnswers(new Map());
      setCurrentIndex(0);
      onMessage(`诊断已开始，共 ${started.questions.length} 道题；答案会自动保存。`, 'info');
    } catch (error) {
      onMessage(`无法开始诊断：${errorMessage(error)}`, 'error');
      await refreshAttempts().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const resumeDiagnostic = async (attemptId: string): Promise<void> => {
    setBusy(true);
    try {
      const resumed = await window.openLearnGraph.assessments.resumeDiagnostic(attemptId);
      const restoredAnswers = new Map(
        resumed.answers.map((answer) => [answer.attemptQuestionId, answer.selectedOptionId]),
      );
      const firstUnanswered = resumed.questions.findIndex(
        (question) => !restoredAnswers.has(question.attemptQuestionId),
      );
      setAttempt(resumed);
      setAnswers(restoredAnswers);
      setCurrentIndex(firstUnanswered >= 0 ? firstUnanswered : Math.max(0, resumed.questions.length - 1));
      onMessage(`已恢复上次进度：${restoredAnswers.size}/${resumed.questions.length} 题已作答。`, 'success');
    } catch (error) {
      onMessage(`无法继续诊断：${errorMessage(error)}`, 'error');
      await refreshAttempts().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const submitDiagnostic = async (): Promise<void> => {
    if (!attempt || answers.size !== attempt.questions.length) return;
    setBusy(true);
    try {
      const completed = await window.openLearnGraph.assessments.completeDiagnostic({
        attemptId: attempt.id,
        answers: attempt.questions.map((question) => ({
          attemptQuestionId: question.attemptQuestionId,
          selectedOptionId: answers.get(question.attemptQuestionId) ?? null,
        })),
      });
      const previousByNodeId = new Map(graph.nodes.map((node) => [node.id, node]));
      setImpact({
        newlyMasteredCount: completed.nodeResults.filter((result) => (
          result.passed && previousByNodeId.get(result.nodeId)?.status !== 'MASTERED'
        )).length,
        unlockedCount: completed.graph.nodes.filter((node) => (
          node.status !== 'LOCKED' && previousByNodeId.get(node.id)?.status === 'LOCKED'
        )).length,
      });
      setAttempt(null);
      setReview(completed);
      onGraphUpdated(completed.graph);
      await refreshAttempts().catch(() => undefined);
      onMessage('诊断结果已保存，并已重新计算所测概念的学习状态。', 'success');
    } catch (error) {
      onMessage(`诊断提交失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelDiagnostic = async (): Promise<void> => {
    if (!cancelConfirmation) return;
    const { attemptId } = cancelConfirmation;
    setCancelConfirmation(null);
    setBusy(true);
    try {
      await window.openLearnGraph.assessments.cancelDiagnostic(attemptId);
      if (attempt?.id === attemptId) {
        setAttempt(null);
        setAnswers(new Map());
      }
      await refreshAttempts().catch(() => undefined);
      onMessage('本次诊断已取消，已保存的草稿答案不会生成学习证据。');
    } catch (error) {
      onMessage(`诊断取消失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openHistoricalResult = async (attemptId: string): Promise<void> => {
    setBusy(true);
    try {
      setReview(await window.openLearnGraph.assessments.getDiagnosticResult(attemptId));
    } catch (error) {
      onMessage(`诊断结果加载失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const retestWeakConcepts = (): void => {
    if (!review) return;
    const eligibleIds = new Set(eligibleNodes.map((node) => node.id));
    const failedIds = review.nodeResults
      .filter((node) => !node.passed && eligibleIds.has(node.nodeId))
      .map((node) => node.nodeId);
    setSelectedNodeIds(new Set(failedIds));
    setReview(null);
    setTab('setup');
  };

  const toggleNode = (nodeId: string): void => {
    setSelectedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const retestableResultCount = review?.nodeResults.filter(
    (result) => !result.passed && eligibleNodes.some((node) => node.id === result.nodeId),
  ).length ?? 0;

  return (
    <>
      <div
        className="dialog-backdrop assessment-backdrop"
        role="presentation"
        aria-hidden={cancelConfirmation ? 'true' : undefined}
        onMouseDown={requestClose}
      >
        <section
          className="diagnostic-runner"
          role="dialog"
          aria-modal="true"
          aria-labelledby="diagnostic-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {!attempt && !review && (
            <div className="diagnostic-center">
              <header className="assessment-modal-header">
                <div>
                  <span className="modal-kicker">图谱诊断</span>
                  <h2 id="diagnostic-title">检查并巩固掌握情况</h2>
                  <p>选择概念开始诊断，或继续上次进度、回看历史结果。</p>
                </div>
                <button className="modal-close" type="button" aria-label="关闭诊断" disabled={busy} onClick={requestClose}>×</button>
              </header>

              <div className="diagnostic-tabs" role="tablist" aria-label="诊断中心">
                <button type="button" role="tab" aria-selected={tab === 'setup'} onClick={() => setTab('setup')}>开始诊断</button>
                <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
                  历史记录{attempts.length ? ` · ${attempts.length}` : ''}
                </button>
              </div>

              {tab === 'setup' && (
                <div className="diagnostic-setup">
                  {activeAttempts.length > 0 && (
                    <section className="diagnostic-recovery" aria-labelledby="recovery-heading">
                      <div>
                        <strong id="recovery-heading">发现未完成的诊断</strong>
                        <p>答案已保存在本机，可以从上次停下的位置继续。</p>
                      </div>
                      {activeAttempts.map((item) => (
                        <div className="recovery-row" key={item.id}>
                          <span>{formatDate(item.startedAt)} · {item.answeredCount}/{item.questionCount} 题已作答</span>
                          <div>
                            <button className="secondary-button" type="button" disabled={busy} onClick={() => void resumeDiagnostic(item.id)}>继续作答</button>
                            <button className="text-danger-button" type="button" disabled={busy} onClick={() => setCancelConfirmation({ attemptId: item.id })}>放弃</button>
                          </div>
                        </div>
                      ))}
                    </section>
                  )}

                  <div className="diagnostic-coverage">
                    <div><strong>{selectedNodes.length}</strong><span>个已选概念</span></div>
                    <div><strong>{selectedQuestionCount}</strong><span>道题</span></div>
                    <div><strong>{graph.nodes.length - eligibleNodes.length}</strong><span>个尚未覆盖</span></div>
                  </div>

                  <section className="diagnostic-scope" aria-labelledby="diagnostic-scope-heading">
                    <div className="diagnostic-scope-heading">
                      <div><strong id="diagnostic-scope-heading">本次诊断范围</strong><span>只会改变所选概念的客观结论</span></div>
                      <div>
                        <button type="button" onClick={() => setSelectedNodeIds(new Set(eligibleNodes.map((node) => node.id)))}>全选</button>
                        <button type="button" disabled={!weakNodeIds.size} onClick={() => setSelectedNodeIds(new Set(weakNodeIds))}>只选薄弱概念</button>
                      </div>
                    </div>
                    {eligibleNodes.length ? (
                      <div className="diagnostic-node-selector" role="group" aria-label="选择诊断概念">
                        {eligibleNodes.map((node) => (
                          <label key={node.id} className={selectedNodeIds.has(node.id) ? 'selected' : ''}>
                            <input type="checkbox" checked={selectedNodeIds.has(node.id)} onChange={() => toggleNode(node.id)} />
                            <span><strong>{node.name}</strong><small>{node.diagnosticQuestionCount} 道题 · {node.latestEvidenceKind === 'DIAGNOSTIC_RESULT' ? node.statusReason : '尚无客观诊断'}</small></span>
                          </label>
                        ))}
                      </div>
                    ) : <p className="assessment-empty-copy">还没有题目充足的概念。请先为一个概念准备至少 2 道题。</p>}
                  </section>

                  <div className="diagnostic-rule-card">
                    <strong>判定规则</strong>
                    <p>每个概念正确率达到 80% 才标记为“已掌握”。不知道时请选择“我不知道”；每次选择都会自动保存。</p>
                  </div>
                  {graph.nodes.length - eligibleNodes.length > 0 && (
                    <div className="coverage-warning">
                      <strong>尚不能诊断：</strong>
                      <span>{graph.nodes.filter((node) => node.diagnosticQuestionCount < 2).map((node) => `${node.name}（${node.diagnosticQuestionCount}/2）`).join('、')}</span>
                    </div>
                  )}
                  <button
                    className="primary-button diagnostic-primary"
                    type="button"
                    disabled={busy || !selectedNodes.length || activeAttempts.length > 0}
                    onClick={() => void startDiagnostic()}
                  >
                    {busy ? '正在准备题目…' : activeAttempts.length ? '请先处理未完成的诊断' : selectedNodes.length ? `开始诊断 · ${selectedQuestionCount} 题` : '请选择诊断概念'}
                  </button>
                </div>
              )}

              {tab === 'history' && (
                <section className="diagnostic-history" aria-labelledby="diagnostic-history-heading">
                  <div className="history-heading">
                    <div><strong id="diagnostic-history-heading">最近 100 次诊断</strong><span>结果与取消记录都只保存在本机</span></div>
                  </div>
                  {historyLoading ? <p className="assessment-empty-copy">正在加载诊断历史……</p> : attempts.length ? (
                    <ol>
                      {attempts.map((item) => (
                        <li key={item.id} className={`history-${item.status.toLowerCase()}`}>
                          <span className="history-status">{statusLabel(item.status)}</span>
                          <div className="history-copy">
                            <strong>{formatDate(item.startedAt)}</strong>
                            <span>{item.nodeCount} 个概念 · {item.questionCount} 道题{item.status === 'COMPLETED' ? ` · 答对 ${item.correctCount}/${item.questionCount}` : ` · 已作答 ${item.answeredCount}/${item.questionCount}`}</span>
                          </div>
                          <div className="history-actions">
                            {item.status === 'COMPLETED' && <button className="secondary-button" type="button" disabled={busy} onClick={() => void openHistoricalResult(item.id)}>查看结果</button>}
                            {item.status === 'IN_PROGRESS' && (
                              <>
                                <button className="secondary-button" type="button" disabled={busy} onClick={() => void resumeDiagnostic(item.id)}>继续</button>
                                <button className="text-danger-button" type="button" disabled={busy} onClick={() => setCancelConfirmation({ attemptId: item.id })}>放弃</button>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="assessment-empty-copy">还没有诊断记录。完成第一次诊断后，可以在这里回看结果。</p>}
                </section>
              )}
            </div>
          )}

          {attempt && currentQuestion && !review && (
            <div className="diagnostic-question-view">
              <header className="diagnostic-progress-header">
                <div>
                  <span className="modal-kicker">{currentQuestion.nodeName}</span>
                  <strong>第 {currentIndex + 1} / {attempt.questions.length} 题</strong>
                </div>
                <div className="diagnostic-question-actions">
                  <button className="text-danger-button" type="button" disabled={interactionBusy} onClick={() => setCancelConfirmation({ attemptId: attempt.id })}>放弃</button>
                  <button className="modal-close" type="button" aria-label="稍后继续" title="保存进度并返回图谱" disabled={interactionBusy} onClick={requestClose}>×</button>
                </div>
              </header>
              <div className="diagnostic-progress-track" role="progressbar" aria-label="诊断进度" aria-valuemin={1} aria-valuemax={attempt.questions.length} aria-valuenow={currentIndex + 1}>
                <span style={{ width: `${((currentIndex + 1) / attempt.questions.length) * 100}%` }} />
              </div>
              <h2 id="diagnostic-title">{currentQuestion.prompt}</h2>
              <div className="diagnostic-options" role="radiogroup" aria-label="答案选项">
                {currentQuestion.options.map((option, index) => {
                  const selected = answers.has(currentQuestion.attemptQuestionId)
                    && answers.get(currentQuestion.attemptQuestionId) === option.id;
                  return (
                    <button key={option.id} className={selected ? 'selected' : ''} type="button" role="radio" aria-checked={selected} disabled={interactionBusy} onClick={() => void answerCurrent(option.id)}>
                      <kbd>{index + 1}</kbd><span>{option.text}</span>
                    </button>
                  );
                })}
                <button className={answers.has(currentQuestion.attemptQuestionId) && answers.get(currentQuestion.attemptQuestionId) === null ? 'selected unknown' : 'unknown'} type="button" role="radio" aria-checked={answers.has(currentQuestion.attemptQuestionId) && answers.get(currentQuestion.attemptQuestionId) === null} disabled={interactionBusy} onClick={() => void answerCurrent(null)}>
                  <kbd>0</kbd><span>我不知道</span>
                </button>
              </div>
              <p className="diagnostic-autosave" role="status">{answerSaving ? '正在保存答案……' : '答案自动保存在本机，可安全退出后继续'}</p>
              <footer className="diagnostic-navigation">
                <button className="secondary-button" type="button" disabled={interactionBusy || currentIndex === 0} onClick={() => setCurrentIndex((index) => index - 1)}>上一题</button>
                <span>{answers.size} / {attempt.questions.length} 已作答</span>
                {currentIndex < attempt.questions.length - 1 ? (
                  <button className="primary-button" type="button" disabled={interactionBusy || !answers.has(currentQuestion.attemptQuestionId)} onClick={() => setCurrentIndex((index) => index + 1)}>下一题</button>
                ) : (
                  <button className="primary-button" type="button" disabled={interactionBusy || answers.size !== attempt.questions.length} onClick={() => void submitDiagnostic()}>{busy ? '正在评分…' : '提交诊断'}</button>
                )}
              </footer>
            </div>
          )}

          {review && (
            <div className="diagnostic-results">
              <header className="assessment-modal-header">
                <div>
                  <span className="modal-kicker">诊断结果</span>
                  <h2 id="diagnostic-title">答对 {review.correctCount} / {review.questionCount} 题</h2>
                  <p>完成于 {formatDate(review.completedAt)}。题目与答案按当时快照展示。</p>
                </div>
                <button className="modal-close" type="button" aria-label="关闭诊断结果" onClick={onClose}>×</button>
              </header>
              <div className="completion-feedback-card diagnostic-completion-feedback">
                <span aria-hidden="true">✓</span>
                <div>
                  <small>诊断完成</small>
                  <strong>{review.nodeResults.filter((result) => result.passed).length}/{review.nodeResults.length} 个概念达到客观掌握标准</strong>
                  <p>
                    {impact?.newlyMasteredCount
                      ? `新增 ${impact.newlyMasteredCount} 个客观掌握结论。`
                      : '本次结果已更新客观掌握证据。'}
                    {impact?.unlockedCount ? ` 同时解锁 ${impact.unlockedCount} 个后续概念。` : ''}
                  </p>
                  <em>{review.nodeResults.some((result) => !result.passed) ? '下一步：先回顾未通过概念的错题与解析，再针对性补强。' : '下一步：继续学习刚刚解锁的内容，或回顾本次答题依据。'}</em>
                </div>
              </div>
              <div className="node-result-grid">
                {review.nodeResults.map((nodeResult) => (
                  <div key={nodeResult.nodeId} className={nodeResult.passed ? 'passed' : 'needs-work'}>
                    <span>{nodeResult.passed ? '已掌握' : '继续学习'}</span>
                    <strong>{nodeResult.nodeName}</strong>
                    <small>{nodeResult.correctCount}/{nodeResult.questionCount} 题正确</small>
                  </div>
                ))}
              </div>
              <section className="answer-review" aria-labelledby="answer-review-title">
                <h3 id="answer-review-title">逐题回顾</h3>
                {review.questionResults.map((questionResult, index) => (
                  <details key={questionResult.attemptQuestionId} className={questionResult.isCorrect ? 'correct' : 'incorrect'} open={!questionResult.isCorrect}>
                    <summary><span>{questionResult.isCorrect ? '✓' : '×'}</span><strong>{index + 1}. {questionResult.prompt}</strong></summary>
                    <div>
                      <p>你的答案：{questionResult.selectedOptionText ?? '我不知道'}</p>
                      {!questionResult.isCorrect && <p>正确答案：{questionResult.correctOptionText}</p>}
                      {questionResult.explanation && <p className="answer-explanation">解析：{questionResult.explanation}</p>}
                    </div>
                  </details>
                ))}
              </section>
              <div className="diagnostic-result-actions">
                {retestableResultCount > 0 && <button className="secondary-button" type="button" onClick={retestWeakConcepts}>重测未掌握概念 · {retestableResultCount}</button>}
                <button className="secondary-button" type="button" onClick={() => { setReview(null); setTab('history'); }}>返回诊断中心</button>
                <button className="primary-button" type="button" onClick={onClose}>返回知识图谱</button>
              </div>
            </div>
          )}
        </section>
      </div>

      {cancelConfirmation && (
        <ConfirmDialog
          title="放弃这次诊断？"
          description="已保存的答题进度会保留为取消记录，但不会生成学习证据，也不会改变概念状态。"
          confirmLabel="放弃诊断"
          destructive
          onCancel={() => setCancelConfirmation(null)}
          onConfirm={() => void cancelDiagnostic()}
        />
      )}
    </>
  );
}
