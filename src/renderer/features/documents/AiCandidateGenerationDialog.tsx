import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiCandidateGenerationProgressView,
  AiCandidateGenerationPreviewView,
  AiCandidateGenerationResult,
  KnowledgeGraphDocument,
} from '../../../shared/contracts';
import { errorMessage } from '../../errorMessage';

export function AiCandidateGenerationDialog({ preview, targetGraph, onClose, onGenerated, onOpenSettings, onMessage }: {
  preview: AiCandidateGenerationPreviewView;
  targetGraph: KnowledgeGraphDocument;
  onClose: () => void;
  onGenerated: (result: AiCandidateGenerationResult) => void;
  onOpenSettings: () => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
}): React.JSX.Element {
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<AiCandidateGenerationProgressView | null>(null);
  const requestLock = useRef(false);

  const discard = useCallback(async (): Promise<void> => {
    await window.openLearnGraph.ai.cancelCandidateGeneration(preview.previewToken).catch(() => undefined);
    onClose();
  }, [onClose, preview.previewToken]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      void discard();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, discard]);

  useEffect(() => {
    if (!busy) return undefined;
    let active = true;
    const refresh = (): void => {
      void window.openLearnGraph.ai.getCandidateGenerationProgress(preview.previewToken)
        .then((next) => { if (active) setProgress(next); })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 250);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [busy, preview.previewToken]);

  const generate = async (): Promise<void> => {
    if (!consented || requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    setCancelling(false);
    setError(null);
    setProgress({
      phase: 'GENERATING', completedBatchCount: 0, totalBatchCount: preview.batchCount,
      currentBatchNumber: 1, retryingGrounding: false,
    });
    try {
      const result = await window.openLearnGraph.ai.generateCandidates(preview.previewToken);
      const mergeNote = result.mergeWarnings.length ? `；${result.mergeWarnings.join('；')}` : '';
      onMessage(`DeepSeek 通过 ${result.batchCount} 批提出了 ${result.conceptCount} 项学习内容和 ${result.relationshipCount} 条学习顺序${mergeNote}，请在路线预览中确认。`, 'success');
      onGenerated(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  };

  const cancelActive = async (): Promise<void> => {
    if (cancelling) return;
    setCancelling(true);
    setProgress((current) => current ? { ...current, phase: 'CANCELLING', currentBatchNumber: null } : current);
    await window.openLearnGraph.ai.cancelCandidateGeneration(preview.previewToken).catch(() => undefined);
    onMessage('DeepSeek 候选生成已取消。', 'info');
    onClose();
  };

  const progressText = progress?.phase === 'VERIFYING'
    ? `第 ${progress.currentBatchNumber} / ${progress.totalBatchCount} 批已返回，正在本机核对结构和原文出处…`
    : progress?.phase === 'MERGING'
      ? `共 ${progress.totalBatchCount} 批已通过核对，正在合并同名内容并检查学习顺序…`
      : progress?.phase === 'CANCELLING'
        ? '正在取消请求，并丢弃本次未完成结果…'
        : progress?.phase === 'GENERATING' && progress.currentBatchNumber
          ? progress.retryingGrounding
            ? `第 ${progress.currentBatchNumber} / ${progress.totalBatchCount} 批的出处需要重新核对，正在安全重试…`
            : `正在生成第 ${progress.currentBatchNumber} / ${progress.totalBatchCount} 批…`
          : `正在分批生成并核对引用（共 ${preview.batchCount} 批）…`;

  const openSettings = async (): Promise<void> => {
    await window.openLearnGraph.ai.cancelCandidateGeneration(preview.previewToken).catch(() => undefined);
    onOpenSettings();
  };

  return (
    <div className="candidate-workspace-backdrop" role="presentation" onMouseDown={busy ? undefined : () => void discard()}>
      <section className="ai-generation-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-generation-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>步骤 2 / 2 · 发送前确认</span><h3 id="ai-generation-title">核对 DeepSeek 发送范围</h3></div>
          <button type="button" aria-label="关闭 AI 生成预览" disabled={busy} onClick={() => void discard()}>×</button>
        </header>
        <div className="ai-generation-body">
          <div className="ai-upload-summary">
            <span>目标图谱<strong>{targetGraph.name}</strong></span>
            <span>资料<strong>{preview.documentTitle}</strong></span>
            <span>模型<strong>{preview.model}</strong></span>
            <span>发送范围<strong>{preview.sections.length} 节 · {preview.totalCharCount.toLocaleString('zh-CN')} 字符 · {preview.batchCount} 批</strong></span>
          </div>
          <ul className="ai-section-list">{preview.sections.map((section) => (
            <li key={section.position}><strong>{section.heading}</strong><span>{section.locator} · {section.charCount.toLocaleString('zh-CN')} 字符</span></li>
          ))}</ul>
          <div className="ai-source-excerpt"><strong>将发送内容预览</strong><p>{preview.excerpt}…</p></div>
          <div className="ai-privacy-note">
            <strong>这一步会把上述正文发送给 DeepSeek</strong>
            <p>所选正文会按每批最多 32,000 字符自动拆分。不会上传原始文件、其他章节、学习状态或本地路径；AI 输出只会进入“{targetGraph.name}”的候选工作台。</p>
          </div>
          <label className="ai-consent">
            <input type="checkbox" checked={consented} disabled={busy} onChange={(event) => setConsented(event.target.checked)} />
            <span>我已核对发送范围，并同意将上述正文发送给 DeepSeek 生成候选内容。</span>
          </label>
          {busy && <div className="ai-generation-progress" role="status">
            <div><strong>{progressText}</strong><span>{progress?.completedBatchCount ?? 0} / {progress?.totalBatchCount ?? preview.batchCount} 批完成</span></div>
            <div
              role="progressbar"
              aria-label="AI 生成批次进度"
              aria-valuemin={0}
              aria-valuemax={progress?.totalBatchCount ?? preview.batchCount}
              aria-valuenow={progress?.completedBatchCount ?? 0}
            >
              <span style={{ width: `${((progress?.completedBatchCount ?? 0) / Math.max(1, progress?.totalBatchCount ?? preview.batchCount)) * 100}%` }} />
            </div>
            <p>只有全部批次通过本机校验后才会写入候选区；现在取消不会留下半成品。</p>
          </div>}
          {error && <div className="ai-generation-error" role="alert">
            <strong>本次生成没有写入任何候选</strong>
            <p>{error}</p>
            <small>可以在不扩大上述发送范围的情况下安全重试；如果提示预览失效，请返回上一步重新确认。</small>
            <button type="button" onClick={() => void openSettings()}>检查 AI 设置</button>
          </div>}
        </div>
        <footer>
          <button type="button" disabled={cancelling} onClick={busy ? () => void cancelActive() : () => void discard()}>{busy ? cancelling ? '正在取消…' : '取消生成' : '暂不发送'}</button>
          <button className="primary-button" type="button" disabled={busy || !consented} onClick={() => void generate()}>{busy ? '生成中…' : error ? '安全重试' : '确认发送并生成'}</button>
        </footer>
      </section>
    </div>
  );
}
