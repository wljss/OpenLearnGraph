import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts';
import type { AssessmentService } from '../services/assessmentService';

export function registerAssessmentIpc(service: AssessmentService): void {
  ipcMain.handle(IPC_CHANNELS.assessmentQuestionList, (_event, nodeId: unknown) => service.listQuestions(nodeId));
  ipcMain.handle(IPC_CHANNELS.assessmentQuestionSave, (_event, input: unknown) => service.saveQuestion(input));
  ipcMain.handle(IPC_CHANNELS.assessmentQuestionDelete, (_event, questionId: unknown) => service.deleteQuestion(questionId));
  ipcMain.handle(IPC_CHANNELS.diagnosticStart, (_event, graphId: unknown) => service.startDiagnostic(graphId));
  ipcMain.handle(IPC_CHANNELS.diagnosticCancel, (_event, attemptId: unknown) => service.cancelDiagnostic(attemptId));
  ipcMain.handle(IPC_CHANNELS.diagnosticComplete, (_event, input: unknown) => service.completeDiagnostic(input));
}
