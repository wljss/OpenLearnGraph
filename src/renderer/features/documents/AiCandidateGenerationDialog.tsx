import { useCallback, useEffect, useState } from 'react';
import type {
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
  const [error, setError] = useState<string | null>(null);

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

  const generate = async (): Promise<void> => {
    if (!consented) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.openLearnGraph.ai.generateCandidates(preview.previewToken);
      const mergeNote = result.mergeWarnings.length ? `；${result.mergeWarnings.join('；')}` : '';
      onMessage(`DeepSeek 通过 ${result.batchCount} 批提出了 ${result.conceptCount} 项学习内容和 ${result.relationshipCount} 条学习顺序${mergeNote}，请在路线预览中确认。`, 'success');
      onGenerated(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const cancelActive = async (): Promise<void> => {
    await window.openLearnGraph.ai.cancelCandidateGeneration(preview.previewToken).catch(() => undefined);
    onMessage('DeepSeek 候选生成已取消。', 'info');
    onClose();
  };

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
          {busy && <p className="ai-inline-status" role="status">正在分批生成并核对引用（共 {preview.batchCount} 批）……请勿关闭应用。</p>}
          {error && <div className="document-reader-error" role="alert"><p>{error}</p><button type="button" onClick={() => void openSettings()}>AI 设置</button></div>}
        </div>
        <footer>
          <button type="button" onClick={busy ? () => void cancelActive() : () => void discard()}>{busy ? '取消生成' : '暂不发送'}</button>
          <button className="primary-button" type="button" disabled={busy || !consented} onClick={() => void generate()}>{busy ? '生成中…' : '确认发送并生成'}</button>
        </footer>
      </section>
    </div>
  );
}
