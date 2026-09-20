import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OpenLearnGraphApi } from '../src/shared/contracts';
import { AiSettingsDialog } from '../src/renderer/features/documents/AiSettingsDialog';

describe('AiSettingsDialog', () => {
  it('saves a password without reading it back and tests the configured connection', async () => {
    const configured = {
      provider: 'DEEPSEEK' as const,
      baseUrl: 'https://api.deepseek.com' as const,
      model: 'deepseek-flash' as const,
      configured: true,
      secureStorageAvailable: true,
    };
    const ai: OpenLearnGraphApi['ai'] = {
      getSettings: vi.fn().mockResolvedValue({ ...configured, configured: false }),
      saveSettings: vi.fn().mockResolvedValue(configured),
      clearApiKey: vi.fn().mockResolvedValue({ ...configured, configured: false }),
      testConnection: vi.fn().mockResolvedValue({ ok: true, model: 'deepseek-flash', latencyMs: 128 }),
      previewCandidateGeneration: vi.fn(),
      generateCandidates: vi.fn(),
      cancelCandidateGeneration: vi.fn(),
    };
    window.openLearnGraph = { ai } as unknown as OpenLearnGraphApi;
    render(<AiSettingsDialog onClose={vi.fn()} onMessage={vi.fn()} />);
    expect(await screen.findByText('未配置')).toBeVisible();
    fireEvent.change(screen.getByLabelText('DeepSeek API Key'), { target: { value: 'sk-private-secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(ai.saveSettings).toHaveBeenCalledWith({
      model: 'deepseek-flash',
      apiKey: 'sk-private-secret',
    }));
    expect(screen.getByLabelText('DeepSeek API Key')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByText(/连接成功.*128 ms/)).toBeVisible();
  });
});
