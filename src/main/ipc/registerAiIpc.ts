import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts';
import type { AiService } from '../services/aiService';

export function registerAiIpc(service: AiService): void {
  ipcMain.handle(IPC_CHANNELS.aiSettingsGet, () => service.getSettings());
  ipcMain.handle(IPC_CHANNELS.aiSettingsSave, (_event, input: unknown) => service.saveSettings(input));
  ipcMain.handle(IPC_CHANNELS.aiApiKeyClear, () => service.clearApiKey());
  ipcMain.handle(IPC_CHANNELS.aiConnectionTest, () => service.testConnection());
  ipcMain.handle(IPC_CHANNELS.aiCandidatePreview, (
    _event, input: unknown,
  ) => service.previewCandidateGeneration(input));
  ipcMain.handle(IPC_CHANNELS.aiCandidateGenerate, (
    _event, previewToken: unknown,
  ) => service.generateCandidates(previewToken));
  ipcMain.handle(IPC_CHANNELS.aiCandidateCancel, (
    _event, previewToken: unknown,
  ) => service.cancelCandidateGeneration(previewToken));
}
