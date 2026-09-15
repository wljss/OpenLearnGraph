import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/contracts';
import type { AssessmentService } from '../services/assessmentService';

export function registerAssessmentIpc(service: AssessmentService): void {
  ipcMain.handle(IPC_CHANNELS.assessmentQuestionList, (_event, nodeId: unknown) => service.listQuestions(nodeId));
  ipcMain.handle(IPC_CHANNELS.assessmentQuestionSave, (_event, input: unknown) => service.saveQuestion(input));
  ipcMain.handle(IPC_CHANNELS.assessmentQuestionDelete, (_event, questionId: unknown) => service.deleteQuestion(questionId));
  ipcMain.handle(IPC_CHANNELS.diagnosticAttemptList, (_event, graphId: unknown) => service.listDiagnosticAttempts(graphId));
  ipcMain.handle(IPC_CHANNELS.diagnosticStart, (_event, input: unknown) => service.startDiagnostic(input));
  ipcMain.handle(IPC_CHANNELS.diagnosticResume, (_event, attemptId: unknown) => service.resumeDiagnostic(attemptId));
  ipcMain.handle(IPC_CHANNELS.diagnosticAnswerSave, (_event, input: unknown) => service.saveDiagnosticAnswer(input));
  ipcMain.handle(IPC_CHANNELS.diagnosticCancel, (_event, attemptId: unknown) => service.cancelDiagnostic(attemptId));
  ipcMain.handle(IPC_CHANNELS.diagnosticResultGet, (_event, attemptId: unknown) => service.getDiagnosticResult(attemptId));
  ipcMain.handle(IPC_CHANNELS.diagnosticComplete, (_event, input: unknown) => service.completeDiagnostic(input));
}
