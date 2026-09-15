import { useEffect, useRef, useState } from 'react';
import type {
  KnowledgeGraphDocument,
  KnowledgeNodeView,
  LearningEvidenceView,
  SelfAssessmentRating,
} from '../../../shared/contracts';
import { SELF_ASSESSMENT_RATING_LABELS, STATUS_LABELS } from '../../learningLabels';

interface NodeDetailsProps {
  graph: KnowledgeGraphDocument | null;
  node: KnowledgeNodeView | null;
  evidence: LearningEvidenceView[];
  evidenceLoading: boolean;
  focusNodeNameId: string | null;
  structureDirty: boolean;
  learningBusy: boolean;
  interactionBusy: boolean;
  onAddNode: () => void;
  onUpdate: (node: KnowledgeNodeView) => void;
  onDelete: (nodeId: string) => void;
  onStartLearning: (nodeId: string) => Promise<boolean>;
  onRecordSelfAssessment: (
    nodeId: string,
    rating: SelfAssessmentRating,
    note: string,
  ) => Promise<boolean>;
  onManageQuestions: (nodeId: string) => void;
}

const ratings = [1, 2, 3, 4, 5] as const;

function formatEvidenceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function NodeDetails({
  graph,
  node,
  evidence,
  evidenceLoading,
  focusNodeNameId,
  structureDirty,
  learningBusy,
  interactionBusy,
  onAddNode,
  onUpdate,
  onDelete,
  onStartLearning,
  onRecordSelfAssessment,
  onManageQuestions,
}: NodeDetailsProps): React.JSX.Element {
  const nameInputRef = useRef<HTMLInputElement>(null);
  const lastFocusedNodeId = useRef<string | null>(null);
  const [rating, setRating] = useState<SelfAssessmentRating | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!node || node.id !== focusNodeNameId || lastFocusedNodeId.current === node.id) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
    lastFocusedNodeId.current = node.id;
  }, [focusNodeNameId, node]);

  if (!graph) return (
    <aside className="details-panel empty-details">
      <div className="empty-icon">◇</div>
      <h2>先创建知识图谱</h2>
      <p>创建图谱后，就可以在这里整理概念详情。</p>
    </aside>
  );
  if (!node) return (
    <aside className="details-panel empty-details">
      <div className="empty-icon">◇</div>
      <h2>{graph.nodes.length ? '选择一个概念' : '还没有概念'}</h2>
      <p>{graph.nodes.length ? '查看概念详情、学习状态与证据记录。' : '添加知识点后，可以在这里填写名称和描述。'}</p>
      {!graph.nodes.length && <button className="secondary-button details-empty-action" type="button" disabled={interactionBusy} onClick={onAddNode}>添加第一个概念</button>}
    </aside>
  );

  const prerequisites = graph.edges.filter((edge) => edge.targetNodeId === node.id)
    .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.sourceNodeId))
    .filter((candidate): candidate is KnowledgeNodeView => Boolean(candidate));
  const dependents = graph.edges.filter((edge) => edge.sourceNodeId === node.id)
    .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.targetNodeId))
    .filter((candidate): candidate is KnowledgeNodeView => Boolean(candidate));
  const connectedEdgeCount = prerequisites.length + dependents.length;

  const submitSelfAssessment = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!rating) return;
    const saved = await onRecordSelfAssessment(node.id, rating, note.trim());
    if (saved) {
      setRating(null);
      setNote('');
    }
  };

  return (
    <aside className="details-panel">
      <div className="panel-kicker">概念详情</div>
      <label>
        名称
        <input
          ref={nameInputRef}
          className={!node.name.trim() ? 'input-invalid' : undefined}
          aria-invalid={!node.name.trim()}
          value={node.name}
          maxLength={160}
          disabled={interactionBusy}
          onChange={(event) => onUpdate({ ...node, name: event.target.value })}
        />
        {!node.name.trim() && <span className="validation-hint">概念名称不能为空，保存前请填写。</span>}
      </label>
      <label>
        描述
        <textarea value={node.description} rows={5} maxLength={10_000} disabled={interactionBusy} placeholder="说明这个概念是什么，以及学习它的意义……" onChange={(event) => onUpdate({ ...node, description: event.target.value })} />
      </label>

      <section className="learning-card" aria-labelledby="learning-status-heading">
        <div className="learning-card-header">
          <span className="field-label" id="learning-status-heading">学习状态</span>
          <span className={`status-badge badge-${node.status.toLowerCase()}`}>
            <span className="status-dot" aria-hidden="true" />{STATUS_LABELS[node.status]}
          </span>
        </div>
        <p className="status-reason">{node.statusReason}</p>
        {node.status === 'AVAILABLE' && (
          <button
            className="primary-button learning-action"
            type="button"
            disabled={structureDirty || interactionBusy}
            onClick={() => void onStartLearning(node.id)}
          >
            {learningBusy ? '正在记录…' : '开始学习'}
          </button>
        )}
        {node.status === 'LOCKED' && <p className="learning-guidance">完成先修概念后即可开始；如果你已经掌握，也可以直接记录自评。</p>}
        {node.status === 'MASTERED' && <p className="learning-guidance success">这项掌握结论来自最近一次自评，可继续补充新证据。</p>}
        {structureDirty && <p className="structure-save-hint">请先保存图谱结构，再记录学习状态。</p>}
      </section>

      <form className="self-assessment" onSubmit={(event) => void submitSelfAssessment(event)}>
        <fieldset disabled={structureDirty || interactionBusy}>
          <legend>记录一次自评</legend>
          <p>选择你现在能做到的程度。4–5 分会标记为已掌握，新的自评会更新状态。</p>
          <div className="rating-options" role="group" aria-label="掌握程度">
            {ratings.map((value) => (
              <button
                key={value}
                className={rating === value ? 'selected' : ''}
                type="button"
                aria-pressed={rating === value}
                aria-label={`${value} 分：${SELF_ASSESSMENT_RATING_LABELS[value]}`}
                title={`${value} 分：${SELF_ASSESSMENT_RATING_LABELS[value]}`}
                onClick={() => setRating(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="rating-description" aria-live="polite">
            {rating ? `${rating} 分 · ${SELF_ASSESSMENT_RATING_LABELS[rating]}` : '请选择 1–5 分'}
          </div>
          {node.latestEvidenceKind === 'DIAGNOSTIC_RESULT' && (
            <p className="rating-impact objective">自评会保留在证据时间线中，但不会覆盖最近一次客观诊断结果。</p>
          )}
          {rating && node.latestEvidenceKind !== 'DIAGNOSTIC_RESULT' && node.status === 'MASTERED' && rating < 4 && (
            <p className="rating-impact warning">这会把当前状态调整为“学习中”，并可能重新锁定后续概念。</p>
          )}
          {rating && node.latestEvidenceKind !== 'DIAGNOSTIC_RESULT' && node.status === 'LOCKED' && rating >= 4 && (
            <p className="rating-impact success">这会记录已有掌握情况，并重新计算后续概念是否可以学习。</p>
          )}
          <label className="assessment-note">
            学习备注（可选）
            <textarea
              value={note}
              rows={3}
              maxLength={2_000}
              placeholder="例如：能独立推导，但实际应用还不熟练。"
              onChange={(event) => setNote(event.target.value)}
            />
            <span className="character-count">{note.length}/2000</span>
          </label>
          <button className="secondary-button assessment-submit" type="submit" disabled={!rating || structureDirty || learningBusy}>
            {learningBusy ? '正在保存…' : '记录自评'}
          </button>
        </fieldset>
      </form>

      <section className="detail-section question-bank-card" aria-labelledby="question-bank-heading">
        <div className="section-heading-row">
          <span className="field-label" id="question-bank-heading">诊断题库</span>
          <span>{node.diagnosticQuestionCount} 道</span>
        </div>
        <p className="field-hint">
          {node.diagnosticQuestionCount >= 2
            ? '题目数量已满足图谱诊断要求。'
            : `还需 ${2 - node.diagnosticQuestionCount} 道题才能参与图谱诊断。`}
        </p>
        <button
          className="secondary-button manage-questions-button"
          type="button"
          disabled={structureDirty || interactionBusy}
          onClick={() => onManageQuestions(node.id)}
        >管理诊断题</button>
      </section>

      <section className="detail-section evidence-section" aria-labelledby="evidence-heading">
        <div className="section-heading-row">
          <span className="field-label" id="evidence-heading">学习证据</span>
          <span>{node.evidenceCount} 条</span>
        </div>
        {evidenceLoading ? (
          <p className="field-hint">正在加载学习记录……</p>
        ) : evidence.length ? (
          <ol className="evidence-list">
            {evidence.map((item) => (
              <li key={item.id}>
                <span className={`evidence-mark ${(
                  (item.kind === 'SELF_ASSESSMENT' && (item.rating ?? 0) >= 4)
                  || (item.kind === 'DIAGNOSTIC_RESULT' && (item.scoreEarned ?? 0) / (item.scorePossible ?? 1) >= 0.8)
                ) ? 'mastered' : ''}`} aria-hidden="true" />
                <div>
                  <strong>{item.kind === 'STUDY_STARTED'
                    ? '开始学习'
                    : item.kind === 'SELF_ASSESSMENT'
                      ? `自评 ${item.rating}/5 · ${SELF_ASSESSMENT_RATING_LABELS[item.rating as SelfAssessmentRating]}`
                      : `客观诊断 · ${item.scoreEarned}/${item.scorePossible} 题正确`}</strong>
                  {item.note && <p>{item.note}</p>}
                  <time dateTime={item.occurredAt}>{formatEvidenceTime(item.occurredAt)}</time>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="field-hint">还没有学习证据。开始学习或记录第一次自评吧。</p>
        )}
      </section>

      <div className="detail-section">
        <span className="field-label">先修概念</span>
        {prerequisites.length ? <ul className="prerequisite-list">{prerequisites.map((item) => <li key={item.id}>{item.name} · {STATUS_LABELS[item.status]}</li>)}</ul> : <p className="field-hint">暂无先修概念</p>}
      </div>
      <div className="detail-section">
        <span className="field-label">后续概念</span>
        {dependents.length ? <ul className="prerequisite-list">{dependents.map((item) => <li key={item.id}>{item.name} · {STATUS_LABELS[item.status]}</li>)}</ul> : <p className="field-hint">暂无后续概念</p>}
      </div>
      <button className="danger-button" type="button" disabled={interactionBusy} onClick={() => onDelete(node.id)}>
        删除概念{connectedEdgeCount || node.evidenceCount || node.diagnosticQuestionCount ? '及关联数据' : ''}
      </button>
    </aside>
  );
}
