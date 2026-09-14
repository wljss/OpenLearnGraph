import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GraphSummary, KnowledgeGraphDocument, KnowledgeNodeView, SaveGraphInput } from '../shared/contracts';
import { GraphCanvas } from './features/knowledge-graph/GraphCanvas';
import { NodeDetails } from './features/knowledge-graph/NodeDetails';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^Error invoking remote method '[^']+': /, '');
  return '发生了未知错误';
}

export function App(): React.JSX.Element {
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [graph, setGraph] = useState<KnowledgeGraphDocument | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [newGraphName, setNewGraphName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('正在加载本地知识图谱……');
  const [busy, setBusy] = useState(true);

  const loadGraph = useCallback(async (graphId: string): Promise<void> => {
    setBusy(true);
    try {
      const loaded = await window.openLearnGraph.graphs.load(graphId);
      setGraph(loaded); setSelectedNodeId(null); setDirty(false);
      setMessage(loaded ? '已从本地 SQLite 加载。' : '该知识图谱不存在。');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    let active = true;
    void window.openLearnGraph.graphs.list().then(async (items) => {
      if (!active) return;
      setGraphs(items);
      if (items[0]) await loadGraph(items[0].id);
      else { setMessage('创建第一个知识图谱，开始搭建学习地图。'); setBusy(false); }
    }).catch((error: unknown) => { if (active) { setMessage(errorMessage(error)); setBusy(false); } });
    return () => { active = false; };
  }, [loadGraph]);

  const selectedNode = useMemo(() => graph?.nodes.find((node) => node.id === selectedNodeId) ?? null, [graph, selectedNodeId]);
  const replaceGraph = (next: KnowledgeGraphDocument): void => { setGraph(next); setDirty(true); };

  const createGraph = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!newGraphName.trim()) { setMessage('图谱名称不能为空。'); return; }
    setBusy(true);
    try {
      const created = await window.openLearnGraph.graphs.create({ name: newGraphName });
      setGraphs(await window.openLearnGraph.graphs.list());
      setGraph(created); setNewGraphName(''); setDirty(false); setSelectedNodeId(null);
      setMessage('知识图谱已创建并保存到本地。');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const addNode = (): void => {
    if (!graph) return;
    const offset = graph.nodes.length * 36;
    const node: KnowledgeNodeView = {
      id: crypto.randomUUID(), graphId: graph.id, name: '新概念', description: '',
      position: { x: 120 + (offset % 360), y: 120 + (offset % 240) }, status: 'AVAILABLE',
    };
    replaceGraph({ ...graph, nodes: [...graph.nodes, node] });
    setSelectedNodeId(node.id); setMessage('已添加概念，请在右侧编辑并保存。');
  };

  const updateNode = (updated: KnowledgeNodeView): void => {
    if (graph) replaceGraph({ ...graph, nodes: graph.nodes.map((node) => node.id === updated.id ? updated : node) });
  };
  const deleteNode = (nodeId: string): void => {
    if (!graph) return;
    replaceGraph({ ...graph, nodes: graph.nodes.filter((node) => node.id !== nodeId),
      edges: graph.edges.filter((edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId) });
    setSelectedNodeId(null); setMessage('概念及其相连关系已移除，保存后生效。');
  };

  const saveGraph = async (): Promise<void> => {
    if (!graph) return;
    const input: SaveGraphInput = {
      id: graph.id, name: graph.name,
      nodes: graph.nodes.map(({ id, name, description, position }) => ({ id, name, description, position })),
      edges: graph.edges.map(({ id, sourceNodeId, targetNodeId, relationship }) => ({ id, sourceNodeId, targetNodeId, relationship })),
    };
    setBusy(true);
    try {
      setGraph(await window.openLearnGraph.graphs.save(input));
      setGraphs(await window.openLearnGraph.graphs.list()); setDirty(false);
      setMessage('全部更改已保存到本地 SQLite。');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">OL</div><div><strong>OpenLearnGraph</strong><span>本地知识学习地图</span></div></div>
        <div className="sidebar-heading">学习图谱</div>
        <nav className="graph-list" aria-label="知识图谱列表">
          {graphs.map((item) => <button key={item.id} className={item.id === graph?.id ? 'active' : ''} type="button" onClick={() => void loadGraph(item.id)}><span className="graph-glyph">⌘</span><span>{item.name}</span></button>)}
        </nav>
        <form className="new-graph-form" onSubmit={(event) => void createGraph(event)}>
          <input aria-label="新图谱名称" value={newGraphName} maxLength={120} placeholder="新图谱名称" onChange={(event) => setNewGraphName(event.target.value)} />
          <button type="submit" disabled={busy}>＋ 创建图谱</button>
        </form>
        <button className="import-placeholder" type="button" disabled title="将在 M6 实现">⇧ 导入书籍 <span>M6</span></button>
        <div className="local-note">数据仅保存在此设备</div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div className="graph-name-wrap">
            {graph ? <input className="graph-name" aria-label="图谱名称" value={graph.name} maxLength={120} onChange={(event) => replaceGraph({ ...graph, name: event.target.value })} /> : <h1>知识图谱</h1>}
            <span>{graph ? `${graph.nodes.length} 个概念 · ${graph.edges.length} 条关系` : '尚未创建图谱'}</span>
          </div>
          <div className="top-actions">
            <button type="button" className="secondary-button" disabled={!graph} onClick={addNode}>＋ 添加概念</button>
            <button type="button" className="primary-button" disabled={!graph || busy} onClick={() => void saveGraph()}>{busy ? '处理中…' : dirty ? '保存更改 ●' : '已保存'}</button>
          </div>
        </header>
        <div className="status-strip" role="status">{message}</div>
        <div className="content-grid">
          {graph ? <GraphCanvas graph={graph} selectedNodeId={selectedNodeId} onSelectedNodeIdChange={setSelectedNodeId} onGraphChange={replaceGraph} onMessage={setMessage} /> :
            <section className="empty-canvas"><div className="empty-map">⌘</div><h2>把学习目标变成一张活的知识地图</h2><p>请在左侧创建知识图谱。之后你可以添加概念，并用有向边表达先修关系。</p></section>}
          <NodeDetails graph={graph ?? emptyGraph} node={selectedNode} onUpdate={updateNode} onDelete={deleteNode} />
        </div>
      </section>
    </main>
  );
}

const emptyGraph: KnowledgeGraphDocument = {
  id: '00000000-0000-0000-0000-000000000000', name: '', createdAt: '', updatedAt: '', nodes: [], edges: [],
};
