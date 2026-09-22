import type { KnowledgeGraphDocument } from '../../../shared/contracts';
import { graphProgressPercent, summarizeGraphProgress } from '../../../shared/graphProgress';

interface GraphProgressOverviewProps {
  graph: KnowledgeGraphDocument;
  disabled: boolean;
  onAddNode: () => void;
  onOpenDocuments: () => void;
}

function progressGuidance(graph: KnowledgeGraphDocument): string {
  const progress = summarizeGraphProgress(graph.nodes);
  if (!progress.totalConceptCount) return '先添加一个概念，或从本地资料生成一条可学习的路线。';
  if (progress.masteredCount === progress.totalConceptCount) {
    return progress.objectivelyMasteredCount === progress.totalConceptCount
      ? '整张图谱已通过客观诊断确认，可以回顾薄弱题目或建立新的学习图谱。'
      : '所有概念都已标记掌握；仍可通过客观诊断进一步确认自评结论。';
  }
  if (progress.learningCount > 0) {
    return `已有 ${progress.learningCount} 个概念正在学习；完成练习后，用客观诊断确认是否真正掌握。`;
  }
  if (progress.availableCount > 0) return '从已解锁的概念开始；上方“下一步建议”会给出当前最合适的行动。';
  return '当前内容仍受先修关系约束，请先检查学习顺序或已有掌握证据。';
}

export function GraphProgressOverview({
  graph,
  disabled,
  onAddNode,
  onOpenDocuments,
}: GraphProgressOverviewProps): React.JSX.Element {
  const progress = summarizeGraphProgress(graph.nodes);
  const percent = graphProgressPercent(progress);

  return (
    <section className="graph-progress-overview" aria-labelledby="graph-progress-title">
      <div className="graph-progress-primary">
        <div className="graph-progress-heading">
          <div>
            <span>学习进度</span>
            <strong id="graph-progress-title">
              {progress.totalConceptCount
                ? `${progress.masteredCount} / ${progress.totalConceptCount} 个概念已掌握`
                : '等待建立学习内容'}
            </strong>
          </div>
          <b>{percent}%</b>
        </div>
        <div
          className="graph-progress-track"
          role="progressbar"
          aria-label="图谱学习进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <p>{progressGuidance(graph)}</p>
        {!progress.totalConceptCount && (
          <div className="graph-progress-empty-actions">
            <button type="button" disabled={disabled} onClick={onAddNode}>添加概念</button>
            <button type="button" disabled={disabled} onClick={onOpenDocuments}>导入本地资料</button>
          </div>
        )}
      </div>
      <div className="graph-progress-stats" aria-label="学习状态明细">
        <span className="progress-stat-objective"><small>客观确认</small><strong>{progress.objectivelyMasteredCount}</strong><em>通过诊断</em></span>
        <span className="progress-stat-subjective"><small>主观掌握</small><strong>{progress.selfAssessedMasteredCount}</strong><em>来自自评</em></span>
        <span><small>正在学习</small><strong>{progress.learningCount}</strong><em>{progress.availableCount} 个可开始</em></span>
        <span><small>尚未解锁</small><strong>{progress.lockedCount}</strong><em>等待先修掌握</em></span>
        <span className="progress-stat-readiness"><small>诊断准备</small><strong>{progress.diagnosticReadyCount}/{progress.totalConceptCount}</strong><em>题库覆盖，不计入进度</em></span>
      </div>
    </section>
  );
}
