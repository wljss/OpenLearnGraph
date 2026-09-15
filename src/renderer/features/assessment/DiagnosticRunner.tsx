import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CompleteDiagnosticResult,
  DiagnosticAttemptView,
  KnowledgeGraphDocument,
} from '../../../shared/contracts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorMessage } from '../../errorMessage';

interface DiagnosticRunnerProps {
  graph: KnowledgeGraphDocument;
  onClose: () => void;
  onGraphUpdated: (graph: KnowledgeGraphDocument) => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

export function DiagnosticRunner({
  graph,
  onClose,
  onGraphUpdated,
  onMessage,
}: DiagnosticRunnerProps): React.JSX.Element {
  const [attempt, setAttempt] = useState<DiagnosticAttemptView | null>(null);
  const [result, setResult] = useState<CompleteDiagnosticResult | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, string | null>>(new Map());
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const eligibleNodes = useMemo(
    () => graph.nodes.filter((node) => node.diagnosticQuestionCount >= 2),
    [graph.nodes],
  );
  const eligibleQuestionCount = eligibleNodes.reduce((total, node) => total + node.diagnosticQuestionCount, 0);
  const currentQuestion = attempt?.questions[currentIndex] ?? null;

  const requestClose = useCallback(() => {
    if (busy) return;
    if (attempt && !result) setConfirmClose(true);
    else onClose();
  }, [attempt, busy, onClose, result]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !confirmClose) {
        event.preventDefault();
        requestClose();
        return;
      }
      if (!currentQuestion || busy || confirmClose) return;
      if (/^[1-6]$/.test(event.key)) {
        const option = currentQuestion.options[Number(event.key) - 1];
        if (option) {
          setAnswers((current) => new Map(current).set(currentQuestion.attemptQuestionId, option.id));
        }
      } else if (event.key === '0') {
        setAnswers((current) => new Map(current).set(currentQuestion.attemptQuestionId, null));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, confirmClose, currentQuestion, requestClose]);

  const startDiagnostic = async (): Promise<void> => {
    setBusy(true);
    try {
      const started = await window.openLearnGraph.assessments.startDiagnostic(graph.id);
      setAttempt(started);
      setAnswers(new Map());
      setCurrentIndex(0);
      onMessage(`诊断已开始，共 ${started.questions.length} 道题。`, 'info');
    } catch (error) {
      onMessage(`无法开始诊断：${errorMessage(error)}`, 'error');
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
      setResult(completed);
      onGraphUpdated(completed.graph);
      onMessage('诊断结果已保存，并已重新计算整张图谱的学习状态。', 'success');
    } catch (error) {
      onMessage(`诊断提交失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelDiagnostic = async (): Promise<void> => {
    if (!attempt) return;
    setConfirmClose(false);
    setBusy(true);
    try {
      await window.openLearnGraph.assessments.cancelDiagnostic(attempt.id);
      onMessage('本次诊断已取消，没有生成学习证据。');
      onClose();
    } catch (error) {
      onMessage(`诊断取消失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const answerCurrent = (selectedOptionId: string | null): void => {
    if (!currentQuestion || busy) return;
    setAnswers((current) => new Map(current).set(currentQuestion.attemptQuestionId, selectedOptionId));
  };

  return (
    <>
      <div
        className="dialog-backdrop assessment-backdrop"
        role="presentation"
        aria-hidden={confirmClose ? 'true' : undefined}
        onMouseDown={requestClose}
      >
        <section
          className="diagnostic-runner"
          role="dialog"
          aria-modal="true"
          aria-labelledby="diagnostic-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {!attempt && !result && (
            <div className="diagnostic-setup">
              <header className="assessment-modal-header">
                <div>
                  <span className="modal-kicker">图谱诊断</span>
                  <h2 id="diagnostic-title">检查当前掌握情况</h2>
                  <p>诊断会覆盖题目充足的概念，并把客观作答结果写入学习证据。</p>
                </div>
                <button className="modal-close" type="button" aria-label="关闭诊断" disabled={busy} onClick={requestClose}>×</button>
              </header>
              <div className="diagnostic-coverage">
                <div><strong>{eligibleNodes.length}</strong><span>个可诊断概念</span></div>
                <div><strong>{eligibleQuestionCount}</strong><span>道题</span></div>
                <div><strong>{graph.nodes.length - eligibleNodes.length}</strong><span>个尚未覆盖</span></div>
              </div>
              <div className="diagnostic-rule-card">
                <strong>判定规则</strong>
                <p>每个概念至少需要 2 道题；正确率达到 80% 才标记为“已掌握”。不知道时可以明确选择“我不知道”，无需猜测。</p>
              </div>
              {graph.nodes.length - eligibleNodes.length > 0 && (
                <div className="coverage-warning">
                  <strong>不会进入本次诊断：</strong>
                  <span>{graph.nodes.filter((node) => node.diagnosticQuestionCount < 2).map((node) => `${node.name}（${node.diagnosticQuestionCount}/2）`).join('、')}</span>
                </div>
              )}
              <button className="primary-button diagnostic-primary" type="button" disabled={busy || !eligibleNodes.length} onClick={() => void startDiagnostic()}>
                {busy ? '正在准备题目…' : eligibleNodes.length ? `开始诊断 · ${eligibleQuestionCount} 题` : '题目数量不足'}
              </button>
            </div>
          )}

          {attempt && currentQuestion && !result && (
            <div className="diagnostic-question-view">
              <header className="diagnostic-progress-header">
                <div>
                  <span className="modal-kicker">{currentQuestion.nodeName}</span>
                  <strong>第 {currentIndex + 1} / {attempt.questions.length} 题</strong>
                </div>
                <button className="modal-close" type="button" aria-label="退出诊断" disabled={busy} onClick={requestClose}>×</button>
              </header>
              <div
                className="diagnostic-progress-track"
                role="progressbar"
                aria-label="诊断进度"
                aria-valuemin={1}
                aria-valuemax={attempt.questions.length}
                aria-valuenow={currentIndex + 1}
              >
                <span style={{ width: `${((currentIndex + 1) / attempt.questions.length) * 100}%` }} />
              </div>
              <h2 id="diagnostic-title">{currentQuestion.prompt}</h2>
              <div className="diagnostic-options" role="radiogroup" aria-label="答案选项">
                {currentQuestion.options.map((option, index) => {
                  const selected = answers.has(currentQuestion.attemptQuestionId)
                    && answers.get(currentQuestion.attemptQuestionId) === option.id;
                  return (
                    <button
                      key={option.id}
                      className={selected ? 'selected' : ''}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy}
                      onClick={() => answerCurrent(option.id)}
                    >
                      <kbd>{index + 1}</kbd><span>{option.text}</span>
                    </button>
                  );
                })}
                <button
                  className={answers.has(currentQuestion.attemptQuestionId) && answers.get(currentQuestion.attemptQuestionId) === null ? 'selected unknown' : 'unknown'}
                  type="button"
                  role="radio"
                  aria-checked={answers.has(currentQuestion.attemptQuestionId) && answers.get(currentQuestion.attemptQuestionId) === null}
                  disabled={busy}
                  onClick={() => answerCurrent(null)}
                >
                  <kbd>0</kbd><span>我不知道</span>
                </button>
              </div>
              <footer className="diagnostic-navigation">
                <button className="secondary-button" type="button" disabled={busy || currentIndex === 0} onClick={() => setCurrentIndex((index) => index - 1)}>上一题</button>
                <span>{answers.size} / {attempt.questions.length} 已作答</span>
                {currentIndex < attempt.questions.length - 1 ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={busy || !answers.has(currentQuestion.attemptQuestionId)}
                    onClick={() => setCurrentIndex((index) => index + 1)}
                  >下一题</button>
                ) : (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={busy || answers.size !== attempt.questions.length}
                    onClick={() => void submitDiagnostic()}
                  >{busy ? '正在评分…' : '提交诊断'}</button>
                )}
              </footer>
            </div>
          )}

