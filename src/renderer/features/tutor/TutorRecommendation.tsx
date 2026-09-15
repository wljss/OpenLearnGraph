import { useCallback, useEffect, useState } from 'react';
import type { KnowledgeGraphDocument, TutorAction, TutorDecisionView } from '../../../shared/contracts';
import { errorMessage } from '../../errorMessage';

interface TutorRecommendationProps {
  graph: KnowledgeGraphDocument;
  structureDirty: boolean;
  disabled: boolean;
  onExecute: (decision: TutorDecisionView) => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
}

const ACTION_COPY: Record<TutorAction, { label: string; cta: string }> = {
  TEACH: { label: '开始学习', cta: '查看这个概念' },
  ASSESS: { label: '进行诊断', cta: '进入诊断' },
  PRACTICE: { label: '继续练习', cta: '查看学习记录' },
  REVIEW: { label: '回顾巩固', cta: '回顾这个概念' },
  REMEDIATE: { label: '针对性补强', cta: '查看薄弱点' },
  ADVANCE: { label: '进入下一步', cta: '学习这个概念' },
};

function actionCopy(decision: TutorDecisionView): { label: string; cta: string } {
  return decision.reasonCode === 'RESUME_DIAGNOSTIC'
    ? { label: '继续诊断', cta: '继续未完成诊断' }
    : ACTION_COPY[decision.action];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function responseLabel(decision: TutorDecisionView): string {
  if (decision.isStale) return '已失效';
  if (decision.response === 'ACCEPTED') return '已采纳';
  if (decision.response === 'DISMISSED') return '已忽略';
  return '待决定';
}

export function TutorRecommendation({
  graph,
  structureDirty,
  disabled,
  onExecute,
  onMessage,
}: TutorRecommendationProps): React.JSX.Element {
  const [decision, setDecision] = useState<TutorDecisionView | null>(null);
  const [history, setHistory] = useState<TutorDecisionView[]>([]);
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const requestKey = JSON.stringify({
    graphId: graph.id,
    nodes: graph.nodes.map((node) => [
      node.id,
      node.name,
      node.description,
      node.status,
      node.learningPhase,
      node.evidenceCount,
      node.latestEvidenceKind,
      node.latestEvidenceScoreEarned,
      node.latestEvidenceScorePossible,
      node.diagnosticQuestionCount,
    ]),
    edges: graph.edges.map((edge) => [edge.sourceNodeId, edge.targetNodeId]),
  });
  const loading = loadedRequestKey !== requestKey && !structureDirty;

  const refresh = useCallback(async (): Promise<void> => {
    if (structureDirty) return;
    try {
      const current = await window.openLearnGraph.tutor.getRecommendation(graph.id);
      const items = await window.openLearnGraph.tutor.listDecisions(graph.id);
      setDecision(current);
      setHistory(items);
    } catch (error) {
      setDecision(null);
      setHistory([]);
      onMessage(`学习建议加载失败：${errorMessage(error)}`, 'error');
    } finally {
      setLoadedRequestKey(requestKey);
    }
  }, [graph.id, onMessage, requestKey, structureDirty]);

  useEffect(() => {
    let active = true;
    if (structureDirty) {
      return () => { active = false; };
    }
    void window.openLearnGraph.tutor.getRecommendation(graph.id).then(async (current) => {
      const items = await window.openLearnGraph.tutor.listDecisions(graph.id);
      if (active) {
        setDecision(current);
        setHistory(items);
      }
    }).catch((error: unknown) => {
      if (active) {
        setDecision(null);
        setHistory([]);
        onMessage(`学习建议加载失败：${errorMessage(error)}`, 'error');
      }
    }).finally(() => {
      if (active) setLoadedRequestKey(requestKey);
    });
    return () => { active = false; };
  }, [graph.id, onMessage, requestKey, structureDirty]);

  const respond = async (
    item: TutorDecisionView,
    response: 'PENDING' | 'ACCEPTED' | 'DISMISSED',
    execute = false,
  ): Promise<void> => {
    setResponding(true);
    try {
      const updated = await window.openLearnGraph.tutor.respondDecision({ decisionId: item.id, response });
      setDecision((current) => current?.id === updated.id ? updated : current);
      setHistory((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      if (execute) onExecute(updated);
      else if (response === 'DISMISSED') onMessage('已暂时忽略这条建议，可随时恢复。');
      else onMessage('学习建议已恢复。', 'success');
    } catch (error) {
      onMessage(`学习建议操作失败：${errorMessage(error)}`, 'error');
      await refresh().catch(() => undefined);
    } finally {
      setResponding(false);
    }
  };

  if (structureDirty) {
    return (
      <section className="tutor-recommendation tutor-paused" aria-label="下一步学习建议">
        <span className="tutor-mark" aria-hidden="true">◎</span>
        <div><strong>保存后生成下一步建议</strong><p>当前结构尚未保存，保存后会按最新图谱重新判断。</p></div>
      </section>
    );
  }

  if (loading) {
    return <section className="tutor-recommendation tutor-loading" aria-label="下一步学习建议">正在分析下一步学习方向……</section>;
  }

  if (!decision) {
    return (
      <section className="tutor-recommendation tutor-empty" aria-label="下一步学习建议">
        <span className="tutor-mark" aria-hidden="true">◎</span>
        <div><strong>添加概念后，我会在这里给出下一步建议</strong><p>建议完全由本机规则和你的学习证据生成。</p></div>
      </section>
    );
  }

  const copy = actionCopy(decision);
  const dismissed = decision.response === 'DISMISSED';

  return (
    <section className={`tutor-recommendation${dismissed ? ' tutor-dismissed' : ''}`} aria-labelledby="tutor-heading">
      <span className="tutor-mark" aria-hidden="true">◎</span>
      <div className="tutor-main">
        <div className="tutor-title-row">
          <span className="tutor-kicker">下一步建议 · 本地规则 v{decision.sourceVersion}</span>
          <span className={`tutor-response response-${decision.response.toLowerCase()}`}>{responseLabel(decision)}</span>
        </div>
        {dismissed ? (
          <div className="tutor-dismissed-copy">
            <strong id="tutor-heading">已忽略：{copy.label}“{decision.targetNodeName}”</strong>
            <button type="button" disabled={disabled || responding} onClick={() => void respond(decision, 'PENDING')}>恢复建议</button>
          </div>
        ) : (
          <>
            <h2 id="tutor-heading">{copy.label}：{decision.targetNodeName}</h2>
            <p>{decision.reason}</p>
            <details className="tutor-evidence">
              <summary>为什么这样建议</summary>
              <ul>{decision.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          </>
        )}
      </div>
      {!dismissed && (
        <div className="tutor-actions">
          <button
            className="primary-button"
            type="button"
            disabled={disabled || responding}
            onClick={() => void respond(decision, 'ACCEPTED', true)}
          >
            {responding ? '处理中…' : decision.response === 'ACCEPTED' ? `继续：${copy.cta}` : copy.cta}
          </button>
          <button type="button" disabled={disabled || responding} onClick={() => void respond(decision, 'DISMISSED')}>暂不采用</button>
        </div>
      )}
      {history.length > 1 && (
        <details className="tutor-history">
          <summary>历史建议 {history.length}</summary>
          <ol>
            {history.map((item) => (
              <li key={item.id}>
                <span>{actionCopy(item).label} · {item.targetNodeName}</span>
                <small>{formatDate(item.createdAt)} · {responseLabel(item)}</small>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
