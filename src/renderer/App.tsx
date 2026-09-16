import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GraphSummary,
  KnowledgeGraphDocument,
  KnowledgeNodeView,
  LearningEvidenceView,
  RecordLearningEvidenceInput,
  SaveGraphInput,
  SelfAssessmentRating,
  TutorDecisionView,
} from '../shared/contracts';
import { projectGraphLearning } from '../shared/learningProjection';
import { ConfirmDialog } from './components/ConfirmDialog';
import { errorMessage } from './errorMessage';
import { DiagnosticRunner } from './features/assessment/DiagnosticRunner';
import { QuestionManager } from './features/assessment/QuestionManager';
import { GraphCanvas } from './features/knowledge-graph/GraphCanvas';
import { NodeDetails } from './features/knowledge-graph/NodeDetails';
import { TutorRecommendation } from './features/tutor/TutorRecommendation';
import {
  LearningSessionRunner,
  type LearningSessionLaunch,
} from './features/session/LearningSessionRunner';

type NoticeTone = 'info' | 'success' | 'error';

interface Notice {
  text: string;
  tone: NoticeTone;
}

interface Confirmation {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  action: () => void | Promise<void>;
}

function nextConceptName(nodes: KnowledgeNodeView[]): string {
  const existingNames = new Set(nodes.map((node) => node.name.trim().toLocaleLowerCase()));
  let index = 1;
  while (existingNames.has(`新概念 ${index}`.toLocaleLowerCase())) index += 1;
  return `新概念 ${index}`;
}

function nextNodePosition(nodes: KnowledgeNodeView[]): { x: number; y: number } {
  const columns = 4;
  for (let index = 0; index <= nodes.length; index += 1) {
    const candidate = {
      x: 90 + (index % columns) * 230,
      y: 90 + Math.floor(index / columns) * 140,
    };
    const occupied = nodes.some((node) => (
      Math.abs(node.position.x - candidate.x) < 180
      && Math.abs(node.position.y - candidate.y) < 90
    ));
    if (!occupied) return candidate;
  }
  return { x: 90, y: 90 + Math.ceil(nodes.length / columns) * 140 };
}

function toSummary(graph: KnowledgeGraphDocument): GraphSummary {
  const { id, name, createdAt, updatedAt } = graph;
  return { id, name, createdAt, updatedAt };
}

