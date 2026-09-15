import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts';
import type { LearningService } from '../services/learningService';

export function registerLearningIpc(service: LearningService): void {
  ipcMain.handle(IPC_CHANNELS.learningEvidenceList, (_event, nodeId: unknown) => service.listEvidence(nodeId));
  ipcMain.handle(IPC_CHANNELS.learningEvidenceRecord, (_event, input: unknown) => service.recordEvidence(input));
}
