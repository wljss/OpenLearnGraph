import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts';
import type { CandidateService } from '../services/candidateService';

export function registerCandidateIpc(service: CandidateService): void {
  ipcMain.handle(IPC_CHANNELS.candidateWorkspaceGet, (
    _event, graphId: unknown, documentId: unknown,
  ) => service.getWorkspace(graphId, documentId));
  ipcMain.handle(IPC_CHANNELS.candidateConceptCreate, (
    _event, input: unknown,
  ) => service.createConcept(input));
  ipcMain.handle(IPC_CHANNELS.candidateConceptUpdate, (
    _event, input: unknown,
  ) => service.updateConcept(input));
  ipcMain.handle(IPC_CHANNELS.candidateConceptReview, (
    _event, input: unknown,
  ) => service.reviewConcept(input));
  ipcMain.handle(IPC_CHANNELS.candidateRelationshipCreate, (
    _event, input: unknown,
  ) => service.createRelationship(input));
  ipcMain.handle(IPC_CHANNELS.candidateRelationshipDelete, (
    _event, relationshipId: unknown,
  ) => service.deleteRelationship(relationshipId));
  ipcMain.handle(IPC_CHANNELS.candidateWorkspaceApply, (
    _event, graphId: unknown,
  ) => service.apply(graphId));
}