export function App(): React.JSX.Element {
  const graphNameInputRef = useRef<HTMLInputElement>(null);
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraphDocument | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [newNodeToFocusId, setNewNodeToFocusId] = useState<string | null>(null);
  const [newGraphName, setNewGraphName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>({
    text: '正在加载本地知识图谱……',
    tone: 'info',
  });
  const [busy, setBusy] = useState(true);
  const [learningBusy, setLearningBusy] = useState(false);
  const [evidenceState, setEvidenceState] = useState<{
    nodeId: string;
    items: LearningEvidenceView[];
  } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [questionManagerNodeId, setQuestionManagerNodeId] = useState<string | null>(null);
  const [diagnosticNodeIds, setDiagnosticNodeIds] = useState<string[] | null>(null);
  const [sessionLaunch, setSessionLaunch] = useState<LearningSessionLaunch | null>(null);
  const [recommendationRevision, setRecommendationRevision] = useState(0);
  const [sessionDraftDirty, setSessionDraftDirty] = useState(false);
  const overlayOpen = Boolean(questionManagerNodeId || diagnosticNodeIds || sessionLaunch);
  const interactionBusy = busy || learningBusy || overlayOpen;

  const showNotice = useCallback((text: string, tone: NoticeTone = 'info'): void => {
    setNotice({ text, tone });
  }, []);

  useEffect(() => {
    window.openLearnGraph.lifecycle.setUnsavedChanges(dirty || sessionDraftDirty);
  }, [dirty, sessionDraftDirty]);

  const loadGraph = useCallback(async (graphId: string): Promise<void> => {
    setBusy(true);
    try {
      const loaded = await window.openLearnGraph.graphs.load(graphId);
      setGraph(loaded);
      if (!loaded) setGraphs((current) => current.filter((item) => item.id !== graphId));
      setSelectedNodeId(null);
      setNewNodeToFocusId(null);
      setDirty(false);
      showNotice(loaded ? '已从本机加载知识图谱。' : '该知识图谱不存在。', loaded ? 'success' : 'error');
    } catch (error) {
      showNotice(`加载失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  }, [showNotice]);

  useEffect(() => {
    let active = true;
    void window.openLearnGraph.graphs.list().then(async (items) => {
      if (!active) return;
      setGraphs(items);
      if (items[0]) await loadGraph(items[0].id);
      else {
        showNotice('创建第一个知识图谱，开始搭建学习地图。');
        setBusy(false);
      }
    }).catch((error: unknown) => {
      if (active) {
        showNotice(`加载失败：${errorMessage(error)}`, 'error');
        setBusy(false);
      }
    });
    return () => { active = false; };
  }, [loadGraph, showNotice]);

  const selectedNode = useMemo(
    () => graph?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph, selectedNodeId],
  );
  const questionManagerNode = useMemo(
    () => graph?.nodes.find((node) => node.id === questionManagerNodeId) ?? null,
    [graph, questionManagerNodeId],
  );
  const selectedEvidence = evidenceState && evidenceState.nodeId === selectedNode?.id ? evidenceState.items : [];
  const evidenceLoading = Boolean(
    selectedNode
    && selectedNode.evidenceCount > 0
    && evidenceState?.nodeId !== selectedNode.id,
  );

  useEffect(() => {
    const nodeId = selectedNode?.id;
    if (!nodeId || selectedNode.evidenceCount === 0) return;

    let active = true;
    void window.openLearnGraph.learning.listEvidence(nodeId).then((items) => {
      if (active) setEvidenceState({ nodeId, items });
    }).catch((error: unknown) => {
      if (active) {
        setEvidenceState({ nodeId, items: [] });
        showNotice(`学习记录加载失败：${errorMessage(error)}`, 'error');
      }
    });
    return () => { active = false; };
  }, [selectedNode?.evidenceCount, selectedNode?.id, showNotice]);

  const replaceGraph = useCallback((next: KnowledgeGraphDocument): void => {
    setGraph(projectGraphLearning(next));
    setDirty(true);
    showNotice('有尚未保存的更改。按 Ctrl+S 保存。');
  }, [showNotice]);

  const performCreateGraph = useCallback(async (name: string): Promise<void> => {
    setBusy(true);
    try {
      const created = await window.openLearnGraph.graphs.create({ name });
      setGraphs((current) => [toSummary(created), ...current.filter((item) => item.id !== created.id)]);
      setGraph(created);
      setNewGraphName('');
      setDirty(false);
      setSelectedNodeId(null);
      setNewNodeToFocusId(null);
      showNotice('知识图谱已创建并保存到本机。', 'success');
    } catch (error) {
      showNotice(`创建失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  }, [showNotice]);

  const createGraph = (event: React.FormEvent): void => {
    event.preventDefault();
    const name = newGraphName.trim();
    if (!name) {
      showNotice('图谱名称不能为空。', 'error');
      return;
    }
    if (dirty) {
      setConfirmation({
        title: '创建新的知识图谱？',
        description: '当前图谱还有尚未保存的更改。继续创建会放弃这些更改。',
        confirmLabel: '放弃更改并创建',
        destructive: true,
        action: () => performCreateGraph(name),
      });
      return;
    }
    void performCreateGraph(name);
  };

  const requestLoadGraph = (graphId: string): void => {
    if (graphId === graph?.id || interactionBusy) return;
    if (dirty) {
      setConfirmation({
        title: '切换知识图谱？',
        description: '当前图谱还有尚未保存的更改。切换后，这些更改将会丢失。',
        confirmLabel: '放弃更改并切换',
        destructive: true,
        action: () => loadGraph(graphId),
      });
      return;
    }
    void loadGraph(graphId);
  };

  const addNode = useCallback((): void => {
    if (!graph) return;
    const node: KnowledgeNodeView = {
      id: crypto.randomUUID(),
      graphId: graph.id,
      name: nextConceptName(graph.nodes),
      description: '',
      position: nextNodePosition(graph.nodes),
      status: 'AVAILABLE',
      learningPhase: 'NOT_STARTED',
      statusReason: '没有未完成的先修概念，可以开始学习。',
      evidenceCount: 0,
      lastEvidenceAt: null,
      latestEvidenceKind: null,
      latestEvidenceScoreEarned: null,
      latestEvidenceScorePossible: null,
      diagnosticQuestionCount: 0,
    };
    replaceGraph({ ...graph, nodes: [...graph.nodes, node] });
    setSelectedNodeId(node.id);
    setNewNodeToFocusId(node.id);
    showNotice('已添加概念。可以直接输入名称，完成后请保存。');
  }, [graph, replaceGraph, showNotice]);

  const updateNode = (updated: KnowledgeNodeView): void => {
    if (!graph) return;
    replaceGraph({
      ...graph,
      nodes: graph.nodes.map((node) => node.id === updated.id ? updated : node),
    });
  };

  const recordLearningEvidence = useCallback(async (
    input: RecordLearningEvidenceInput,
  ): Promise<boolean> => {
    if (dirty) {
      showNotice('请先保存图谱结构，再记录学习状态。', 'error');
      return false;
    }
    setLearningBusy(true);
    try {
      const result = await window.openLearnGraph.learning.recordEvidence(input);
      setGraph(result.graph);
      setEvidenceState((current) => ({
        nodeId: result.evidence.nodeId,
        items: [
          result.evidence,
          ...(current?.nodeId === result.evidence.nodeId
            ? current.items.filter((item) => item.id !== result.evidence.id)
            : []),
        ],
      }));
      const resultingNode = result.graph.nodes.find((node) => node.id === input.nodeId);
      if (input.kind === 'STUDY_STARTED') {
        showNotice('已开始学习，并记录到本机证据时间线。', 'success');
      } else if (resultingNode?.latestEvidenceKind === 'DIAGNOSTIC_RESULT') {
        showNotice('自评已记录；已有客观诊断结果继续决定当前状态，如需更新请重新诊断。', 'success');
      } else if (input.rating >= 4) {
        showNotice('自评已记录：概念现为“已掌握”，相关后续概念已重新计算。', 'success');
      } else {
        showNotice('自评已记录：概念现为“学习中”，相关后续概念已重新计算。', 'success');
      }
      return true;
    } catch (error) {
      showNotice(`学习记录保存失败：${errorMessage(error)}`, 'error');
      return false;
    } finally {
      setLearningBusy(false);
    }
  }, [dirty, showNotice]);

  const openLearningSession = useCallback((nodeId: string): void => {
    const node = graph?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    if (!node.description.trim()) {
      setSelectedNodeId(node.id);
      showNotice('请先补充并保存概念描述，再开始学习会话。', 'error');
      return;
    }
    setSessionLaunch({ nodeId, action: 'TEACH' });
  }, [graph, showNotice]);

  const updateQuestionCount = useCallback((nodeId: string, count: number): void => {
    setGraph((current) => current ? {
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId
        ? { ...node, diagnosticQuestionCount: count }
        : node),
    } : current);
  }, []);

  const acceptDiagnosticGraph = useCallback((updatedGraph: KnowledgeGraphDocument): void => {
    setGraph(updatedGraph);
    setDirty(false);
    setEvidenceState(null);
  }, []);

  const notifySessionChanged = useCallback((): void => {
    setRecommendationRevision((value) => value + 1);
  }, []);

  const executeTutorDecision = useCallback((decision: TutorDecisionView): void => {
    if (decision.action === 'ASSESS') {
      setDiagnosticNodeIds(decision.targetNodeId ? [decision.targetNodeId] : []);
      showNotice('已打开诊断中心；只有提交诊断后才会写入学习证据。');
      return;
    }
    if (decision.action === 'TEACH' || decision.action === 'ADVANCE') {
      if (decision.context.sessionId) {
        setSessionLaunch({ sessionId: decision.context.sessionId });
        return;
      }
      const node = graph?.nodes.find((candidate) => candidate.id === decision.targetNodeId);
      if (!node?.description.trim()) {
        if (node) setSelectedNodeId(node.id);
        showNotice('这个概念还没有学习内容，请先补充并保存右侧的概念描述。', 'error');
        return;
      }
      setSessionLaunch({
        nodeId: node.id,
        action: decision.action,
        sourceDecisionId: decision.id,
      });
      return;
    }
    if (decision.targetNodeId) {
      setSelectedNodeId(decision.targetNodeId);
      setNewNodeToFocusId(null);
      showNotice(`已定位到“${decision.targetNodeName}”；请根据建议自行学习或记录证据。`, 'success');
    }
  }, [graph, showNotice]);

  const recordSelfAssessment = useCallback((
    nodeId: string,
    rating: SelfAssessmentRating,
    note: string,
  ): Promise<boolean> => (
    recordLearningEvidence({ nodeId, kind: 'SELF_ASSESSMENT', rating, note })
  ), [recordLearningEvidence]);

  const deleteNode = (nodeId: string): void => {
    if (!graph) return;
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return;
    const connectedEdgeCount = graph.edges.filter(
      (edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId,
    ).length;
    const deletionConsequences = [
      connectedEdgeCount ? `${connectedEdgeCount} 条相连的先修关系` : null,
      node.evidenceCount ? `${node.evidenceCount} 条学习证据` : null,
      node.diagnosticQuestionCount ? `${node.diagnosticQuestionCount} 道诊断题` : null,
    ].filter((item): item is string => Boolean(item));
    setConfirmation({
      title: `删除“${node.name || '未命名概念'}”？`,
      description: deletionConsequences.length
        ? `保存后还会永久删除：${deletionConsequences.join('、')}。此操作无法恢复。`
        : '此概念将在保存后从当前图谱中永久删除，且无法恢复。',
      confirmLabel: '删除概念',
      destructive: true,
      action: async () => {
        setBusy(true);
        try {
          const [activeSession, attempts] = await Promise.all([
            window.openLearnGraph.sessions.getActive(graph.id),
            window.openLearnGraph.assessments.listDiagnosticAttempts(graph.id),
          ]);
          if (activeSession?.nodeId === nodeId) {
            setSessionLaunch({ sessionId: activeSession.id });
            showNotice(`“${node.name}”还有未完成的学习会话，请先继续或放弃会话。`, 'error');
            return;
          }
          if (attempts.some((attempt) => attempt.status === 'IN_PROGRESS')) {
            setDiagnosticNodeIds([]);
            showNotice('当前图谱还有未完成的诊断，请先继续或放弃诊断。', 'error');
            return;
          }
          replaceGraph({
            ...graph,
            nodes: graph.nodes.filter((candidate) => candidate.id !== nodeId),
            edges: graph.edges.filter(
              (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId,
            ),
          });
          setSelectedNodeId(null);
          setNewNodeToFocusId(null);
          showNotice('概念及其关联数据已标记删除。保存后永久生效。');
        } catch (error) {
          showNotice(`删除前检查失败：${errorMessage(error)}`, 'error');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const saveGraph = useCallback(async (): Promise<void> => {
    if (!graph || busy || !dirty) return;
    if (!graph.name.trim()) {
      graphNameInputRef.current?.focus();
      showNotice('保存失败：图谱名称不能为空。', 'error');
      return;
    }
    const invalidNodeIndex = graph.nodes.findIndex((node) => !node.name.trim());
    if (invalidNodeIndex >= 0) {
      setSelectedNodeId(graph.nodes[invalidNodeIndex].id);
      setNewNodeToFocusId(graph.nodes[invalidNodeIndex].id);
      showNotice(`保存失败：第 ${invalidNodeIndex + 1} 个概念名称不能为空。`, 'error');
      return;
    }

    const input: SaveGraphInput = {
      id: graph.id,
      name: graph.name,
      nodes: graph.nodes.map(({ id, name, description, position }) => ({ id, name, description, position })),
      edges: graph.edges.map(({ id, sourceNodeId, targetNodeId, relationship }) => ({
        id,
        sourceNodeId,
        targetNodeId,
        relationship,
      })),
    };
    setBusy(true);
    try {
      const saved = await window.openLearnGraph.graphs.save(input);
      setGraph(saved);
      setGraphs((current) => [toSummary(saved), ...current.filter((item) => item.id !== saved.id)]);
      setDirty(false);
      setNewNodeToFocusId(null);
      showNotice('全部更改已安全保存到本机。', 'success');
    } catch (error) {
      showNotice(`保存失败：${errorMessage(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  }, [busy, dirty, graph, showNotice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault();
        void saveGraph();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveGraph]);

  const confirmAction = (): void => {
    const action = confirmation?.action;
    setConfirmation(null);
    if (action) void action();
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">OL</div>
          <div><strong>OpenLearnGraph</strong><span>本地知识学习地图</span></div>
        </div>
        <div className="sidebar-heading">学习图谱</div>
        <nav className="graph-list" aria-label="知识图谱列表">
          {graphs.map((item) => (
            <button
              key={item.id}
              className={item.id === graph?.id ? 'active' : ''}
              type="button"
              disabled={interactionBusy}
              aria-current={item.id === graph?.id ? 'page' : undefined}
              onClick={() => requestLoadGraph(item.id)}
            >
              <span className="graph-glyph" aria-hidden="true">⌘</span>
              <span className="graph-list-name">{item.name}</span>
              {item.id === graph?.id && dirty && <span className="unsaved-dot" title="有尚未保存的更改" />}
            </button>
          ))}
        </nav>
        <form className="new-graph-form" onSubmit={createGraph}>
          <input
            aria-label="新图谱名称"
            value={newGraphName}
            maxLength={120}
            disabled={interactionBusy}
            placeholder="例如：机器学习基础"
            onChange={(event) => setNewGraphName(event.target.value)}
          />
          <button type="submit" disabled={interactionBusy || !newGraphName.trim()}>＋ 创建图谱</button>
        </form>
        <button className="import-placeholder" type="button" disabled title="将在 M6 实现">
          ⇧ 导入书籍 <span>M6</span>
        </button>
        <div className="local-note">数据仅保存在此设备</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="graph-name-wrap">
            {graph ? (
              <input
                ref={graphNameInputRef}
                className={`graph-name ${!graph.name.trim() ? 'input-invalid' : ''}`}
                aria-label="图谱名称"
                aria-invalid={!graph.name.trim()}
                value={graph.name}
                maxLength={120}
                disabled={interactionBusy}
                onChange={(event) => replaceGraph({ ...graph, name: event.target.value })}
              />
            ) : <h1>知识图谱</h1>}
            <span>
              {graph
                ? `${graph.nodes.length} 个概念 · ${graph.edges.length} 条关系 · ${graph.nodes.filter((node) => node.status === 'MASTERED').length} 个已掌握${dirty ? ' · 尚未保存' : ''}`
                : '尚未创建图谱'}
            </span>
          </div>
          <div className="top-actions">
            <button
              type="button"
              className="secondary-button session-launch"
              disabled={!graph || dirty || interactionBusy}
              title={dirty ? '请先保存图谱结构' : '继续学习或查看会话记录'}
              onClick={() => setSessionLaunch({})}
            >
              ◎ 学习会话
            </button>
            <button
              type="button"
              className="secondary-button diagnostic-launch"
              disabled={!graph?.nodes.length || dirty || interactionBusy}
              title={dirty ? '请先保存图谱结构' : '使用客观答题证据检查掌握情况'}
              onClick={() => setDiagnosticNodeIds([])}
            >
              ◇ 图谱诊断
            </button>
            <button type="button" className="secondary-button" disabled={!graph || interactionBusy} onClick={addNode}>
              ＋ 添加概念
            </button>
            <button
              type="button"
              className={`primary-button ${!dirty ? 'saved-button' : ''}`}
              disabled={!graph || interactionBusy || !dirty}
              title="保存知识图谱（Ctrl+S）"
              onClick={() => void saveGraph()}
            >
              {busy ? '处理中…' : dirty ? '保存更改' : '✓ 已保存'}
              {dirty && <kbd>Ctrl S</kbd>}
            </button>
          </div>
        </header>

        <div className={`status-strip status-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <span className="status-strip-icon" aria-hidden="true" />
          <span>{notice.text}</span>
        </div>

        {graph && (
          <TutorRecommendation
            graph={graph}
            structureDirty={dirty}
            disabled={interactionBusy}
            refreshToken={recommendationRevision}
            onExecute={executeTutorDecision}
            onMessage={showNotice}
          />
        )}

        <div className="content-grid">
          {graph ? (
            <GraphCanvas
              graph={graph}
              selectedNodeId={selectedNodeId}
              onSelectedNodeIdChange={(nodeId) => {
                setSelectedNodeId(nodeId);
                if (nodeId !== newNodeToFocusId) setNewNodeToFocusId(null);
              }}
              onGraphChange={replaceGraph}
              onAddNode={addNode}
              onMessage={showNotice}
              readOnly={interactionBusy}
            />
          ) : (
            <section className="empty-canvas">
              <div className="empty-map" aria-hidden="true">⌘</div>
              <h2>把学习目标变成一张活的知识地图</h2>
              <p>请在左侧创建知识图谱。之后你可以添加概念，并用有向边表达先修关系。</p>
            </section>
          )}
          <NodeDetails
            key={selectedNode?.id ?? 'empty-details'}
            graph={graph}
            node={selectedNode}
            evidence={selectedEvidence}
            evidenceLoading={evidenceLoading}
            focusNodeNameId={newNodeToFocusId}
            structureDirty={dirty}
            learningBusy={learningBusy}
            interactionBusy={interactionBusy}
            onAddNode={addNode}
            onUpdate={updateNode}
            onDelete={deleteNode}
            onStartLearning={openLearningSession}
            onRecordSelfAssessment={recordSelfAssessment}
            onManageQuestions={(nodeId) => setQuestionManagerNodeId(nodeId)}
          />
        </div>
      </section>

      {confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          destructive={confirmation.destructive}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirmAction}
        />
      )}
      {questionManagerNode && (
        <QuestionManager
          node={questionManagerNode}
          onClose={() => setQuestionManagerNodeId(null)}
          onQuestionCountChange={updateQuestionCount}
          onMessage={showNotice}
        />
      )}
      {diagnosticNodeIds && graph && (
        <DiagnosticRunner
          graph={graph}
          initialNodeIds={diagnosticNodeIds}
          onClose={() => setDiagnosticNodeIds(null)}
          onGraphUpdated={acceptDiagnosticGraph}
          onMessage={showNotice}
        />
      )}
      {sessionLaunch && graph && (
        <LearningSessionRunner
          graph={graph}
          launch={sessionLaunch}
          onClose={() => setSessionLaunch(null)}
          onGraphUpdated={acceptDiagnosticGraph}
          onSessionChanged={notifySessionChanged}
          onDraftDirtyChange={setSessionDraftDirty}
          onMessage={showNotice}
        />
      )}
    </main>
  );
}
