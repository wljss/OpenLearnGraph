import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts';
import type { TutorService } from '../services/tutorService';

export function registerTutorIpc(service: TutorService): void {
  ipcMain.handle(IPC_CHANNELS.tutorRecommendationGet, (_event, graphId: unknown) => (
    service.getRecommendation(graphId)
  ));
  ipcMain.handle(IPC_CHANNELS.tutorDecisionList, (_event, graphId: unknown) => (
    service.listDecisions(graphId)
  ));
  ipcMain.handle(IPC_CHANNELS.tutorDecisionRespond, (_event, input: unknown) => (
    service.respondDecision(input)
  ));
}
