import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KnowledgeGraphDocument,
  LearningSessionAction,
  LearningSessionView,
} from '../../../shared/contracts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorMessage } from '../../errorMessage';
import { STATUS_LABELS } from '../../learningLabels';

export interface LearningSessionLaunch {
  sessionId?: string;
  nodeId?: string;
  action?: LearningSessionAction;
  sourceDecisionId?: string;
}

interface LearningSessionRunnerProps {
  graph: KnowledgeGraphDocument;
  launch: LearningSessionLaunch;
  onClose: () => void;
  onGraphUpdated: (graph: KnowledgeGraphDocument) => void;
  onSessionChanged: () => void;
  onDraftDirtyChange: (dirty: boolean) => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
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

function statusLabel(status: LearningSessionView['status']): string {
  if (status === 'IN_PROGRESS') return '进行中';
  if (status === 'COMPLETED') return '已完成';
  return '已取消';
}

function actionLabel(action: LearningSessionAction): string {
  return action === 'ADVANCE' ? '进阶学习' : '概念学习';
}

export function LearningSessionRunner({
  graph,
  launch,
  onClose,
  onGraphUpdated,
  onSessionChanged,
  onDraftDirtyChange,
  onMessage,
}: LearningSessionRunnerProps): React.JSX.Element {
  const [session, setSession] = useState<LearningSessionView | null>(null);
  const [history, setHistory] = useState<LearningSessionView[]>([]);
  const [notes, setNotes] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelConfirmation, setCancelConfirmation] = useState(false);
  const persistedDraft = useRef<{ sessionId: string; notes: string; stepIndex: number } | null>(null);
  const currentDraft = useRef<{ notes: string; stepIndex: number }>({ notes: '', stepIndex: 0 });
  const requestCloseRef = useRef<() => Promise<void>>(async () => undefined);

  const applySession = useCallback((next: LearningSessionView): void => {
    persistedDraft.current = { sessionId: next.id, notes: next.notes, stepIndex: next.stepIndex };
    currentDraft.current = { notes: next.notes, stepIndex: next.stepIndex };
    onDraftDirtyChange(false);
    setSession(next);
    setNotes(next.notes);
    setStepIndex(next.stepIndex);
  }, [onDraftDirtyChange]);

  const refreshHistory = useCallback(async (): Promise<void> => {
    setHistory(await window.openLearnGraph.sessions.list(graph.id));
  }, [graph.id]);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      try {
        let next: LearningSessionView | null;
        if (launch.sessionId) {
          next = await window.openLearnGraph.sessions.get(launch.sessionId);
        } else if (launch.nodeId && launch.action) {
          next = await window.openLearnGraph.sessions.start({
            graphId: graph.id,
            nodeId: launch.nodeId,
            action: launch.action,
            ...(launch.sourceDecisionId ? { sourceDecisionId: launch.sourceDecisionId } : {}),
          });
          onSessionChanged();
        } else {
          next = await window.openLearnGraph.sessions.getActive(graph.id);
        }
        const items = await window.openLearnGraph.sessions.list(graph.id);
        if (active) {
          if (next) applySession(next);
          setHistory(items);
        }
      } catch (error) {
        if (active) onMessage(`学习会话打开失败：${errorMessage(error)}`, 'error');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [applySession, graph.id, launch.action, launch.nodeId, launch.sessionId, launch.sourceDecisionId, onMessage, onSessionChanged]);

