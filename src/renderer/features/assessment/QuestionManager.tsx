import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssessmentQuestionView, KnowledgeNodeView } from '../../../shared/contracts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorMessage } from '../../errorMessage';

interface QuestionManagerProps {
  node: KnowledgeNodeView;
  onClose: () => void;
  onQuestionCountChange: (nodeId: string, count: number) => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

interface EditableOption {
  key: string;
  text: string;
  isCorrect: boolean;
}

type Confirmation = 'close' | 'reset' | { deleteQuestion: AssessmentQuestionView };

function blankOptions(): EditableOption[] {
  return [0, 1, 2, 3].map((index) => ({
    key: crypto.randomUUID(),
    text: '',
    isCorrect: index === 0,
  }));
}

export function QuestionManager({
  node,
  onClose,
  onQuestionCountChange,
  onMessage,
}: QuestionManagerProps): React.JSX.Element {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [questions, setQuestions] = useState<AssessmentQuestionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [explanation, setExplanation] = useState('');
  const [options, setOptions] = useState<EditableOption[]>(blankOptions);
  const [formTouched, setFormTouched] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setPrompt('');
    setExplanation('');
    setOptions(blankOptions());
    setFormTouched(false);
    queueMicrotask(() => promptRef.current?.focus());
  }, []);

  useEffect(() => {
    let active = true;
    void window.openLearnGraph.assessments.listQuestions(node.id).then((items) => {
      if (!active) return;
      setQuestions(items);
      onQuestionCountChange(node.id, items.length);
    }).catch((error: unknown) => {
      if (active) onMessage(`诊断题加载失败：${errorMessage(error)}`, 'error');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [node.id, onMessage, onQuestionCountChange]);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  const requestClose = useCallback(() => {
    if (busy) return;
    if (formTouched) setConfirmation('close');
    else onClose();
  }, [busy, formTouched, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || confirmation) return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmation, requestClose]);

  const editQuestion = (question: AssessmentQuestionView): void => {
    if (formTouched || busy) return;
    setEditingId(question.id);
    setPrompt(question.prompt);
    setExplanation(question.explanation);
    setOptions(question.options.map((option) => ({
      key: option.id,
      text: option.text,
      isCorrect: option.isCorrect,
    })));
    setFormTouched(false);
    queueMicrotask(() => promptRef.current?.focus());
  };

  const updateOption = (key: string, text: string): void => {
    setOptions((current) => current.map((option) => option.key === key ? { ...option, text } : option));
    setFormTouched(true);
  };

  const markCorrect = (key: string): void => {
    setOptions((current) => current.map((option) => ({ ...option, isCorrect: option.key === key })));
    setFormTouched(true);
  };

  const saveQuestion = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!prompt.trim() || options.some((option) => !option.text.trim())) {
      onMessage('请填写题目和全部选项。', 'error');
      return;
    }
    setBusy(true);
    try {
      const saved = await window.openLearnGraph.assessments.saveQuestion({
        id: editingId ?? undefined,
        nodeId: node.id,
        prompt,
        explanation,
        options: options.map((option) => ({ text: option.text, isCorrect: option.isCorrect })),
      });
      const next = editingId
        ? questions.map((question) => question.id === saved.id ? saved : question)
        : [...questions, saved];
      setQuestions(next);
      onQuestionCountChange(node.id, next.length);
      onMessage(editingId ? '诊断题已更新。旧作答仍保留原题快照。' : '诊断题已保存到本机。', 'success');
      resetForm();
    } catch (error) {
      onMessage(`诊断题保存失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteQuestion = async (question: AssessmentQuestionView): Promise<void> => {
    setConfirmation(null);
    setBusy(true);
    try {
      await window.openLearnGraph.assessments.deleteQuestion(question.id);
      const next = questions.filter((item) => item.id !== question.id);
      setQuestions(next);
      onQuestionCountChange(node.id, next.length);
      if (editingId === question.id) resetForm();
      onMessage('诊断题已删除；既有作答快照不受影响。', 'success');
    } catch (error) {
      onMessage(`诊断题删除失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const valid = Boolean(prompt.trim()) && options.length >= 2 && options.every((option) => option.text.trim());

  return (
    <>
      <div
        className="dialog-backdrop assessment-backdrop"
        role="presentation"
        aria-hidden={confirmation ? 'true' : undefined}
        onMouseDown={requestClose}
      >
        <section
        className="question-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="assessment-modal-header">
          <div>
            <span className="modal-kicker">诊断题库</span>
            <h2 id="question-manager-title">{node.name}</h2>
            <p>至少准备 2 道题后，这个概念才会进入图谱诊断。</p>
          </div>
          <button className="modal-close" type="button" aria-label="关闭诊断题库" disabled={busy} onClick={requestClose}>×</button>
        </header>

        <div className="question-manager-body">
          <aside className="question-list-panel" aria-label="已有诊断题">
            <div className="question-list-heading">
              <strong>已有题目</strong><span>{questions.length} 道</span>
            </div>
            {loading ? <p className="assessment-empty-copy">正在加载题库……</p> : questions.length ? (
              <ol className="question-list">
                {questions.map((question, index) => (
                  <li key={question.id} className={editingId === question.id ? 'active' : ''}>
                    <button type="button" disabled={busy || formTouched} onClick={() => editQuestion(question)}>
                      <span>{index + 1}</span><strong>{question.prompt}</strong>
                    </button>
                    <button
                      className="question-delete"
                      type="button"
                      aria-label={`删除题目：${question.prompt}`}
                      disabled={busy}
                      onClick={() => setConfirmation({ deleteQuestion: question })}
                    >删除</button>
                  </li>
                ))}
              </ol>
            ) : <p className="assessment-empty-copy">还没有题目。先创建第一道单选题。</p>}
          </aside>

          <form className="question-editor" onSubmit={(event) => void saveQuestion(event)}>
            <div className="question-editor-heading">
              <strong>{editingId ? '编辑题目' : '新建题目'}</strong>
              {(editingId || formTouched) && (
                <button type="button" disabled={busy} onClick={() => formTouched ? setConfirmation('reset') : resetForm()}>
                  放弃当前编辑
                </button>
              )}
            </div>
            <label>
              题目
              <textarea
                ref={promptRef}
                aria-label="题目"
                rows={3}
                maxLength={2_000}
                value={prompt}
                disabled={busy}
                placeholder="例如：矩阵 A 的形状为 2×3，矩阵 B 至少应满足什么条件才能计算 AB？"
                onChange={(event) => { setPrompt(event.target.value); setFormTouched(true); }}
              />
              <span className="character-count">{prompt.length}/2000</span>
            </label>
            <fieldset disabled={busy}>
              <legend>选项与正确答案</legend>
              <p>选择左侧圆点指定唯一正确答案。</p>
              <div className="question-options-editor">
                {options.map((option, index) => (
                  <div key={option.key} className="question-option-row">
                    <input
                      type="radio"
                      name="correct-option"
                      aria-label={`将选项 ${index + 1} 设为正确答案`}
                      checked={option.isCorrect}
                      onChange={() => markCorrect(option.key)}
                    />
                    <input
                      type="text"
                      aria-label={`选项 ${index + 1}`}
                      maxLength={500}
                      value={option.text}
                      placeholder={`选项 ${index + 1}`}
                      onChange={(event) => updateOption(option.key, event.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={`移除选项 ${index + 1}`}
                      disabled={options.length <= 2}
                      onClick={() => {
                        const next = options.filter((item) => item.key !== option.key);
                        if (option.isCorrect) next[0] = { ...next[0], isCorrect: true };
                        setOptions(next);
                        setFormTouched(true);
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
              <button
                className="add-option-button"
                type="button"
                disabled={options.length >= 6}
                onClick={() => {
                  setOptions((current) => [...current, { key: crypto.randomUUID(), text: '', isCorrect: false }]);
                  setFormTouched(true);
                }}
              >＋ 添加选项</button>
            </fieldset>
            <label>
              答案解析（可选）
              <textarea
                aria-label="答案解析（可选）"
                rows={3}
                maxLength={5_000}
                value={explanation}
                disabled={busy}
                placeholder="提交诊断后向学习者解释为什么。"
                onChange={(event) => { setExplanation(event.target.value); setFormTouched(true); }}
              />
            </label>
            <button className="primary-button question-save" type="submit" disabled={busy || !valid}>
              {busy ? '正在保存…' : editingId ? '保存题目修改' : '保存诊断题'}
            </button>
          </form>
        </div>
        </section>
      </div>

      {confirmation === 'close' && (
        <ConfirmDialog
          title="放弃尚未保存的题目？"
          description="当前题目内容还没有保存，关闭后将丢失这些修改。"
          confirmLabel="放弃并关闭"
          destructive
          onCancel={() => setConfirmation(null)}
          onConfirm={onClose}
        />
      )}
      {confirmation === 'reset' && (
        <ConfirmDialog
          title="放弃当前题目修改？"
          description="未保存的题目内容将被清空。已经保存的题目不会受影响。"
          confirmLabel="放弃修改"
          destructive
          onCancel={() => setConfirmation(null)}
          onConfirm={() => { setConfirmation(null); resetForm(); }}
        />
      )}
      {confirmation && typeof confirmation === 'object' && (
        <ConfirmDialog
          title="删除这道诊断题？"
          description="题目会从当前题库移除；过去诊断中的题目快照和作答结果仍会保留。"
          confirmLabel="删除题目"
          destructive
          onCancel={() => setConfirmation(null)}
          onConfirm={() => void deleteQuestion(confirmation.deleteQuestion)}
        />
      )}
    </>
  );
}
