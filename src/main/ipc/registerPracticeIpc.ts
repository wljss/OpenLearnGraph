import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts';
import type { PracticeService } from '../services/practiceService';

export function registerPracticeIpc(service: PracticeService): void {
  ipcMain.handle(IPC_CHANNELS.practiceAttemptList, (_event, graphId: unknown) => service.list(graphId));
  ipcMain.handle(IPC_CHANNELS.practiceAttemptActiveGet, (_event, graphId: unknown) => service.getActive(graphId));
  ipcMain.handle(IPC_CHANNELS.practiceAttemptGet, (_event, attemptId: unknown) => service.get(attemptId));
  ipcMain.handle(IPC_CHANNELS.practiceAttemptStart, (_event, input: unknown) => service.start(input));
  ipcMain.handle(IPC_CHANNELS.practiceAnswerSave, (_event, input: unknown) => service.saveAnswer(input));
  ipcMain.handle(IPC_CHANNELS.practiceAttemptComplete, (_event, attemptId: unknown) => service.complete(attemptId));
  ipcMain.handle(IPC_CHANNELS.practiceAttemptCancel, (_event, attemptId: unknown) => service.cancel(attemptId));
}