  useEffect(() => {
    if (!session || session.status !== 'IN_PROGRESS') return undefined;
    const current = { sessionId: session.id, notes, stepIndex };
    const previous = persistedDraft.current;
    if (previous
      && previous.sessionId === current.sessionId
      && previous.notes === current.notes
      && previous.stepIndex === current.stepIndex) return undefined;

    const timeout = window.setTimeout(() => {
      setSaving(true);
      void window.openLearnGraph.sessions.saveDraft(current).then((updated) => {
        persistedDraft.current = {
          sessionId: updated.id,
          notes: updated.notes,
          stepIndex: updated.stepIndex,
        };
        setSession(updated);
        const latest = currentDraft.current;
        onDraftDirtyChange(latest.notes !== updated.notes || latest.stepIndex !== updated.stepIndex);
      }).catch((error: unknown) => {
        onMessage(`学习进度自动保存失败：${errorMessage(error)}`, 'error');
      }).finally(() => setSaving(false));
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [notes, onDraftDirtyChange, onMessage, session, stepIndex]);

  const saveNow = async (): Promise<boolean> => {
    if (!session || session.status !== 'IN_PROGRESS') return true;
    const draft = { sessionId: session.id, notes, stepIndex };
    setSaving(true);
    try {
      const updated = await window.openLearnGraph.sessions.saveDraft(draft);
      persistedDraft.current = { sessionId: updated.id, notes: updated.notes, stepIndex: updated.stepIndex };
      setSession(updated);
      const latest = currentDraft.current;
      onDraftDirtyChange(latest.notes !== updated.notes || latest.stepIndex !== updated.stepIndex);
      return true;
    } catch (error) {
      onMessage(`学习进度保存失败：${errorMessage(error)}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const updateNotes = (value: string): void => {
    currentDraft.current = { notes: value, stepIndex };
    onDraftDirtyChange(true);
    setNotes(value);
  };

  const moveToStep = (nextStep: number): void => {
    currentDraft.current = { notes, stepIndex: nextStep };
    onDraftDirtyChange(true);
    setStepIndex(nextStep);
  };

  const requestClose = async (): Promise<void> => {
    if (busy || saving) return;
    if (session?.status === 'IN_PROGRESS') {
      if (!await saveNow()) return;
      onMessage('学习进度已保存，可稍后继续。', 'success');
    }
    onClose();
  };

  useEffect(() => {
    requestCloseRef.current = requestClose;
  });

  const completeSession = async (): Promise<void> => {
    if (!session || !notes.trim()) return;
    setBusy(true);
    try {
      const result = await window.openLearnGraph.sessions.complete({ sessionId: session.id, notes });
      applySession(result.session);
      onGraphUpdated(result.graph);
      onSessionChanged();
      await refreshHistory().catch(() => undefined);
      onMessage('学习会话已完成并写入证据；掌握状态仍需自评或客观诊断确认。', 'success');
    } catch (error) {
      onMessage(`学习会话完成失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelSession = async (): Promise<void> => {
    if (!session) return;
    setCancelConfirmation(false);
    setBusy(true);
    try {
      const cancelled = await window.openLearnGraph.sessions.cancel(session.id);
      applySession(cancelled);
      onSessionChanged();
      await refreshHistory().catch(() => undefined);
      onMessage('学习会话已取消，没有生成学习证据。');
    } catch (error) {
      onMessage(`学习会话取消失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openHistory = (item: LearningSessionView): void => applySession(item);
  const activeSession = history.find((item) => item.status === 'IN_PROGRESS');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || cancelConfirmation) return;
      event.preventDefault();
      void requestCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelConfirmation]);

  return (
    <>
      <div className="dialog-backdrop assessment-backdrop" role="presentation" onMouseDown={() => void requestClose()}>
        <section
          className="learning-session-runner"
          role="dialog"
          aria-modal="true"
          aria-labelledby="learning-session-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {loading ? <p className="session-loading">正在恢复学习会话……</p> : session ? (
            <>
              <header className="assessment-modal-header session-header">
                <div>
                  <span className="modal-kicker">{actionLabel(session.action)} · {statusLabel(session.status)}</span>
                  <h2 id="learning-session-title">{session.nodeName}</h2>
                  <p>开始于 {formatDate(session.startedAt)} · 内容按开始时的快照展示</p>
                </div>
                <div className="session-header-actions">
                  {session.status === 'IN_PROGRESS' && (
                    <button className="text-danger-button" type="button" disabled={busy || saving} onClick={() => setCancelConfirmation(true)}>放弃</button>
                  )}
                  <button className="modal-close" type="button" aria-label="保存并关闭学习会话" disabled={busy || saving} onClick={() => void requestClose()}>×</button>
                </div>
              </header>

              {session.status === 'IN_PROGRESS' ? (
                <div className="session-active-view">
                  <ol className="session-stepper" aria-label="学习步骤">
                    {['理解', '回忆', '总结'].map((label, index) => (
                      <li key={label} className={index === stepIndex ? 'active' : index < stepIndex ? 'complete' : ''}>
                        <span>{index < stepIndex ? '✓' : index + 1}</span>{label}
                      </li>
                    ))}
                  </ol>

                  {stepIndex === 0 && (
                    <div className="session-step session-understand">
                      <span className="session-section-label">本次学习内容</span>
                      <div className="session-content-card"><p>{session.description}</p></div>
                      {session.prerequisites.length > 0 && (
                        <div className="session-prerequisites">
                          <strong>开始前确认</strong>
                          <ul>{session.prerequisites.map((item) => (
                            <li key={item.nodeId}>{item.nodeName}<span>{STATUS_LABELS[item.status]}</span></li>
                          ))}</ul>
                        </div>
                      )}
                      <p className="session-guidance">阅读时先找出核心定义、它解决的问题，以及和已有知识的联系。</p>
                    </div>
                  )}

                  {stepIndex === 1 && (
                    <div className="session-step session-recall">
                      <span className="session-section-label">主动回忆</span>
                      <h3>暂时不看原文，用自己的话解释“{session.nodeName}”</h3>
                      <p>可以写下定义、一个例子，以及仍然不确定的地方。笔记会自动保存在本机。</p>
                      <label>
                        我的理解
                        <textarea
                          autoFocus
                          value={notes}
                          rows={9}
                          maxLength={5_000}
                          placeholder="例如：这个概念的核心是……；它适用于……；我还需要确认……"
                          onChange={(event) => updateNotes(event.target.value)}
                        />
                        <span className="session-character-count">{notes.length}/5000</span>
                      </label>
                    </div>
                  )}

                  {stepIndex === 2 && (
                    <div className="session-step session-summary">
                      <span className="session-section-label">学习总结</span>
                      <h3>确认这次留下的理解</h3>
                      {notes.trim() ? <div className="session-note-preview">{notes}</div> : (
                        <div className="session-note-missing">还没有学习总结，请返回上一步写下自己的理解。</div>
                      )}
                      <div className="session-evidence-note">
                        <strong>完成后会发生什么？</strong>
                        <p>系统只记录“完成了一次学习会话”，概念会进入学习中；这不代表已经掌握，掌握仍需自评或客观诊断。</p>
                      </div>
                    </div>
                  )}

                  <footer className="session-footer">
                    <span role="status">{saving ? '正在自动保存……' : '进度自动保存在本机'}</span>
                    <div>
                      {stepIndex > 0 && <button className="secondary-button" type="button" disabled={busy || saving} onClick={() => moveToStep(stepIndex - 1)}>上一步</button>}
                      {stepIndex < 2 ? (
                        <button className="primary-button" type="button" disabled={busy || saving} onClick={() => moveToStep(stepIndex + 1)}>{stepIndex === 0 ? '开始主动回忆' : '查看学习总结'}</button>
                      ) : (
                        <button className="primary-button" type="button" disabled={busy || saving || !notes.trim()} onClick={() => void completeSession()}>{busy ? '正在完成…' : '完成学习会话'}</button>
                      )}
                    </div>
                  </footer>
                </div>
              ) : (
                <div className="session-review-view">
                  <span className={`session-status-badge status-${session.status.toLowerCase()}`}>{statusLabel(session.status)}</span>
                  {session.status === 'COMPLETED' ? (
                    <>
                      <div className="completion-feedback-card">
                        <span aria-hidden="true">✓</span>
                        <div>
                          <small>学习里程碑</small>
                          <strong>完成了一次主动学习</strong>
                          <p>你已经阅读、主动回忆并留下总结。“{session.nodeName}”会进入学习中，但不会因此被误判为已掌握。</p>
                          <em>下一步：做一次形成性练习巩固记忆，或通过客观诊断确认掌握。</em>
                        </div>
                      </div>
                      <h3>这次留下的学习总结</h3>
                      <div className="session-note-preview">{session.notes}</div>
                      <p>完成于 {session.completedAt ? formatDate(session.completedAt) : '—'}。该记录已进入学习证据时间线，但不直接代表掌握。</p>
                    </>
                  ) : <p>这次会话已取消，没有生成学习证据。</p>}
                  <button className="secondary-button" type="button" onClick={() => setSession(null)}>返回会话记录</button>
                </div>
              )}
            </>
          ) : (
            <div className="session-center">
              <header className="assessment-modal-header">
                <div>
                  <span className="modal-kicker">学习会话</span>
                  <h2 id="learning-session-title">继续学习或回看总结</h2>
                  <p>学习过程与总结只保存在本机。</p>
                </div>
                <button className="modal-close" type="button" aria-label="关闭学习会话" onClick={onClose}>×</button>
              </header>
              {activeSession && (
                <button className="session-resume-card" type="button" onClick={() => openHistory(activeSession)}>
                  <span>继续上次学习</span><strong>{activeSession.nodeName}</strong><small>已进行到第 {activeSession.stepIndex + 1}/3 步</small>
                </button>
              )}
              <section className="session-history" aria-labelledby="session-history-title">
                <div><strong id="session-history-title">最近 50 次会话</strong><span>{history.length} 条记录</span></div>
                {history.length ? (
                  <ol>{history.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => openHistory(item)}>
                        <span className={`session-status-badge status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span>
                        <div><strong>{item.nodeName}</strong><small>{actionLabel(item.action)} · {formatDate(item.startedAt)}</small></div>
                        <span aria-hidden="true">›</span>
                      </button>
                    </li>
                  ))}</ol>
                ) : <p className="assessment-empty-copy">还没有学习会话。从概念详情或“下一步建议”开始第一次学习。</p>}
              </section>
            </div>
          )}
        </section>
      </div>

      {cancelConfirmation && session && (
        <ConfirmDialog
          title="放弃这次学习会话？"
          description="草稿会保留在取消记录中，但不会生成学习证据，也不会改变概念状态。"
          confirmLabel="放弃会话"
          destructive
          onCancel={() => setCancelConfirmation(false)}
          onConfirm={() => void cancelSession()}
        />
      )}
    </>
  );
}
