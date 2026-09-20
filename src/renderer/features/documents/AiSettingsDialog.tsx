import { useEffect, useState } from 'react';
import type { AiSettingsView, DeepSeekModel } from '../../../shared/contracts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { errorMessage } from '../../errorMessage';

export function AiSettingsDialog({ onClose, onMessage }: {
  onClose: () => void;
  onMessage: (message: string, tone?: 'info' | 'success' | 'error') => void;
}): React.JSX.Element {
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [model, setModel] = useState<DeepSeekModel>('deepseek-flash');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let active = true;
    void window.openLearnGraph.ai.getSettings().then((result) => {
      if (!active) return;
      setSettings(result);
      setModel(result.model);
    }).catch((reason: unknown) => {
      if (active) setError(`AI 设置读取失败：${errorMessage(reason)}`);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy || confirmClear) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, confirmClear, onClose]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await window.openLearnGraph.ai.saveSettings({
        model,
        ...(apiKey.trim() ? { apiKey } : {}),
      });
      setSettings(result);
      setApiKey('');
      setStatus(result.configured ? '设置已安全保存。' : '模型设置已保存，还需要填写 API Key。');
      onMessage('已更新 DeepSeek 设置。', 'success');
    } catch (reason) {
      setError(`保存失败：${errorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus('正在连接 DeepSeek……');
    try {
      const result = await window.openLearnGraph.ai.testConnection();
      setStatus(`连接成功 · ${result.model} · ${result.latencyMs.toLocaleString('zh-CN')} ms`);
      onMessage('DeepSeek 连接测试通过。', 'success');
    } catch (reason) {
      setStatus(null);
      setError(`连接失败：${errorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  const clearApiKey = async (): Promise<void> => {
    setConfirmClear(false);
    setBusy(true);
    setError(null);
    try {
      const result = await window.openLearnGraph.ai.clearApiKey();
      setSettings(result);
      setApiKey('');
      setStatus('API Key 已从设备中删除。');
      onMessage('DeepSeek API Key 已删除。', 'success');
    } catch (reason) {
      setError(`API Key 删除失败：${errorMessage(reason)}`);
    } finally {
      setBusy(false);
    }
  };

  return <>
    <div className="candidate-workspace-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <section className="ai-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>DeepSeek · 云端 API</span><h3 id="ai-settings-title">AI 服务设置</h3></div>
          <button type="button" aria-label="关闭 AI 设置" disabled={busy} onClick={onClose}>×</button>
        </header>
        <div className="ai-settings-body">
          <div className="ai-privacy-note">
            <strong>密钥只在本机加密保存</strong>
            <p>API Key 通过 Windows 安全存储加密，不写入 SQLite、日志或 Git，也不会再显示给界面。</p>
          </div>
          {settings && !settings.secureStorageAvailable && <p className="candidate-issues" role="alert">Windows 安全存储不可用，应用不会退回到明文保存。</p>}
          <label>
            模型
            <select value={model} disabled={busy} onChange={(event) => setModel(event.target.value as DeepSeekModel)}>
              <option value="deepseek-flash">deepseek-flash（推荐，快速经济）</option>
              <option value="deepseek-v4-pro">deepseek-v4-pro（质量优先）</option>
            </select>
          </label>
          <label>
            DeepSeek API Key
            <input
              type="password"
              value={apiKey}
              disabled={busy || settings?.secureStorageAvailable === false}
              autoComplete="off"
              placeholder={settings?.configured ? '已安全保存；留空表示不更换' : '输入 API Key'}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <p className="ai-settings-state">当前状态：<strong>{settings?.configured ? '已配置' : '未配置'}</strong> · 固定请求 {settings?.baseUrl ?? 'https://api.deepseek.com'}</p>
          {status && <p className="ai-inline-status" role="status">{status}</p>}
          {error && <p className="document-reader-error" role="alert">{error}</p>}
        </div>
        <footer>
          <button className="text-danger-button" type="button" disabled={busy || !settings?.configured} onClick={() => setConfirmClear(true)}>删除密钥</button>
          <div>
            <button type="button" disabled={busy || !settings?.configured} onClick={() => void testConnection()}>测试连接</button>
            <button className="primary-button" type="button" disabled={busy || settings?.secureStorageAvailable === false} onClick={() => void save()}>{busy ? '处理中…' : '保存设置'}</button>
          </div>
        </footer>
      </section>
    </div>
    {confirmClear && <ConfirmDialog
      title="删除 DeepSeek API Key？"
      description="删除后将无法使用 AI 候选生成，但不会影响本地资料和已有候选记录。"
      confirmLabel="删除密钥"
      destructive
      onCancel={() => setConfirmClear(false)}
      onConfirm={() => void clearApiKey()}
    />}
  </>;
}
