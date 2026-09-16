import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts';
import type { SessionService } from '../services/sessionService';

export function registerSessionIpc(service: SessionService): void {
  ipcMain.handle(IPC_CHANNELS.learningSessionList, (_event, graphId: unknown) => service.list(graphId));
  ipcMain.handle(IPC_CHANNELS.learningSessionActiveGet, (_event, graphId: unknown) => service.getActive(graphId));
  ipcMain.handle(IPC_CHANNELS.learningSessionGet, (_event, sessionId: unknown) => service.get(sessionId));
  ipcMain.handle(IPC_CHANNELS.learningSessionStart, (_event, input: unknown) => service.start(input));
  ipcMain.handle(IPC_CHANNELS.learningSessionDraftSave, (_event, input: unknown) => service.saveDraft(input));
  ipcMain.handle(IPC_CHANNELS.learningSessionComplete, (_event, input: unknown) => service.complete(input));
  ipcMain.handle(IPC_CHANNELS.learningSessionCancel, (_event, sessionId: unknown) => service.cancel(sessionId));
}