          {result && (
            <div className="diagnostic-results">
              <header className="assessment-modal-header">
                <div>
                  <span className="modal-kicker">诊断结果</span>
                  <h2 id="diagnostic-title">答对 {result.correctCount} / {result.questionCount} 题</h2>
                  <p>结果已保存为客观学习证据，图谱状态已同步更新。</p>
                </div>
                <button className="modal-close" type="button" aria-label="关闭诊断结果" onClick={onClose}>×</button>
              </header>
              <div className="node-result-grid">
                {result.nodeResults.map((nodeResult) => (
                  <div key={nodeResult.nodeId} className={nodeResult.passed ? 'passed' : 'needs-work'}>
                    <span>{nodeResult.passed ? '已掌握' : '继续学习'}</span>
                    <strong>{nodeResult.nodeName}</strong>
                    <small>{nodeResult.correctCount}/{nodeResult.questionCount} 题正确</small>
                  </div>
                ))}
              </div>
              <section className="answer-review" aria-labelledby="answer-review-title">
                <h3 id="answer-review-title">逐题回顾</h3>
                {result.questionResults.map((questionResult, index) => (
                  <details key={questionResult.attemptQuestionId} className={questionResult.isCorrect ? 'correct' : 'incorrect'} open={!questionResult.isCorrect}>
                    <summary>
                      <span>{questionResult.isCorrect ? '✓' : '×'}</span>
                      <strong>{index + 1}. {questionResult.prompt}</strong>
                    </summary>
                    <div>
                      <p>你的答案：{questionResult.selectedOptionText ?? '我不知道'}</p>
                      {!questionResult.isCorrect && <p>正确答案：{questionResult.correctOptionText}</p>}
                      {questionResult.explanation && <p className="answer-explanation">解析：{questionResult.explanation}</p>}
                    </div>
                  </details>
                ))}
              </section>
              <button className="primary-button diagnostic-primary" type="button" onClick={onClose}>返回知识图谱</button>
            </div>
          )}
        </section>
      </div>

      {confirmClose && (
        <ConfirmDialog
          title="退出本次诊断？"
          description="当前答案尚未提交。退出后本次诊断会标记为已取消，不会生成学习证据。"
          confirmLabel="退出诊断"
          destructive
          onCancel={() => setConfirmClose(false)}
          onConfirm={() => void cancelDiagnostic()}
        />
      )}
    </>
  );
}
